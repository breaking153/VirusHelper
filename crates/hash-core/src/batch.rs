use crate::{hash_file, resolve_entry, Algorithm, HashError};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};
use walkdir::WalkDir;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecksumTarget {
    pub path: PathBuf,
    pub root: PathBuf,
    pub algorithm: Algorithm,
    pub hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobRequest {
    pub paths: Vec<PathBuf>,
    pub algorithms: Vec<Algorithm>,
    #[serde(default)]
    pub checksums: Vec<ChecksumTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredFile {
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Complete,
    Error,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashCheck {
    pub algorithm: Algorithm,
    pub expected: String,
    pub actual: String,
    pub matches: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileResult {
    pub path: PathBuf,
    pub name: String,
    pub size: u64,
    pub status: FileStatus,
    pub hashes: BTreeMap<Algorithm, String>,
    pub checks: Vec<HashCheck>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "type",
    rename_all = "lowercase",
    rename_all_fields = "camelCase"
)]
pub enum JobEvent {
    Discovered {
        files: Vec<DiscoveredFile>,
        total_bytes: u64,
    },
    Progress {
        path: PathBuf,
        bytes_processed: u64,
        file_bytes: u64,
        total_bytes: u64,
        index: usize,
        total: usize,
    },
    File {
        result: FileResult,
    },
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSummary {
    pub total: usize,
    pub completed: usize,
    pub errors: usize,
    pub matched: usize,
    pub mismatched: usize,
    pub cancelled: bool,
    pub elapsed_ms: u64,
    pub results: Vec<FileResult>,
}

fn path_key(path: &Path) -> PathBuf {
    path.canonicalize().unwrap_or_else(|_| path.to_path_buf())
}

fn discover(
    paths: &[PathBuf],
    file_only: &BTreeSet<PathBuf>,
    cancel: &AtomicBool,
) -> Result<Vec<DiscoveredFile>, HashError> {
    let mut found = BTreeMap::new();
    let mut insert = |path: &Path, error: Option<String>| -> Result<(), HashError> {
        let path = path_key(path);
        let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        found.entry(path.clone()).or_insert(DiscoveredFile {
            path,
            name,
            size,
            error,
        });
        if found.len() > 100_000 {
            return Err(HashError::InvalidInput(
                "单批次最多处理 100,000 个文件，请缩小选择范围".into(),
            ));
        }
        Ok(())
    };
    for path in paths {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        match std::fs::metadata(path) {
            Ok(meta) if meta.is_dir() && !file_only.contains(&path_key(path)) => {
                for entry in WalkDir::new(path).follow_links(false).min_depth(1) {
                    if cancel.load(Ordering::Relaxed) {
                        break;
                    }
                    match entry {
                        Ok(entry) if entry.file_type().is_file() => insert(entry.path(), None)?,
                        Err(error) => {
                            insert(error.path().unwrap_or(path), Some(error.to_string()))?
                        }
                        _ => {}
                    }
                }
            }
            Ok(meta) if meta.is_file() => insert(path, None)?,
            Ok(_) => insert(
                path,
                Some("校验条目必须指向常规文件，不能是文件夹或特殊文件".into()),
            )?,
            Err(error) => insert(path, Some(error.to_string()))?,
        }
    }
    Ok(found.into_values().collect())
}

pub fn run_batch(
    request: JobRequest,
    cancel: &AtomicBool,
    mut emit: impl FnMut(JobEvent),
) -> Result<JobSummary, HashError> {
    if request.paths.is_empty() || request.paths.len() > 100_000 || request.algorithms.is_empty() {
        return Err(HashError::InvalidInput(
            "请选择文件及至少一种哈希算法（单批次最多 100,000 项）".into(),
        ));
    }
    let started = Instant::now();
    let mut expected: BTreeMap<PathBuf, BTreeMap<Algorithm, String>> = BTreeMap::new();
    let mut algorithms: BTreeSet<_> = request.algorithms.into_iter().collect();
    for target in &request.checksums {
        if !target.algorithm.valid_hash(&target.hash) {
            return Err(HashError::InvalidInput("清单包含无效哈希".into()));
        }
        let root = target.root.canonicalize()?;
        let relative = target
            .path
            .strip_prefix(&root)
            .or_else(|_| target.path.strip_prefix(&target.root))
            .map_err(|_| HashError::InvalidInput("校验目标不在清单目录内".into()))?;
        resolve_entry(&root, &relative.to_string_lossy())?;
        let hashes = expected.entry(path_key(&target.path)).or_default();
        if let Some(previous) = hashes.insert(target.algorithm, target.hash.to_ascii_lowercase()) {
            if !previous.eq_ignore_ascii_case(&target.hash) {
                return Err(HashError::InvalidInput(
                    "清单中同一个文件存在冲突的预期哈希".into(),
                ));
            }
        }
        algorithms.insert(target.algorithm);
    }
    let files = discover(&request.paths, &expected.keys().cloned().collect(), cancel)?;
    let total_bytes = files.iter().fold(0_u64, |n, f| n.saturating_add(f.size));
    let mut summary = JobSummary {
        total: files.len(),
        ..Default::default()
    };
    emit(JobEvent::Discovered {
        files: files.clone(),
        total_bytes,
    });
    let algorithms: Vec<_> = algorithms.into_iter().collect();
    let mut finished_bytes = 0_u64;
    let mut last_progress = Instant::now() - Duration::from_secs(1);
    for (index, file) in files.into_iter().enumerate() {
        let mut result = FileResult {
            path: file.path.clone(),
            name: file.name,
            size: file.size,
            status: FileStatus::Complete,
            hashes: BTreeMap::new(),
            checks: vec![],
            error: None,
        };
        let hashes = if cancel.load(Ordering::Relaxed) {
            Err(HashError::Cancelled)
        } else if let Some(error) = file.error {
            Err(HashError::InvalidInput(error))
        } else {
            hash_file(&file.path, &algorithms, cancel, |bytes| {
                if last_progress.elapsed() >= Duration::from_millis(80) || bytes >= file.size {
                    emit(JobEvent::Progress {
                        path: file.path.clone(),
                        bytes_processed: finished_bytes.saturating_add(bytes.min(file.size)),
                        file_bytes: bytes,
                        total_bytes,
                        index,
                        total: summary.total,
                    });
                    last_progress = Instant::now();
                }
            })
        };
        match hashes {
            Ok(hashes) => {
                result.hashes = hashes;
                if let Some(checks) = expected.get(&file.path) {
                    result.checks = checks
                        .iter()
                        .map(|(algorithm, expected)| {
                            let actual = result.hashes[algorithm].clone();
                            HashCheck {
                                algorithm: *algorithm,
                                matches: actual.eq_ignore_ascii_case(expected),
                                actual,
                                expected: expected.clone(),
                            }
                        })
                        .collect();
                    if result.checks.iter().all(|check| check.matches) {
                        summary.matched += 1;
                    } else {
                        summary.mismatched += 1;
                    }
                }
                summary.completed += 1;
            }
            Err(HashError::Cancelled) => {
                result.status = FileStatus::Cancelled;
                summary.cancelled = true;
            }
            Err(error) => {
                result.status = FileStatus::Error;
                result.error = Some(error.to_string());
                summary.errors += 1;
            }
        }
        finished_bytes = finished_bytes.saturating_add(file.size);
        emit(JobEvent::File {
            result: result.clone(),
        });
        summary.results.push(result);
    }
    summary.cancelled |= cancel.load(Ordering::Relaxed);
    summary.elapsed_ms = started.elapsed().as_millis().min(u64::MAX as u128) as u64;
    Ok(summary)
}
