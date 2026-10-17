mod algorithm;
mod batch;
mod export;
mod hashing;
mod manifest;

pub use algorithm::Algorithm;
pub use batch::{
    run_batch, ChecksumTarget, DiscoveredFile, FileResult, FileStatus, HashCheck, JobEvent,
    JobRequest, JobSummary,
};
pub use export::write_manifest;
pub use hashing::{hash_file, hash_reader};
pub use manifest::{parse_manifest, render_manifest, resolve_entry, ChecksumEntry};

#[derive(Debug, thiserror::Error)]
pub enum HashError {
    #[error("读取失败：{0}")]
    Io(#[from] std::io::Error),
    #[error("任务已取消")]
    Cancelled,
    #[error("计算期间文件发生变化，请重新计算")]
    Changed,
    #[error("{0}")]
    InvalidInput(String),
}
