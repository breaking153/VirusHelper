use hash_core::{parse_manifest, run_batch, write_manifest, Algorithm::*, JobRequest};
use std::sync::atomic::AtomicBool;

#[test]
fn exports_relative_paths_that_can_be_verified_again() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("nested")).unwrap();
    let source = dir.path().join("nested/中文 abc.bin");
    std::fs::write(&source, b"abc").unwrap();
    let summary = run_batch(
        JobRequest {
            paths: vec![source],
            algorithms: vec![Sha256],
            checksums: vec![],
        },
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    let destination = dir.path().join("checksums.sha256");
    assert_eq!(
        write_manifest(&summary.results, &destination, Sha256).unwrap(),
        1
    );
    let entries = parse_manifest(&std::fs::read_to_string(destination).unwrap(), None).unwrap();
    assert_eq!(entries[0].name, "nested/中文 abc.bin");
    assert_eq!(
        entries[0].hash,
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn rejects_overwriting_inputs_and_saving_outside_the_common_parent() {
    let dir = tempfile::tempdir().unwrap();
    let elsewhere = tempfile::tempdir().unwrap();
    let source = dir.path().join("abc");
    std::fs::write(&source, b"abc").unwrap();
    let summary = run_batch(
        JobRequest {
            paths: vec![source.clone()],
            algorithms: vec![Sha256],
            checksums: vec![],
        },
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert!(write_manifest(&summary.results, &source, Sha256).is_err());
    assert_eq!(std::fs::read(source).unwrap(), b"abc");
    assert!(write_manifest(
        &summary.results,
        &elsewhere.path().join("checksums.sha256"),
        Sha256
    )
    .is_err());
    assert!(!elsewhere.path().join("checksums.sha256").exists());
}
