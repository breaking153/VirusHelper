use serde::Deserialize;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use vt_client::{validate_hash, VtClient, VtError, VtReport, VtSettings};

#[tauri::command]
pub fn get_vt_settings(client: State<'_, VtClient>) -> Result<VtSettings, VtError> {
    client.settings()
}

#[tauri::command]
pub fn set_vt_api_key(client: State<'_, VtClient>, key: String) -> Result<VtSettings, VtError> {
    client.set_api_key(key)
}

#[tauri::command]
pub async fn lookup_vt(client: State<'_, VtClient>, hash: String) -> Result<VtReport, VtError> {
    client.lookup(&hash).await
}

#[derive(Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VtPage {
    Report,
    ApiKey,
    Docs,
}

fn page_url(page: VtPage, hash: Option<&str>) -> Result<String, VtError> {
    Ok(match page {
        VtPage::Report => format!(
            "https://www.virustotal.com/gui/file/{}",
            validate_hash(hash.unwrap_or_default())?
        ),
        VtPage::ApiKey => "https://www.virustotal.com/gui/my-apikey".into(),
        VtPage::Docs => "https://docs.virustotal.com/reference/public-vs-premium-api".into(),
    })
}

#[tauri::command]
pub fn open_vt_page(app: AppHandle, page: VtPage, hash: Option<String>) -> Result<(), VtError> {
    let url = page_url(page, hash.as_deref())?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| VtError::new("open-error", "无法打开浏览器，请检查默认浏览器设置"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::{
        test::{mock_builder, mock_context, noop_assets},
        Manager,
    };

    #[test]
    fn native_settings_never_return_key_and_lookup_rejects_unconfigured_sessions() {
        let app = mock_builder()
            .manage(VtClient::new().unwrap())
            .build(mock_context(noop_assets()))
            .unwrap();
        let key = "a".repeat(64);
        let settings = set_vt_api_key(app.state(), key.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(settings).unwrap(),
            serde_json::json!({"configured": true})
        );
        assert!(get_vt_settings(app.state()).unwrap().configured);
        set_vt_api_key(app.state(), String::new()).unwrap();
        let error =
            tauri::async_runtime::block_on(lookup_vt(app.state(), "b".repeat(64))).unwrap_err();
        let serialized = serde_json::to_value(error).unwrap();
        assert_eq!(serialized["code"], "missing-key");
        assert!(serialized.get("retryAfterSeconds").is_some());
        assert!(!serialized.to_string().contains(&key));
    }

    #[test]
    fn browser_destinations_are_fixed_and_hash_cannot_inject_a_url() {
        let hash = "a".repeat(64);
        assert_eq!(
            page_url(VtPage::Report, Some(&hash)).unwrap(),
            format!("https://www.virustotal.com/gui/file/{hash}")
        );
        for input in ["https://evil.example", "../../other", "abc?key=secret", ""] {
            assert!(page_url(VtPage::Report, Some(input)).is_err());
        }
        assert_eq!(
            page_url(VtPage::ApiKey, None).unwrap(),
            "https://www.virustotal.com/gui/my-apikey"
        );
    }
}
