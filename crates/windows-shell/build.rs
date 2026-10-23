fn main() {
    println!("cargo:rerun-if-changed=exports.def");
    if std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc") {
        let path = std::path::Path::new(&std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
            .join("exports.def");
        println!("cargo:rustc-cdylib-link-arg=/DEF:{}", path.display());
        println!("cargo:rustc-cdylib-link-arg=/NOLOGO");
        println!("cargo:rustc-cdylib-link-arg=/NOIMPLIB");
        println!("cargo:rustc-cdylib-link-arg=/NOEXP");
    }
}
