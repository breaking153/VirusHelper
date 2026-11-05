use crate::{project_root, run, Result};
use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

const WORKFLOW: &str = "使用 VirusHelper 计算哈希.workflow";
const APP_ID: &str = "io.virushelper.desktop";
const APP_PATH: &str = "/Applications/VirusHelper.app";

// All filesystem staging is confined to a newly created directory.
struct Staging(PathBuf);

impl Staging {
    fn new() -> Result<Self> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        for _ in 0..100 {
            let path = env::temp_dir().join(format!(
                "virushelper-pkg-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Ok(Self(path)),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.into()),
            }
        }
        Err("Cannot create installer staging directory".into())
    }
}

impl Drop for Staging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn output(command: &mut Command) -> Result<String> {
    let result = command.output()?;
    if !result.status.success() {
        return Err(format!(
            "{} failed: {}\n{}\n{}",
            command.get_program().to_string_lossy(),
            result.status,
            String::from_utf8_lossy(&result.stdout),
            String::from_utf8_lossy(&result.stderr)
        )
        .into());
    }
    Ok(String::from_utf8(result.stdout)?.trim().to_owned())
}

fn plist_value(path: &Path, key: &str) -> Result<String> {
    output(
        Command::new("/usr/bin/plutil")
            .args(["-extract", key, "raw", "-o", "-"])
            .arg(path),
    )
}

fn xml(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn workflow_command(app: &str) -> String {
    format!(
        "[ \"$#\" -gt 0 ] || exit 0\nexec /usr/bin/open -n -a '{}' --args -- \"$@\"\n",
        app.replace('\'', "'\\''")
    )
}

fn write_workflow(path: &Path, app: &str) -> Result<()> {
    fs::create_dir_all(path.join("Contents"))?;
    fs::write(
        path.join("Contents/Info.plist"),
        include_str!("../templates/finder-info.plist"),
    )?;
    fs::write(
        path.join("Contents/document.wflow"),
        include_str!("../templates/finder-document.wflow")
            .replace("{{COMMAND}}", &xml(&workflow_command(app))),
    )?;
    Ok(())
}

fn architecture(target: Option<&str>) -> Result<&'static str> {
    match target.unwrap_or(env::consts::ARCH) {
        "aarch64" | "aarch64-apple-darwin" => Ok("arm64"),
        "x86_64" | "x86_64-apple-darwin" => Ok("x64"),
        other => Err(format!("Unsupported macOS target: {other}").into()),
    }
}

fn distribution(version: &str, arch: &str, minimum: &str) -> Result<String> {
    if version.split('.').count() != 3
        || version
            .split('.')
            .any(|part| part.is_empty() || !part.bytes().all(|b| b.is_ascii_digit()))
    {
        return Err("Installer version must be x.y.z".into());
    }
    let host = match arch {
        "arm64" => "arm64",
        "x64" => "x86_64",
        _ => return Err("Installer architecture must be arm64 or x64".into()),
    };
    Ok(include_str!("../templates/Distribution.xml")
        .replace("{{VERSION}}", version)
        .replace("{{ARCH}}", host)
        .replace("{{MINIMUM_OS}}", &xml(minimum)))
}

pub fn package(
    target: Option<OsString>,
    bundle_dir: Option<OsString>,
    package_only: bool,
    local: bool,
) -> Result<()> {
    if !cfg!(target_os = "macos") {
        return Err("macOS installers must be built on macOS".into());
    }
    let target = target
        .map(|s| s.into_string().map_err(|_| "Target must be UTF-8"))
        .transpose()?;
    let arch = architecture(target.as_deref())?;
    let root = project_root();
    if !package_only {
        let mut command = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
        command
            .current_dir(root)
            .args(["tauri", "build", "--bundles", "app"]);
        if let Some(target) = &target {
            command.args(["--target", target]);
        }
        if local {
            command.args(["--config", r#"{"bundle":{"createUpdaterArtifacts":false}}"#]);
        }
        command.args(["--", "--locked"]);
        run(&mut command)?;
    }
    let bundle = match bundle_dir {
        Some(path) => root.join(path),
        None => {
            // Honor Cargo's configured target directory, including CARGO_TARGET_DIR.
            let metadata = output(
                Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
                    .current_dir(root)
                    .args(["metadata", "--no-deps", "--format-version", "1"]),
            )?;
            let staging = Staging::new()?;
            let json = staging.0.join("metadata.json");
            fs::write(&json, metadata)?;
            let mut path = PathBuf::from(plist_value(&json, "target_directory")?);
            if let Some(target) = &target {
                path.push(target);
            }
            path.join("release/bundle")
        }
    };
    let version = plist_value(&root.join("src-tauri/tauri.conf.json"), "version")?;
    let minimum = plist_value(
        &root.join("src-tauri/tauri.macos.conf.json"),
        "bundle.macOS.minimumSystemVersion",
    )?;
    let identity = env::var_os("APPLE_INSTALLER_SIGNING_IDENTITY").filter(|s| !s.is_empty());
    if local {
        let app = bundle.join("macos/VirusHelper.app");
        output(
            Command::new("/usr/bin/codesign")
                .args(["--force", "--deep", "--sign", "-"])
                .arg(&app),
        )?;
        output(
            Command::new("/usr/bin/codesign")
                .args(["--verify", "--deep", "--strict"])
                .arg(&app),
        )?;
    }
    let (pkg, dmg) = build_installer(&bundle, &version, arch, &minimum, identity.as_deref())?;
    println!(
        "Created Installer package: {}\nCreated DMG: {}",
        pkg.display(),
        dmg.display()
    );
    Ok(())
}

fn build_installer(
    bundle: &Path,
    version: &str,
    arch: &str,
    minimum: &str,
    identity: Option<&std::ffi::OsStr>,
) -> Result<(PathBuf, PathBuf)> {
    let distribution = distribution(version, arch, minimum)?;
    let app = bundle.join("macos/VirusHelper.app");
    let info = app.join("Contents/Info.plist");
    if plist_value(&info, "CFBundleIdentifier")? != APP_ID {
        return Err("Source app is not VirusHelper".into());
    }
    if plist_value(&info, "CFBundleShortVersionString")? != version {
        return Err("App and installer versions must match".into());
    }
    let staging = Staging::new()?;
    let temp = &staging.0;
    let payload = temp.join("payload");
    let scripts = temp.join("scripts");
    let packages = temp.join("packages");
    let resources = temp.join("resources");
    for path in [
        payload.join("Applications"),
        payload.join("Library/Services"),
        scripts.clone(),
        packages.clone(),
        resources.clone(),
    ] {
        fs::create_dir_all(path)?;
    }
    // Preserve app signatures, symbolic links, resource forks and extended attributes.
    output(
        Command::new("/usr/bin/ditto")
            .arg(&app)
            .arg(payload.join("Applications/VirusHelper.app")),
    )?;
    write_workflow(&payload.join("Library/Services").join(WORKFLOW), APP_PATH)?;
    let postinstall = scripts.join("postinstall");
    fs::write(
        &postinstall,
        include_str!("../../src-tauri/macos/postinstall"),
    )?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&postinstall, fs::Permissions::from_mode(0o755))?;
    }
    let components = temp.join("components.plist");
    fs::write(&components, include_str!("../templates/components.plist"))?;
    output(
        Command::new("/usr/bin/pkgbuild")
            .arg("--root")
            .arg(&payload)
            .args(["--install-location", "/", "--ownership", "recommended"])
            .arg("--component-plist")
            .arg(&components)
            .arg("--scripts")
            .arg(&scripts)
            .args([
                "--identifier",
                "io.virushelper.desktop.installer",
                "--version",
                version,
            ])
            .arg(packages.join("VirusHelper-component.pkg")),
    )?;
    let dist = temp.join("Distribution.xml");
    fs::write(&dist, distribution)?;
    fs::write(
        resources.join("Welcome.html"),
        include_str!("../templates/Welcome.html"),
    )?;
    fs::write(
        resources.join("Conclusion.html"),
        include_str!("../templates/Conclusion.html"),
    )?;
    let name = format!("VirusHelper_{version}_macOS-{arch}");
    let pkg_dir = bundle.join("pkg");
    let dmg_dir = bundle.join("dmg");
    fs::create_dir_all(&pkg_dir)?;
    fs::create_dir_all(&dmg_dir)?;
    let pkg = pkg_dir.join(format!("{name}.pkg"));
    let dmg = dmg_dir.join(format!("{name}.dmg"));
    let mut product = Command::new("/usr/bin/productbuild");
    product
        .arg("--distribution")
        .arg(dist)
        .arg("--resources")
        .arg(resources)
        .arg("--package-path")
        .arg(packages);
    if let Some(identity) = identity {
        product.arg("--sign").arg(identity);
    }
    output(product.arg(&pkg))?;
    let disk = temp.join("disk");
    fs::create_dir(&disk)?;
    fs::copy(&pkg, disk.join("安装 VirusHelper.pkg"))?;
    output(
        Command::new("/usr/bin/hdiutil")
            .args([
                "create",
                "-volname",
                &format!("VirusHelper {version}"),
                "-srcfolder",
            ])
            .arg(disk)
            .args(["-format", "UDZO", "-ov"])
            .arg(&dmg),
    )?;
    Ok((pkg, dmg))
}

#[cfg(test)]
mod tests;
