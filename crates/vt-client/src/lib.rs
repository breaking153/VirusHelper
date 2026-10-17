mod client;
mod report;
pub use client::VtClient;
pub use report::{decode_report, VtError, VtReport, VtSettings};

pub fn validate_hash(hash: &str) -> Result<String, VtError> {
    if !matches!(hash.len(), 32 | 40 | 64) || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(VtError::new(
            "invalid-input",
            "VT 查询需要 MD5、SHA-1 或 SHA-256 哈希",
        ));
    }
    Ok(hash.to_ascii_lowercase())
}
