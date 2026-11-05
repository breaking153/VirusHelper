use super::*;

#[test]
fn validates_architecture_and_distribution_metadata() {
    assert_eq!(architecture(Some("aarch64-apple-darwin")).unwrap(), "arm64");
    assert_eq!(architecture(Some("x86_64-apple-darwin")).unwrap(), "x64");
    assert!(architecture(Some("../invalid")).is_err());
    assert!(distribution("0.2.1", "x64", "12.0")
        .unwrap()
        .contains("hostArchitectures=\"x86_64\""));
    assert!(distribution("0.2.1<xml>", "arm64", "12.0").is_err());
    assert!(distribution("0..1", "arm64", "12.0").is_err());
    assert!(distribution("0.2.1", "invalid", "12.0").is_err());
}

#[test]
fn encodes_shell_and_xml_without_interpreting_the_app_path() {
    let command = workflow_command("/Applications/测试 & O'Brien $(touch NEVER_EXECUTED).app");
    assert!(command.contains("'\\''"));
    assert!(command.ends_with(" --args -- \"$@\"\n"));
    assert!(xml(&command).contains("&amp;"));
    assert!(!xml(&command).contains("O'Brien"));
}

#[test]
fn staging_cleanup_is_scoped_to_its_owned_directory() {
    let path;
    {
        let staging = Staging::new().unwrap();
        path = staging.0.clone();
        fs::write(path.join("temporary"), "test").unwrap();
        assert!(path.is_dir());
    }
    assert!(!path.exists());
}

#[cfg(target_os = "macos")]
fn captured(path: &Path) -> Vec<String> {
    let data = fs::read(path).unwrap();
    data.split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8(s.to_vec()).unwrap())
        .collect()
}

#[cfg(target_os = "macos")]
#[test]
fn workflow_forwards_multiselection_and_loads_in_real_automator() -> Result<()> {
    use std::{io::Write, os::unix::fs::PermissionsExt, process::Stdio};
    let staging = Staging::new()?;
    let root = &staging.0;
    let app = "/Applications/测试 & O'Brien $(touch NEVER_EXECUTED).app";
    let workflow = root.join(WORKFLOW);
    write_workflow(&workflow, app)?;
    let info = workflow.join("Contents/Info.plist");
    assert_eq!(
        plist_value(&info, "NSServices.0.NSSendFileTypes.0")?,
        "public.item"
    );
    assert_eq!(
        plist_value(
            &info,
            "NSServices.0.NSRequiredContext.NSApplicationIdentifier"
        )?,
        "com.apple.finder"
    );
    let document = workflow.join("Contents/document.wflow");
    let key = "actions.0.action.ActionParameters.COMMAND_STRING";
    let script = plist_value(&document, key)?;
    assert_eq!(
        plist_value(&document, "actions.0.action.ActionParameters.inputMethod")?,
        "1"
    );
    let capture = root.join("arguments");
    let stub = root.join("capture-open");
    let quote = |s: &str| format!("'{}'", s.replace('\'', "'\\''"));
    fs::write(
        &stub,
        format!(
            "#!/bin/sh\nprintf '%s\\0' \"$@\" > {}\n",
            quote(capture.to_str().unwrap())
        ),
    )?;
    fs::set_permissions(&stub, fs::Permissions::from_mode(0o755))?;
    let safe_script = script.replace("/usr/bin/open", &quote(stub.to_str().unwrap()));
    let paths = [
        "测试 file.txt",
        "quote'file",
        "line\nbreak",
        "$(touch NEVER_EXECUTED)",
        "-option",
    ];
    output(
        Command::new("/bin/sh")
            .current_dir(root)
            .args(["-c", &safe_script, "workflow"])
            .args(paths),
    )?;
    let mut expected: Vec<String> = ["-n", "-a", app, "--args", "--"].map(String::from).to_vec();
    expected.extend(paths.map(String::from));
    assert_eq!(captured(&capture), expected);
    assert!(!root.join("NEVER_EXECUTED").exists());
    fs::remove_file(&capture)?;
    output(Command::new("/bin/sh").args(["-c", &safe_script]))?;
    assert!(!capture.exists(), "Empty selection must not launch an app");
    output(
        Command::new("/usr/bin/plutil")
            .args(["-replace", key, "-string", &safe_script])
            .arg(&document),
    )?;
    let mut child = Command::new("/usr/bin/automator")
        .args(["-i", "-"])
        .arg(&workflow)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .unwrap()
        .write_all("中文 file.txt\nsecond file\n".as_bytes())?;
    let result = child.wait_with_output()?;
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert_eq!(
        captured(&capture),
        [
            "-n",
            "-a",
            app,
            "--args",
            "--",
            "中文 file.txt",
            "second file"
        ]
    );
    Ok(())
}

#[cfg(target_os = "macos")]
#[test]
fn creates_and_verifies_real_pkg_dmg_payload_and_install_hook() -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let staging = Staging::new()?;
    let bundle = &staging.0;
    let app = bundle.join("macos/VirusHelper.app");
    fs::create_dir_all(app.join("Contents/MacOS"))?;
    let executable = app.join("Contents/MacOS/virus-helper");
    fs::write(&executable, "#!/bin/sh\nexit 0\n")?;
    fs::set_permissions(executable, fs::Permissions::from_mode(0o755))?;
    fs::write(
        app.join("Contents/Info.plist"),
        r#"<?xml version="1.0"?><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>io.virushelper.desktop</string>
<key>CFBundleExecutable</key><string>virus-helper</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>0.2.1</string>
<key>CFBundleShortVersionString</key><string>0.2.1</string>
</dict></plist>"#,
    )?;
    let (pkg, dmg) = build_installer(bundle, "0.2.1", architecture(None)?, "12.0", None)?;
    assert!(pkg.is_file() && dmg.is_file());
    output(Command::new("/usr/bin/hdiutil").arg("verify").arg(dmg))?;
    let expanded = bundle.join("expanded");
    output(
        Command::new("/usr/sbin/pkgutil")
            .arg("--expand-full")
            .arg(pkg)
            .arg(&expanded),
    )?;
    assert!(fs::read_to_string(expanded.join("Distribution"))?
        .contains("<welcome file=\"Welcome.html\""));
    let component = expanded.join("VirusHelper-component.pkg");
    let payload = component.join("Payload");
    assert!(payload
        .join("Applications/VirusHelper.app/Contents/MacOS/virus-helper")
        .is_file());
    assert_eq!(
        plist_value(
            &payload
                .join("Library/Services")
                .join(WORKFLOW)
                .join("Contents/document.wflow"),
            "actions.0.action.ActionParameters.COMMAND_STRING"
        )?,
        workflow_command(APP_PATH).trim()
    );
    let hook = component.join("Scripts/postinstall");
    assert_eq!(
        fs::read_to_string(&hook)?,
        include_str!("../../../src-tauri/macos/postinstall")
    );
    output(Command::new("/bin/bash").arg("-n").arg(hook))?;
    let info = fs::read_to_string(component.join("PackageInfo"))?;
    assert!(info.contains("relocatable=\"false\"") && info.contains("<postinstall"));
    assert!(build_installer(bundle, "0.2.2", architecture(None)?, "12.0", None).is_err());
    Ok(())
}
