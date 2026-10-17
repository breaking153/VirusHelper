use hash_core::{
    run_batch, write_manifest, Algorithm, FileResult, JobEvent, JobRequest, JobSummary,
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_dialog::DialogExt;

#[derive(Default)]
struct Session {
    active: Option<Arc<AtomicBool>>,
    results: Vec<FileResult>,
}

#[derive(Default)]
pub struct AppState(Mutex<Session>);

pub async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("后台任务异常：{e}"))?
}

#[tauri::command]
pub async fn run_job(
    state: State<'_, AppState>,
    request: JobRequest,
    on_event: Channel<JobEvent>,
) -> Result<JobSummary, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut session = state.0.lock().map_err(|_| "任务状态不可用")?;
        if session.active.is_some() {
            return Err("已有任务正在运行，请先等待或取消".into());
        }
        session.active = Some(cancel.clone());
        session.results.clear();
    }
    let result = blocking(move || {
        run_batch(request, &cancel, |event| {
            if on_event.send(event).is_err() {
                cancel.store(true, Ordering::Relaxed);
            }
        })
        .map_err(|e| e.to_string())
    })
    .await;
    let mut session = state.0.lock().map_err(|_| "任务状态不可用")?;
    session.active = None;
    if let Ok(summary) = &result {
        session.results = summary.results.clone();
    }
    result
}

#[tauri::command]
pub fn cancel_job(state: State<'_, AppState>) -> Result<(), String> {
    let session = state.0.lock().map_err(|_| "任务状态不可用")?;
    if let Some(cancel) = &session.active {
        cancel.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub fn clear_results(state: State<'_, AppState>) -> Result<(), String> {
    let mut session = state.0.lock().map_err(|_| "任务状态不可用")?;
    if session.active.is_some() {
        return Err("计算期间不能清空结果".into());
    }
    session.results.clear();
    Ok(())
}

fn common_parent(results: &[FileResult]) -> Option<PathBuf> {
    let mut parents = results
        .iter()
        .filter(|r| !r.hashes.is_empty())
        .filter_map(|r| r.path.parent());
    let mut parent = parents.next()?.to_path_buf();
    for other in parents {
        while !other.starts_with(&parent) {
            if !parent.pop() {
                return None;
            }
        }
    }
    Some(parent)
}

#[tauri::command]
pub async fn export_results(
    app: AppHandle,
    state: State<'_, AppState>,
    algorithm: Algorithm,
) -> Result<Option<PathBuf>, String> {
    let results = {
        let session = state.0.lock().map_err(|_| "任务状态不可用")?;
        if session.active.is_some() {
            return Err("请等待计算完成再导出".into());
        }
        if !session
            .results
            .iter()
            .any(|r| r.hashes.contains_key(&algorithm))
        {
            return Err("没有该算法的已完成结果".into());
        }
        session.results.clone()
    };
    blocking(move || {
        let extension = if algorithm == Algorithm::Crc32 {
            "sfv"
        } else {
            algorithm.id()
        };
        let mut dialog = app
            .dialog()
            .file()
            .set_title("导出校验清单到源文件的共同上级目录")
            .set_file_name(format!("checksums.{extension}"))
            .add_filter("校验清单", &[extension]);
        if let Some(parent) = common_parent(&results) {
            dialog = dialog.set_directory(parent);
        }
        let Some(file) = dialog.blocking_save_file() else {
            return Ok(None);
        };
        let destination = file.into_path().map_err(|e| e.to_string())?;
        write_manifest(&results, &destination, algorithm).map_err(|e| e.to_string())?;
        Ok(Some(destination))
    })
    .await
}
