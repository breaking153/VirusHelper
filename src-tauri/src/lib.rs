mod commands;
mod dialogs;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            dialogs::pick_files,
            dialogs::pick_folder,
            dialogs::pick_manifest,
            commands::run_job,
            commands::cancel_job,
            commands::export_results,
            commands::clear_results,
        ])
        .run(tauri::generate_context!())
        .expect("无法启动 VirusHelper");
}
