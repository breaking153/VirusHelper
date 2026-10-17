mod algorithm;
mod hashing;

pub use algorithm::Algorithm;
pub use hashing::{hash_file, hash_reader};

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
