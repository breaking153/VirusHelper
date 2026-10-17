use std::sync::Mutex;
use vt_client::{validate_api_key, VtClient, VtError, VtSettings};
use zeroize::Zeroizing;

trait KeyStore: Send + Sync {
    fn load(&self) -> Result<Option<Zeroizing<String>>, VtError>;
    fn save(&self, key: Option<&str>) -> Result<(), VtError>;
}

struct CredentialSession {
    store: Box<dyn KeyStore>,
    loaded: bool,
}

pub struct VtState {
    pub client: VtClient,
    credentials: Mutex<CredentialSession>,
}

impl VtState {
    pub fn new() -> Result<Self, VtError> {
        Self::with_store(Box::new(SystemKeyStore {
            account: "virustotal-api-key".into(),
        }))
    }

    fn with_store(store: Box<dyn KeyStore>) -> Result<Self, VtError> {
        Ok(Self {
            client: VtClient::new()?,
            credentials: Mutex::new(CredentialSession {
                store,
                loaded: false,
            }),
        })
    }

    pub fn settings(&self) -> Result<VtSettings, VtError> {
        let mut credentials = self.credentials.lock().map_err(|_| state_error())?;
        if !credentials.loaded {
            let saved = credentials.store.load()?;
            self.client
                .set_api_key(saved.map(|key| key.to_string()).unwrap_or_default())?;
            credentials.loaded = true;
        }
        self.client.settings()
    }

    pub fn set_api_key(&self, key: Zeroizing<String>) -> Result<VtSettings, VtError> {
        let trimmed = key.trim();
        validate_api_key(trimmed)?;
        let mut credentials = self.credentials.lock().map_err(|_| state_error())?;
        // Persist first: a storage failure must not pretend that a new Key was saved.
        // An uncertain write/delete must be reconciled from storage on the next reload.
        credentials.loaded = false;
        credentials.store.save(if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        })?;
        // Some macOS backends ignore deletion status; confirm absence before clearing memory.
        if trimmed.is_empty() && credentials.store.load()?.is_some() {
            return Err(VtError::new(
                "credential-store",
                "未能从系统凭据存储中删除 VT Key，请重试",
            ));
        }
        let settings = self.client.set_api_key(trimmed.into())?;
        credentials.loaded = true;
        Ok(settings)
    }
}

fn state_error() -> VtError {
    VtError::new("state-error", "VT 凭据状态不可用，请重启应用")
}

struct SystemKeyStore {
    account: String,
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl SystemKeyStore {
    fn entry(&self) -> Result<keyring::Entry, VtError> {
        keyring::Entry::new("io.virushelper.desktop", &self.account)
            .map_err(|_| VtError::new("credential-store", "无法访问系统凭据存储，请检查系统权限"))
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
impl KeyStore for SystemKeyStore {
    fn load(&self) -> Result<Option<Zeroizing<String>>, VtError> {
        match self.entry()?.get_password() {
            Ok(key) => Ok(Some(Zeroizing::new(key))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(VtError::new(
                "credential-store",
                "无法读取已保存的 VT Key，请解锁系统凭据存储后重试",
            )),
        }
    }
    fn save(&self, key: Option<&str>) -> Result<(), VtError> {
        let entry = self.entry()?;
        match key {
            Some(key) => entry.set_password(key).map_err(|_| {
                VtError::new(
                    "credential-store",
                    "无法保存 VT Key，请检查系统凭据存储是否已解锁",
                )
            }),
            None => match entry.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(_) => Err(VtError::new(
                    "credential-store",
                    "无法删除已保存的 VT Key，请检查系统凭据存储权限",
                )),
            },
        }
    }
}

// Other targets must report unsupported storage rather than use keyring's mock backend.
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
impl KeyStore for SystemKeyStore {
    fn load(&self) -> Result<Option<Zeroizing<String>>, VtError> {
        Err(VtError::new(
            "credential-store",
            "此平台暂不支持保存 VT Key",
        ))
    }
    fn save(&self, _key: Option<&str>) -> Result<(), VtError> {
        Err(VtError::new(
            "credential-store",
            "此平台暂不支持保存 VT Key",
        ))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Arc;

    #[derive(Default)]
    struct Data {
        key: Option<Zeroizing<String>>,
        fail_read: bool,
        fail_write: bool,
        ignore_delete: bool,
    }
    #[derive(Clone, Default)]
    struct MemoryStore(Arc<Mutex<Data>>);

    impl KeyStore for MemoryStore {
        fn load(&self) -> Result<Option<Zeroizing<String>>, VtError> {
            let data = self.0.lock().unwrap();
            if data.fail_read {
                return Err(VtError::new("credential-store", "无法读取系统凭据"));
            }
            Ok(data.key.clone())
        }
        fn save(&self, key: Option<&str>) -> Result<(), VtError> {
            let mut data = self.0.lock().unwrap();
            if data.fail_write {
                return Err(VtError::new("credential-store", "无法保存系统凭据"));
            }
            if key.is_none() && data.ignore_delete {
                return Ok(());
            }
            data.key = key.map(|value| Zeroizing::new(value.into()));
            Ok(())
        }
    }

    pub(crate) fn memory_state() -> Arc<VtState> {
        Arc::new(VtState::with_store(Box::new(MemoryStore::default())).unwrap())
    }

    #[test]
    fn saved_key_is_restored_in_a_new_app_session_without_returning_the_secret() {
        let store = MemoryStore::default();
        let key = "a".repeat(64);
        let state = VtState::with_store(Box::new(store.clone())).unwrap();
        state
            .set_api_key(Zeroizing::new(format!("  {key} \n")))
            .unwrap();
        assert_eq!(
            store.0.lock().unwrap().key.as_deref().map(String::as_str),
            Some(key.as_str())
        );
        drop(state);
        let restarted = VtState::with_store(Box::new(store)).unwrap();
        let settings = restarted.settings().unwrap();
        assert!(settings.configured);
        assert_eq!(
            serde_json::to_value(settings).unwrap(),
            serde_json::json!({"configured": true})
        );
        assert!(restarted.client.settings().unwrap().configured);
    }

    #[test]
    fn clearing_removes_the_saved_key_for_future_sessions() {
        let store = MemoryStore::default();
        let state = VtState::with_store(Box::new(store.clone())).unwrap();
        state.set_api_key(Zeroizing::new("a".repeat(64))).unwrap();
        assert!(store.0.lock().unwrap().key.is_some());
        assert!(
            !state
                .set_api_key(Zeroizing::new(String::new()))
                .unwrap()
                .configured
        );
        assert!(store.0.lock().unwrap().key.is_none());
        drop(state);
        assert!(
            !VtState::with_store(Box::new(store))
                .unwrap()
                .settings()
                .unwrap()
                .configured
        );
    }

    #[test]
    fn failed_save_or_delete_keeps_the_previous_session_and_saved_key() {
        let store = MemoryStore::default();
        let state = VtState::with_store(Box::new(store.clone())).unwrap();
        state.set_api_key(Zeroizing::new("a".repeat(64))).unwrap();
        store.0.lock().unwrap().fail_write = true;
        for key in ["b".repeat(64), String::new()] {
            assert_eq!(
                state.set_api_key(Zeroizing::new(key)).unwrap_err().code,
                "credential-store"
            );
            assert!(state.settings().unwrap().configured);
            assert_eq!(
                store.0.lock().unwrap().key.as_deref().map(String::as_str),
                Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
            );
        }
    }

    #[test]
    fn invalid_keys_do_not_replace_saved_credentials() {
        let store = MemoryStore::default();
        let state = VtState::with_store(Box::new(store.clone())).unwrap();
        state.set_api_key(Zeroizing::new("a".repeat(64))).unwrap();
        assert_eq!(
            state
                .set_api_key(Zeroizing::new("bad\nkey".into()))
                .unwrap_err()
                .code,
            "invalid-key"
        );
        assert_eq!(
            store.0.lock().unwrap().key.as_deref().map(String::as_str),
            Some("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
        );
    }

    #[test]
    fn clear_verifies_that_a_successful_os_delete_actually_removed_the_key() {
        let store = MemoryStore::default();
        let state = VtState::with_store(Box::new(store.clone())).unwrap();
        state.set_api_key(Zeroizing::new("a".repeat(64))).unwrap();
        store.0.lock().unwrap().ignore_delete = true;
        assert_eq!(
            state
                .set_api_key(Zeroizing::new(String::new()))
                .unwrap_err()
                .code,
            "credential-store"
        );
        assert!(state.settings().unwrap().configured);
        drop(state);
        assert!(
            VtState::with_store(Box::new(store))
                .unwrap()
                .settings()
                .unwrap()
                .configured
        );
    }

    #[test]
    fn reload_reconciles_memory_after_delete_succeeds_but_confirmation_cannot_read() {
        let store = MemoryStore::default();
        let state = VtState::with_store(Box::new(store.clone())).unwrap();
        state.set_api_key(Zeroizing::new("a".repeat(64))).unwrap();
        store.0.lock().unwrap().fail_read = true;
        assert_eq!(
            state
                .set_api_key(Zeroizing::new(String::new()))
                .unwrap_err()
                .code,
            "credential-store"
        );
        assert!(store.0.lock().unwrap().key.is_none());
        store.0.lock().unwrap().fail_read = false;
        assert!(!state.settings().unwrap().configured);
        assert!(!state.client.settings().unwrap().configured);
    }

    #[test]
    fn storage_read_errors_are_reported_and_can_be_retried_after_unlocking() {
        let store = MemoryStore::default();
        {
            let mut data = store.0.lock().unwrap();
            data.fail_read = true;
            data.key = Some(Zeroizing::new("a".repeat(64)));
        }
        let state = VtState::with_store(Box::new(store.clone())).unwrap();
        assert_eq!(state.settings().unwrap_err().code, "credential-store");
        store.0.lock().unwrap().fail_read = false;
        assert!(state.settings().unwrap().configured);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_credential_store_roundtrips_across_sessions_and_deletes_the_saved_key() {
        const CHILD_ACCOUNT: &str = "VIRUSHELPER_TEST_CREDENTIAL_ACCOUNT";
        if let Ok(account) = std::env::var(CHILD_ACCOUNT) {
            assert!(account.starts_with("virustotal-test-"));
            let store = SystemKeyStore { account };
            assert!(store.load().unwrap().unwrap().as_str() == "a".repeat(64));
            assert!(
                VtState::with_store(Box::new(store))
                    .unwrap()
                    .settings()
                    .unwrap()
                    .configured
            );
            return;
        }
        let account = format!(
            "virustotal-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        struct Cleanup(SystemKeyStore);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.0.save(None);
            }
        }
        let cleanup = Cleanup(SystemKeyStore {
            account: account.clone(),
        });
        let create = || {
            VtState::with_store(Box::new(SystemKeyStore {
                account: account.clone(),
            }))
            .unwrap()
        };
        let original = create();
        assert!(!original.settings().unwrap().configured);
        original
            .set_api_key(Zeroizing::new("a".repeat(64)))
            .unwrap();
        drop(original);
        let child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "credentials::tests::windows_credential_store_roundtrips_across_sessions_and_deletes_the_saved_key"])
            .env(CHILD_ACCOUNT, &account)
            .output().unwrap();
        assert!(
            child.status.success(),
            "new process could not restore its test credential"
        );
        let reopened = create();
        assert!(reopened.settings().unwrap().configured);
        assert!(cleanup.0.load().unwrap().unwrap().as_str() == "a".repeat(64));
        reopened
            .set_api_key(Zeroizing::new("b".repeat(64)))
            .unwrap();
        drop(reopened);
        let reopened = create();
        assert!(reopened.settings().unwrap().configured);
        assert!(cleanup.0.load().unwrap().unwrap().as_str() == "b".repeat(64));
        reopened.set_api_key(Zeroizing::new(String::new())).unwrap();
        drop(reopened);
        assert!(cleanup.0.load().unwrap().is_none());
        assert!(!create().settings().unwrap().configured);
    }
}
