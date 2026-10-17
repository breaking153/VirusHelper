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

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::{
        test::{mock_builder, mock_context, noop_assets, MockRuntime},
        Manager,
    };

    fn app() -> tauri::App<MockRuntime> {
        mock_builder()
            .manage(AppState::default())
            .build(mock_context(noop_assets()))
            .unwrap()
    }

    #[test]
    fn native_job_streams_serialized_results_and_stores_only_computed_hashes() {
        let app = app();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("abc.txt");
        std::fs::write(&path, b"abc").unwrap();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        let channel = Channel::new(move |message| {
            captured
                .lock()
                .unwrap()
                .push(message.deserialize::<serde_json::Value>().unwrap());
            Ok(())
        });
        let summary = tauri::async_runtime::block_on(run_job(
            app.state(),
            JobRequest {
                paths: vec![path],
                algorithms: vec![Algorithm::Sha256],
                checksums: vec![],
            },
            channel,
        ))
        .unwrap();
        assert_eq!(summary.completed, 1);
        let events = events.lock().unwrap();
        assert_eq!(events[0]["type"], "discovered");
        assert_eq!(events[0]["totalBytes"], 3);
        let file = events.iter().find(|event| event["type"] == "file").unwrap();
        assert_eq!(
            file["result"]["hashes"]["sha256"],
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        assert_eq!(app.state::<AppState>().0.lock().unwrap().results.len(), 1);
        clear_results(app.state()).unwrap();
        assert!(app.state::<AppState>().0.lock().unwrap().results.is_empty());
    }

    #[test]
    fn active_job_cannot_be_overwritten_or_cleared_and_can_be_cancelled() {
        let app = app();
        let token = Arc::new(AtomicBool::new(false));
        app.state::<AppState>().0.lock().unwrap().active = Some(token.clone());
        let error = tauri::async_runtime::block_on(run_job(
            app.state(),
            JobRequest {
                paths: vec![],
                algorithms: vec![],
                checksums: vec![],
            },
            Channel::new(|_| Ok(())),
        ))
        .unwrap_err();
        assert!(error.contains("已有任务"));
        assert!(clear_results(app.state()).is_err());
        cancel_job(app.state()).unwrap();
        assert!(token.load(Ordering::Relaxed));
    }

    #[test]
    fn invalid_requests_release_the_native_job_lock() {
        let app = app();
        let failed = tauri::async_runtime::block_on(run_job(
            app.state(),
            JobRequest {
                paths: vec![],
                algorithms: vec![],
                checksums: vec![],
            },
            Channel::new(|_| Ok(())),
        ));
        assert!(failed.is_err());
        assert!(app.state::<AppState>().0.lock().unwrap().active.is_none());
        clear_results(app.state()).unwrap();
    }
}
