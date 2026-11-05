use crate::{project_root, run, Result};
use std::{env, fs, path::PathBuf, process::Command};

pub fn prepare_shell() -> Result<()> {
    let target = env::var("TAURI_ENV_TARGET_TRIPLE").ok();
    if !target
        .as_deref()
        .map_or(cfg!(windows), |value| value.contains("windows"))
    {
        return Ok(());
    }
    let root = project_root();
    let cargo = fs::read_to_string(root.join("Cargo.toml"))?;
    let version = cargo
        .lines()
        .find_map(|line| {
            line.trim()
                .strip_prefix("version = \"")
                .and_then(|value| value.strip_suffix('"'))
        })
        .ok_or("Workspace version is missing")?;
    let config = fs::read_to_string(root.join("src-tauri/tauri.windows.conf.json"))?;
    if !config.contains(&format!("\"virushelper_shell-{version}.dll\"")) {
        return Err("Windows Shell DLL resource filename must match the release version".into());
    }
    let mut command = Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()));
    command
        .current_dir(root)
        .args(["build", "-p", "windows-shell", "--release", "--locked"]);
    if let Some(target) = &target {
        command.args(["--target", target]);
    }
    run(&mut command)?;
    let mut output = env::var_os("CARGO_TARGET_DIR")
        .map(PathBuf::from)
        .map(|path| root.join(path))
        .unwrap_or_else(|| root.join("target"));
    if let Some(target) = &target {
        output.push(target);
    }
    let destination = root.join("src-tauri/windows/generated");
    fs::create_dir_all(&destination)?;
    fs::copy(
        output.join("release/virushelper_shell.dll"),
        destination.join("virushelper_shell.dll"),
    )?;
    Ok(())
}

pub fn package(target: &str) -> Result<()> {
    if !cfg!(windows) {
        return Err("Windows installers must be built on Windows".into());
    }
    if target != "x86_64-pc-windows-msvc" {
        return Err("Windows installer currently supports x64 MSVC only".into());
    }
    run(
        Command::new(env::var_os("CARGO").unwrap_or_else(|| "cargo".into()))
            .current_dir(project_root())
            .args([
                "tauri",
                "build",
                "--target",
                target,
                "--bundles",
                "nsis",
                "--",
                "--locked",
            ]),
    )
}
