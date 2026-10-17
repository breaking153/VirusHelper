fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        // Unit-test executables also link native dialogs. Unlike the packaged app,
        // they have no Tauri resource manifest to select comctl32 v6 (TaskDialogIndirect).
        println!("cargo:rustc-link-arg=/MANIFEST");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
}
