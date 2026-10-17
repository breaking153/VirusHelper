use crate::commands::blocking;
use hash_core::{parse_manifest, resolve_entry, Algorithm, ChecksumTarget};
use serde::Serialize;
use std::{fs::File, io::Read, path::PathBuf};
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize)]
pub struct ManifestSelection {
    path: PathBuf,
    targets: Vec<ChecksumTarget>,
}

#[tauri::command]
pub async fn pick_files(app: AppHandle) -> Result<Vec<PathBuf>, String> {
    blocking(move || {
        app.dialog()
            .file()
            .set_title("添加需要计算哈希的文件")
            .blocking_pick_files()
            .unwrap_or_default()
            .into_iter()
            .map(|file| file.into_path().map_err(|e| e.to_string()))
            .collect()
    })
    .await
}

#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> Result<Option<PathBuf>, String> {
    blocking(move || {
        app.dialog()
            .file()
            .set_title("添加文件夹（包含子目录）")
            .blocking_pick_folder()
            .map(|file| file.into_path().map_err(|e| e.to_string()))
            .transpose()
    })
    .await
}

#[tauri::command]
pub async fn pick_manifest(
    app: AppHandle,
    hint: Option<Algorithm>,
) -> Result<Option<ManifestSelection>, String> {
    blocking(move || {
        let Some(file) = app
            .dialog()
            .file()
            .set_title("导入校验清单")
            .add_filter(
                "校验清单",
                &[
                    "sha256", "sha512", "sha1", "md5", "sfv", "blake3", "b3sum", "sha3", "xxh64",
                    "txt",
                ],
            )
            .add_filter("所有文件", &["*"])
            .blocking_pick_file()
        else {
            return Ok(None);
        };
        let path = file
            .into_path()
            .map_err(|e| e.to_string())?
            .canonicalize()
            .map_err(|e| e.to_string())?;
        let root = path.parent().ok_or("无法确定清单目录")?;
        let mut bytes = Vec::new();
        File::open(&path)
            .map_err(|e| e.to_string())?
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("清单超过 8 MiB，请分成较小的清单".into());
        }
        let text = String::from_utf8(bytes).map_err(|_| "清单须为 UTF-8 编码")?;
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let hint = hint.or(match ext.as_str() {
            "md5" => Some(Algorithm::Md5),
            "sha1" => Some(Algorithm::Sha1),
            "sha256" => Some(Algorithm::Sha256),
            "sha512" => Some(Algorithm::Sha512),
            "sfv" => Some(Algorithm::Crc32),
            "blake3" | "b3sum" => Some(Algorithm::Blake3),
            "sha3" => Some(Algorithm::Sha3_256),
            "xxh64" => Some(Algorithm::Xxh64),
            _ => None,
        });
        let entries = parse_manifest(&text, hint).map_err(|e| e.to_string())?;
        if entries.len() > 100_000 {
            return Err("单个清单最多包含 100,000 条记录".into());
        }
        let targets = entries
            .into_iter()
            .map(|entry| {
                Ok(ChecksumTarget {
                    path: resolve_entry(root, &entry.name).map_err(|e| e.to_string())?,
                    root: root.to_path_buf(),
                    algorithm: entry.algorithm,
                    hash: entry.hash,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Some(ManifestSelection { path, targets }))
    })
    .await
}
