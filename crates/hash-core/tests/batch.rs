use hash_core::{run_batch, Algorithm::*, ChecksumTarget, FileStatus, JobEvent, JobRequest};
use std::sync::atomic::{AtomicBool, Ordering};

fn request(paths: Vec<std::path::PathBuf>) -> JobRequest {
    JobRequest {
        paths,
        algorithms: vec![Sha256],
        checksums: vec![],
    }
}

#[test]
fn recursively_discovers_and_deduplicates_overlapping_inputs() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("nested")).unwrap();
    std::fs::write(root.path().join("a"), b"abc").unwrap();
    std::fs::write(root.path().join("nested/b"), b"1234").unwrap();
    let mut total_bytes = 0;
    let summary = run_batch(
        request(vec![root.path().into(), root.path().join("a")]),
        &AtomicBool::new(false),
        |event| {
            if let JobEvent::Discovered {
                total_bytes: total, ..
            } = event
            {
                total_bytes = total;
            }
        },
    )
    .unwrap();
    assert_eq!(
        (
            summary.total,
            summary.completed,
            summary.errors,
            total_bytes
        ),
        (2, 2, 0, 7)
    );
}

#[test]
fn missing_file_does_not_stop_the_next_file() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("z-good"), b"abc").unwrap();
    let summary = run_batch(
        request(vec![
            root.path().join("a-missing"),
            root.path().join("z-good"),
        ]),
        &AtomicBool::new(false),
        |_| {},
    )
    .unwrap();
    assert_eq!((summary.completed, summary.errors), (1, 1));
    assert!(summary
        .results
        .iter()
        .any(|r| r.status == FileStatus::Error && r.error.is_some()));
}

#[test]
fn checksum_algorithm_is_added_and_mismatch_is_reported() {
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("abc");
    std::fs::write(&path, b"abc").unwrap();
    let mut req = request(vec![path.clone()]);
    req.checksums = vec![ChecksumTarget {
        path,
        root: root.path().into(),
        algorithm: Md5,
        hash: "00000000000000000000000000000000".into(),
    }];
    let summary = run_batch(req, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(summary.mismatched, 1);
    assert_eq!(
        summary.results[0].hashes[&Md5],
        "900150983cd24fb0d6963f7d28e17f72"
    );
    assert!(!summary.results[0].checks[0].matches);
}

#[test]
fn cancelling_preserves_completed_files_and_marks_the_remaining_ones() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a"), b"abc").unwrap();
    std::fs::write(root.path().join("b"), b"abc").unwrap();
    let cancel = AtomicBool::new(false);
    let summary = run_batch(request(vec![root.path().into()]), &cancel, |event| {
        if matches!(event, JobEvent::File { ref result } if result.status == FileStatus::Complete) {
            cancel.store(true, Ordering::Relaxed);
        }
    })
    .unwrap();
    assert!(summary.cancelled);
    assert_eq!(summary.completed, 1);
    assert_eq!(
        summary
            .results
            .iter()
            .filter(|r| r.status == FileStatus::Cancelled)
            .count(),
        1
    );
}

#[test]
fn rejects_conflicting_expectations_and_invalid_requests() {
    assert!(run_batch(request(vec![]), &AtomicBool::new(false), |_| {}).is_err());
    let root = tempfile::tempdir().unwrap();
    let path = root.path().join("abc");
    std::fs::write(&path, b"abc").unwrap();
    let mut req = request(vec![path.clone()]);
    req.checksums = vec![
        ChecksumTarget {
            path: path.clone(),
            root: root.path().into(),
            algorithm: Md5,
            hash: "900150983cd24fb0d6963f7d28e17f72".into(),
        },
        ChecksumTarget {
            path,
            root: root.path().into(),
            algorithm: Md5,
            hash: "00000000000000000000000000000000".into(),
        },
    ];
    assert!(run_batch(req, &AtomicBool::new(false), |_| {}).is_err());
}

#[test]
fn a_manifest_directory_entry_is_an_error_instead_of_unchecked_children() {
    let root = tempfile::tempdir().unwrap();
    let folder = root.path().join("folder");
    std::fs::create_dir(&folder).unwrap();
    std::fs::write(folder.join("child.txt"), b"abc").unwrap();
    let mut req = request(vec![folder.clone()]);
    req.checksums = vec![ChecksumTarget {
        path: folder,
        root: root.path().into(),
        algorithm: Md5,
        hash: "900150983cd24fb0d6963f7d28e17f72".into(),
    }];
    let summary = run_batch(req, &AtomicBool::new(false), |_| {}).unwrap();
    assert_eq!(
        (summary.total, summary.errors, summary.completed),
        (1, 1, 0)
    );
    assert_eq!(summary.results[0].status, FileStatus::Error);
}

#[test]
fn detects_content_formats_for_renamed_and_extensionless_files_and_serializes_them() {
    let root = tempfile::tempdir().unwrap();
    let png = b"\x89PNG\r\n\x1a\n";
    let files: [(&str, &[u8], &str); 5] = [
        ("picture.txt", png, "PNG"),
        ("no-extension", png, "PNG"),
        ("text.exe", "文件内容是文本\n".as_bytes(), "UTF-8 文本"),
        ("unknown.png", &[0, 1, 2, 3, 0xff], "未知格式"),
        ("empty.pdf", b"", "空文件"),
    ];
    for (name, bytes, _) in &files {
        std::fs::write(root.path().join(name), bytes).unwrap();
    }
    let mut streamed = Vec::new();
    let summary = run_batch(
        request(vec![root.path().into()]),
        &AtomicBool::new(false),
        |event| {
            if let JobEvent::File { result } = event {
                streamed.push(serde_json::to_value(result).unwrap());
            }
        },
    )
    .unwrap();
    assert_eq!((summary.completed, summary.errors), (5, 0));
    for (name, _, expected) in files {
        let result = summary.results.iter().find(|r| r.name == name).unwrap();
        assert_eq!(result.file_format.as_deref(), Some(expected));
        let event = streamed.iter().find(|r| r["name"] == name).unwrap();
        assert_eq!(event["fileFormat"], expected);
        assert!(!result.hashes[&Sha256].is_empty());
    }
    let renamed = summary
        .results
        .iter()
        .find(|r| r.name == "picture.txt")
        .unwrap();
    let bare = summary
        .results
        .iter()
        .find(|r| r.name == "no-extension")
        .unwrap();
    assert_eq!(renamed.hashes, bare.hashes);
}
