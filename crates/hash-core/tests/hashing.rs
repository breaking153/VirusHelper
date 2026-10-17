use hash_core::{hash_file, hash_reader, Algorithm::*, HashError};
use std::{
    io::Cursor,
    sync::atomic::{AtomicBool, Ordering},
};

#[test]
fn hashes_abc_with_all_eight_standard_algorithms() {
    let vectors = [
        (Md5, "900150983cd24fb0d6963f7d28e17f72"),
        (Sha1, "a9993e364706816aba3e25717850c26c9cd0d89d"),
        (Sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
        (Sha512, "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f"),
        (Sha3_256, "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532"),
        (Blake3, "6437b3ac38465133ffb63b75273a8db548c558465d79db03fd359c6cd5bd9d85"),
        (Crc32, "352441c2"),
        (Xxh64, "44bc2cf5ad770999"),
    ];
    let algorithms: Vec<_> = vectors.iter().map(|(a, _)| *a).collect();
    let mut progress = Vec::new();
    let hashes = hash_reader(
        Cursor::new(b"abc"),
        &algorithms,
        &AtomicBool::new(false),
        |n| progress.push(n),
    )
    .unwrap();
    for (algorithm, expected) in vectors {
        assert_eq!(hashes[&algorithm], expected, "{algorithm:?}");
    }
    assert_eq!(progress.last(), Some(&3));
}

#[test]
fn hashes_an_empty_file() {
    let hashes = hash_reader(Cursor::new([]), &[Sha256], &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(
        hashes[&Sha256],
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn cancels_between_chunks_without_finishing_the_file() {
    let cancel = AtomicBool::new(false);
    let mut read = 0;
    let result = hash_reader(
        Cursor::new(vec![7; 3 * 1024 * 1024]),
        &[Sha256],
        &cancel,
        |n| {
            read = n;
            cancel.store(true, Ordering::Relaxed);
        },
    );
    assert!(matches!(result, Err(HashError::Cancelled)));
    assert!(read > 0 && read < 3 * 1024 * 1024);
}

#[test]
fn rejects_no_algorithms() {
    assert!(matches!(
        hash_reader(Cursor::new(b"abc"), &[], &AtomicBool::new(false), |_| {}),
        Err(HashError::InvalidInput(_))
    ));
}

#[test]
fn detects_a_file_changed_while_hashing() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("changed.bin");
    std::fs::write(&path, b"abc").unwrap();
    let mut changed = false;
    let result = hash_file(&path, &[Sha256], &AtomicBool::new(false), |_| {
        if !changed {
            std::fs::write(&path, b"changed contents").unwrap();
            changed = true;
        }
    });
    assert!(matches!(result, Err(HashError::Changed)));
}
