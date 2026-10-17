use crate::credentials::VtState;
use serde::Deserialize;
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use vt_client::{validate_hash, VtError, VtReport, VtSettings};
use zeroize::Zeroizing;

async fn credential_task<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, VtError> + Send + 'static,
) -> Result<T, VtError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| VtError::new("credential-store", "系统凭据操作失败，请重试"))?
}

#[tauri::command]
pub async fn get_vt_settings(state: State<'_, Arc<VtState>>) -> Result<VtSettings, VtError> {
    let state = state.inner().clone();
    credential_task(move || state.settings()).await
}

#[tauri::command]
pub async fn set_vt_api_key(
    state: State<'_, Arc<VtState>>,
    key: String,
) -> Result<VtSettings, VtError> {
    let key = Zeroizing::new(key);
    let state = state.inner().clone();
    credential_task(move || state.set_api_key(key)).await
}

#[tauri::command]
pub async fn lookup_vt(state: State<'_, Arc<VtState>>, hash: String) -> Result<VtReport, VtError> {
    validate_hash(&hash)?;
    let load_state = state.inner().clone();
    credential_task(move || load_state.settings()).await?;
    state.client.lookup(&hash).await
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
            .manage(crate::credentials::tests::memory_state())
            .build(mock_context(noop_assets()))
            .unwrap();
        let key = "a".repeat(64);
        let settings =
            tauri::async_runtime::block_on(set_vt_api_key(app.state(), key.clone())).unwrap();
        assert_eq!(
            serde_json::to_value(settings).unwrap(),
            serde_json::json!({"configured": true})
        );
        assert!(
            tauri::async_runtime::block_on(get_vt_settings(app.state()))
                .unwrap()
                .configured
        );
        tauri::async_runtime::block_on(set_vt_api_key(app.state(), String::new())).unwrap();
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
