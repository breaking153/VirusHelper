use hash_core::{parse_manifest, render_manifest, resolve_entry, Algorithm::*};

const SHA: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

#[test]
fn imports_gnu_binary_and_text_lines_with_spaces_and_bom() {
    let text = format!("\u{feff}# comment\n{SHA} *中文 file.bin\n{SHA}   leading space.bin\n");
    let entries = parse_manifest(&text, None).unwrap();
    assert_eq!(entries[0].name, "中文 file.bin");
    assert_eq!(entries[1].name, " leading space.bin");
    assert_eq!(entries[0].algorithm, Sha256);
}

#[test]
fn imports_sfv_and_normalizes_hash_case() {
    let entries = parse_manifest("; created by tool\r\nmy file.zip 352441C2\r\n", None).unwrap();
    assert_eq!(entries[0].algorithm, Crc32);
    assert_eq!(entries[0].name, "my file.zip");
    assert_eq!(entries[0].hash, "352441c2");
}

#[test]
fn roundtrips_gnu_escaped_file_names_and_blake3_hint() {
    let name = "folder/line\nwith\\backslash\r.bin";
    let text = render_manifest(&[(name.into(), SHA.into())], Blake3).unwrap();
    let entries = parse_manifest(&text, None).unwrap();
    assert_eq!(entries[0].algorithm, Blake3);
    assert_eq!(entries[0].name, name);
}

#[test]
fn uses_explicit_algorithm_hint_for_ambiguous_hash_lengths() {
    assert_eq!(
        parse_manifest(&format!("{SHA}  abc"), Some(Sha3_256)).unwrap()[0].algorithm,
        Sha3_256
    );
}

#[test]
fn rejects_malformed_lines_without_silently_dropping_them() {
    for text in [
        format!("{SHA}  good\ninvalid checksum"),
        "".into(),
        "abcdef  file".into(),
        format!("{SHA}  "),
    ] {
        assert!(parse_manifest(&text, None).is_err(), "{text}");
    }
    let error = parse_manifest(&format!("# header\n{SHA}  good\ninvalid"), None)
        .unwrap_err()
        .to_string();
    assert!(error.contains('3'));
}

#[test]
fn resolves_only_relative_files_within_manifest_root() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("nested")).unwrap();
    std::fs::write(root.path().join("nested/abc"), b"abc").unwrap();
    assert!(resolve_entry(root.path(), "nested/abc").unwrap().is_file());
    // Missing files stay in the queue so the batch can report their errors.
    assert!(resolve_entry(root.path(), "missing.bin")
        .unwrap()
        .ends_with("missing.bin"));
    for name in [
        "../outside",
        "/etc/passwd",
        "C:\\Windows\\x",
        "\\\\host\\share",
        "nested/../../outside",
        "",
        "file:stream",
    ] {
        assert!(resolve_entry(root.path(), name).is_err(), "{name}");
    }
}

#[cfg(unix)]
#[test]
fn rejects_a_symlink_leading_outside_the_root() {
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), root.path().join("link")).unwrap();
    assert!(resolve_entry(root.path(), "link/missing").is_err());
}

#[test]
fn renders_portable_sfv() {
    let text = render_manifest(&[("some file.zip".into(), "352441c2".into())], Crc32).unwrap();
    assert!(text.contains("some file.zip 352441C2"));
    assert_eq!(parse_manifest(&text, None).unwrap()[0].hash, "352441c2");
}

#[test]
fn sfv_supports_hexadecimal_filenames_and_standard_semicolon_comments() {
    let entries = parse_manifest("deadbeef 352441C2\n", None).unwrap();
    assert_eq!(entries[0].name, "deadbeef");
    let rendered = render_manifest(&[("deadbeef".into(), "352441c2".into())], Crc32).unwrap();
    assert!(
        rendered.starts_with(';'),
        "SFV comments must use the standard semicolon prefix"
    );
}

#[test]
fn sfv_exports_preserve_comment_like_and_hexadecimal_file_names() {
    let root = tempfile::tempdir().unwrap();
    let names = [";important.bin", "#important.bin", "deadbeef  notes.txt"];
    let entries: Vec<_> = names
        .iter()
        .map(|name| {
            std::fs::write(root.path().join(name), b"abc").unwrap();
            (name.to_string(), "352441c2".to_string())
        })
        .collect();
    let rendered = render_manifest(&entries, Crc32).unwrap();
    let parsed = parse_manifest(&rendered, None).unwrap();
    assert_eq!(parsed.len(), 3);
    for (entry, name) in parsed.iter().zip(names) {
        assert_eq!(entry.hash, "352441c2");
        assert_eq!(
            resolve_entry(root.path(), &entry.name)
                .unwrap()
                .canonicalize()
                .unwrap(),
            root.path().join(name).canonicalize().unwrap()
        );
    }
}

#[test]
fn explicit_sfv_context_disambiguates_aligned_hexadecimal_names() {
    let parsed = parse_manifest("deadbeef  352441C2\n", Some(Crc32)).unwrap();
    assert_eq!(parsed[0].name, "deadbeef");
    assert_eq!(parsed[0].hash, "352441c2");
}
