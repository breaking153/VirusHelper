use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VtError {
    pub code: String,
    pub message: String,
    pub retry_after_seconds: Option<u64>,
}

impl VtError {
    pub fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retry_after_seconds: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VtSettings {
    pub configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VtReport {
    pub hash: String,
    pub status: String,
    pub malicious: u64,
    pub suspicious: u64,
    pub total: u64,
    pub last_analysis_date: Option<u64>,
}

pub fn decode_report(hash: &str, bytes: &[u8]) -> Result<VtReport, VtError> {
    #[derive(Deserialize)]
    struct Envelope {
        data: File,
    }
    #[derive(Deserialize)]
    struct File {
        id: String,
        #[serde(rename = "type")]
        kind: String,
        attributes: Attributes,
    }
    #[derive(Deserialize)]
    struct Attributes {
        last_analysis_date: Option<u64>,
        last_analysis_stats: Option<std::collections::HashMap<String, u64>>,
    }
    let invalid = || VtError::new("invalid-response", "VT 返回了无法识别的文件报告");
    let response: Envelope = serde_json::from_slice(bytes).map_err(|_| invalid())?;
    let file = response.data;
    let id = crate::validate_hash(&file.id).map_err(|_| invalid())?;
    if file.kind != "file" || id.len() != 64 || (hash.len() == 64 && id != hash) {
        return Err(invalid());
    }
    let stats = file.attributes.last_analysis_stats.unwrap_or_default();
    let total = stats
        .values()
        .try_fold(0u64, |sum, n| sum.checked_add(*n))
        .ok_or_else(invalid)?;
    Ok(VtReport {
        hash: hash.into(),
        status: if total == 0 { "pending" } else { "found" }.into(),
        malicious: *stats.get("malicious").unwrap_or(&0),
        suspicious: *stats.get("suspicious").unwrap_or(&0),
        total,
        last_analysis_date: file.attributes.last_analysis_date,
    })
}
