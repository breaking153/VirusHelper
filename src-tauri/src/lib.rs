mod commands;
mod credentials;
mod dialogs;
mod startup;
mod virustotal;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(startup::StartupPaths(startup::paths_from_args(
            std::env::args_os().skip(1),
        )))
        .manage(commands::AppState::default())
        .manage(std::sync::Arc::new(
            credentials::VtState::new().expect("无法初始化 VT 客户端"),
        ))
        .invoke_handler(tauri::generate_handler![
            startup::get_startup_paths,
            dialogs::pick_files,
            dialogs::pick_folder,
            dialogs::pick_manifest,
            commands::run_job,
            commands::cancel_job,
            commands::export_results,
            commands::clear_results,
            virustotal::get_vt_settings,
            virustotal::set_vt_api_key,
            virustotal::lookup_vt,
            virustotal::open_vt_page,
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 VirusHelper");
}
