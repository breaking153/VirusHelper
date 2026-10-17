use crate::{render_manifest, Algorithm, FileResult, FileStatus, HashError};
use std::{io::Write, path::Path};

/// Validate every entry before writing, and replace the destination atomically.
pub fn write_manifest(
    results: &[FileResult],
    destination: &Path,
    algorithm: Algorithm,
) -> Result<usize, HashError> {
    let parent = destination
        .parent()
        .ok_or_else(|| HashError::InvalidInput("请选择有效的保存位置".into()))?
        .canonicalize()?;
    let file_name = destination
        .file_name()
        .ok_or_else(|| HashError::InvalidInput("缺少清单文件名".into()))?;
    let output = parent.join(file_name);
    let output_key = output.canonicalize().unwrap_or_else(|_| output.clone());
    let mut entries = Vec::new();
    for result in results {
        let source = result
            .path
            .canonicalize()
            .unwrap_or_else(|_| result.path.clone());
        if source == output_key {
            return Err(HashError::InvalidInput(
                "校验清单不能覆盖源文件，请使用其他文件名".into(),
            ));
        }
        if result.status != FileStatus::Complete {
            continue;
        }
        let Some(hash) = result.hashes.get(&algorithm) else {
            continue;
        };
        let relative = source.strip_prefix(&parent).map_err(|_| {
            HashError::InvalidInput(
                "请将清单保存到所有源文件的共同上级目录，以生成可移植的相对路径".into(),
            )
        })?;
        // Join components rather than replacing backslashes: Unix filenames may contain them.
        let name = relative
            .components()
            .map(|c| {
                c.as_os_str()
                    .to_str()
                    .ok_or_else(|| HashError::InvalidInput("清单仅支持 UTF-8 文件名".into()))
            })
            .collect::<Result<Vec<_>, _>>()?
            .join("/");
        entries.push((name, hash.clone()));
    }
    if entries.is_empty() {
        return Err(HashError::InvalidInput(
            "没有可导出的已完成结果，请先计算所选算法".into(),
        ));
    }
    let text = render_manifest(&entries, algorithm)?;
    let mut temp = tempfile::NamedTempFile::new_in(&parent)?;
    temp.write_all(text.as_bytes())?;
    temp.as_file().sync_all()?;
    temp.persist(&output)
        .map_err(|error| HashError::Io(error.error))?;
    Ok(entries.len())
}
