use crate::{Algorithm, HashError};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChecksumEntry {
    pub name: String,
    pub algorithm: Algorithm,
    pub hash: String,
}

pub fn parse_manifest(
    text: &str,
    hint: Option<Algorithm>,
) -> Result<Vec<ChecksumEntry>, HashError> {
    let mut entries = Vec::new();
    let mut algorithm_hint = hint;
    for (index, raw) in text.trim_start_matches('\u{feff}').lines().enumerate() {
        let line = raw.trim_end_matches('\r');
        let error =
            || HashError::InvalidInput(format!("清单第 {} 行格式无效或与所选算法不符", index + 1));
        if let Some(id) = line
            .strip_prefix("# VirusHelper algorithm: ")
            .or_else(|| line.strip_prefix("; VirusHelper algorithm: "))
        {
            algorithm_hint = Some(
                Algorithm::ALL
                    .into_iter()
                    .find(|a| a.id() == id.trim())
                    .ok_or_else(error)?,
            );
            continue;
        }
        if line.trim().is_empty() || line.starts_with(['#', ';']) {
            continue;
        }
        let (escaped, body) = line
            .strip_prefix('\\')
            .map_or((false, line), |body| (true, body));
        let split = body.find(char::is_whitespace).ok_or_else(error)?;
        let first = &body[..split];
        let remainder = &body[split..];
        let gnu_name = remainder
            .strip_prefix("  ")
            .or_else(|| remainder.strip_prefix(" *"));
        let sfv_entry = line
            .rsplit_once(char::is_whitespace)
            .filter(|(_, hash)| Algorithm::Crc32.valid_hash(hash));
        if algorithm_hint == Some(Algorithm::Crc32) {
            if let Some((name, hash)) = sfv_entry {
                let name = name.trim_end();
                if name.is_empty() || name.contains('\0') {
                    return Err(error());
                }
                entries.push(ChecksumEntry {
                    name: name.into(),
                    algorithm: Algorithm::Crc32,
                    hash: hash.to_ascii_lowercase(),
                });
                continue;
            }
        }
        let (name, hash, algorithm) =
            if first.bytes().all(|b| b.is_ascii_hexdigit()) && gnu_name.is_some() {
                let name = remainder
                    .strip_prefix("  ")
                    .or_else(|| remainder.strip_prefix(" *"))
                    .ok_or_else(error)?;
                let algorithm = algorithm_hint
                    .or(match first.len() {
                        8 => Some(Algorithm::Crc32),
                        16 => Some(Algorithm::Xxh64),
                        32 => Some(Algorithm::Md5),
                        40 => Some(Algorithm::Sha1),
                        64 => Some(Algorithm::Sha256),
                        128 => Some(Algorithm::Sha512),
                        _ => None,
                    })
                    .ok_or_else(error)?;
                let name = if escaped {
                    unescape_name(name).ok_or_else(error)?
                } else {
                    name.to_string()
                };
                (name, first, algorithm)
            } else {
                let (name, hash) = line.rsplit_once(char::is_whitespace).ok_or_else(error)?;
                (name.trim_end().to_string(), hash, Algorithm::Crc32)
            };
        if name.is_empty() || name.contains('\0') || !algorithm.valid_hash(hash) {
            return Err(error());
        }
        entries.push(ChecksumEntry {
            name,
            algorithm,
            hash: hash.to_ascii_lowercase(),
        });
    }
    if entries.is_empty() {
        return Err(HashError::InvalidInput("清单中没有可用的校验条目".into()));
    }
    Ok(entries)
}

fn unescape_name(name: &str) -> Option<String> {
    let mut decoded = String::new();
    let mut chars = name.chars();
    while let Some(c) = chars.next() {
        decoded.push(if c == '\\' {
            match chars.next()? {
                '\\' => '\\',
                'n' => '\n',
                'r' => '\r',
                _ => return None,
            }
        } else {
            c
        });
    }
    Some(decoded)
}

pub fn render_manifest(
    entries: &[(String, String)],
    algorithm: Algorithm,
) -> Result<String, HashError> {
    let comment = if algorithm == Algorithm::Crc32 {
        ';'
    } else {
        '#'
    };
    let mut text = format!("{comment} VirusHelper algorithm: {}\n", algorithm.id());
    for (name, hash) in entries {
        if name.is_empty() || name.contains('\0') || !algorithm.valid_hash(hash) {
            return Err(HashError::InvalidInput("无法导出无效的文件名或哈希".into()));
        }
        if algorithm == Algorithm::Crc32 {
            if name.contains(['\r', '\n']) || name.chars().last().is_some_and(char::is_whitespace) {
                return Err(HashError::InvalidInput(
                    "SFV 不支持文件名中的换行或末尾空白，请选择其他算法导出".into(),
                ));
            }
            // Prevent comment-like and all-hex filenames from being interpreted as syntax.
            text.push_str(&format!("./{name} {}\n", hash.to_ascii_uppercase()));
        } else {
            let escaped = name.contains(['\\', '\n', '\r']);
            let encoded = name
                .replace('\\', "\\\\")
                .replace('\n', "\\n")
                .replace('\r', "\\r");
            text.push_str(&format!(
                "{}{hash}  {encoded}\n",
                if escaped { "\\" } else { "" }
            ));
        }
    }
    Ok(text)
}

/// Resolve an untrusted manifest name without permitting reads outside its root.
/// Also checks the deepest existing ancestor, covering missing files below a symlink.
pub fn resolve_entry(root: &Path, name: &str) -> Result<PathBuf, HashError> {
    let invalid = || HashError::InvalidInput(format!("清单路径不安全或越出清单目录：{name}"));
    if name.is_empty()
        || name.contains(['\0', ':'])
        || name.starts_with(['/', '\\'])
        || name.split(['/', '\\']).any(|part| part == "..")
    {
        return Err(invalid());
    }
    let root = root.canonicalize()?;
    let candidate = root.join(name);
    let mut ancestor = candidate.as_path();
    loop {
        match ancestor.canonicalize() {
            Ok(resolved) => {
                if !resolved.starts_with(&root) {
                    return Err(invalid());
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                ancestor = ancestor.parent().ok_or_else(invalid)?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    Ok(candidate)
}
