mod commands;
mod dialogs;
mod virustotal;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::AppState::default())
        .manage(vt_client::VtClient::new().expect("无法初始化 VT 客户端"))
        .invoke_handler(tauri::generate_handler![
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
