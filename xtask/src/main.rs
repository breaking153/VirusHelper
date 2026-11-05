mod macos;
mod windows;

use std::{env, error::Error, path::Path, process::Command};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn project_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap()
}

fn run(command: &mut Command) -> Result<()> {
    let status = command.status()?;
    if !status.success() {
        return Err(format!(
            "{} failed: {status}",
            command.get_program().to_string_lossy()
        )
        .into());
    }
    Ok(())
}

fn frontend() -> Result<()> {
    let root = project_root();
    run(Command::new("node")
        .current_dir(root)
        .arg(root.join("node_modules/typescript/bin/tsc"))
        .arg("--noEmit"))?;
    run(Command::new("node")
        .current_dir(root)
        .arg(root.join("node_modules/vite/bin/vite.js"))
        .arg("build"))
}

fn entry() -> Result<()> {
    let mut args = env::args_os().skip(1);
    match args.next().as_deref().and_then(|s| s.to_str()) {
        Some("frontend") if args.next().is_none() => frontend(),
        Some("prepare-windows-shell") if args.next().is_none() => windows::prepare_shell(),
        Some("package-windows") => {
            let target = match args.next().as_deref().and_then(|value| value.to_str()) {
                None => "x86_64-pc-windows-msvc".to_owned(),
                Some("--target") => args
                    .next()
                    .ok_or("--target needs a value")?
                    .into_string()
                    .map_err(|_| "Target must be UTF-8")?,
                _ => return Err("Expected --target x86_64-pc-windows-msvc".into()),
            };
            if args.next().is_some() {
                return Err("Unexpected Windows packaging argument".into());
            }
            windows::package(&target)
        }
        Some("package-macos") => {
            let mut target = None;
            let mut bundle_dir = None;
            let mut package_only = false;
            let mut local = false;
            while let Some(arg) = args.next() {
                match arg.to_str() {
                    Some("--target") => target = Some(args.next().ok_or("--target needs a value")?),
                    Some("--bundle-dir") => {
                        bundle_dir = Some(args.next().ok_or("--bundle-dir needs a value")?)
                    }
                    Some("--package-only") => package_only = true,
                    Some("--local") => local = true,
                    Some("--help") | Some("-h") => {
                        print_help();
                        return Ok(());
                    }
                    _ => return Err(format!("Unknown argument: {}", arg.to_string_lossy()).into()),
                }
            }
            macos::package(target, bundle_dir, package_only, local)
        }
        None | Some("--help") | Some("-h") => {
            print_help();
            Ok(())
        }
        _ => Err("Unknown task; run cargo xtask --help".into()),
    }
}

fn print_help() {
    println!(
        "cargo xtask package-macos [--target aarch64-apple-darwin|x86_64-apple-darwin]\n\
         \x20                         [--local] [--package-only] [--bundle-dir PATH]\n\
         Build the Tauri app, then create the native Installer PKG and DMG.\n\
         --package-only wraps an existing .app instead of invoking cargo tauri.\n\
         --local skips updater artifacts that require the release signing key.\n\
         cargo xtask frontend     Build React assets without invoking npm.\n\
         cargo xtask prepare-windows-shell  Build/copy the COM DLL before native checks.\n\
         cargo xtask package-windows [--target x86_64-pc-windows-msvc]"
    );
}

fn main() {
    if let Err(error) = entry() {
        eprintln!("xtask: {error}");
        std::process::exit(1);
    }
}
