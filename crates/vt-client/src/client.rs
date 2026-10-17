use crate::{decode_report, validate_hash, VtError, VtReport, VtSettings};
use reqwest::{header::HeaderValue, Client, StatusCode};
use std::{
    collections::{HashMap, VecDeque},
    sync::Mutex,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const API: &str = "https://www.virustotal.com/api/v3";
const WINDOW: Duration = Duration::from_secs(60);
const CACHE_TTL: Duration = Duration::from_secs(600);
const MAX_RESPONSE: usize = 4 * 1024 * 1024;

#[derive(Default)]
struct Session {
    key: Option<Zeroizing<String>>,
    generation: u64,
    requests: VecDeque<Instant>,
    cache: HashMap<String, (Instant, VtReport)>,
}

impl Session {
    fn reserve(&mut self, now: Instant) -> Result<(), VtError> {
        while self
            .requests
            .front()
            .is_some_and(|time| now.duration_since(*time) >= WINDOW)
        {
            self.requests.pop_front();
        }
        if self.requests.len() >= 4 {
            let remaining = WINDOW.saturating_sub(now.duration_since(self.requests[0]));
            return Err(VtError {
                code: "rate-limited".into(),
                message: "已达到公共 API 每分钟 4 次的限制，请稍后重试".into(),
                retry_after_seconds: Some(remaining.as_secs() + 1),
            });
        }
        self.requests.push_back(now);
        Ok(())
    }
}

pub struct VtClient {
    client: Client,
    session: Mutex<Session>,
}

impl VtClient {
    pub fn new() -> Result<Self, VtError> {
        let client = Client::builder()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(20))
            .user_agent("VirusHelper/0.1")
            .build()
            .map_err(|_| VtError::new("client-error", "无法初始化 VT 网络客户端"))?;
        Ok(Self {
            client,
            session: Mutex::new(Session::default()),
        })
    }

    pub fn settings(&self) -> Result<VtSettings, VtError> {
        let session = self.session.lock().map_err(|_| state_error())?;
        Ok(VtSettings {
            configured: session.key.is_some(),
        })
    }

    pub fn set_api_key(&self, key: String) -> Result<VtSettings, VtError> {
        let key = Zeroizing::new(key);
        let trimmed = key.trim();
        crate::validate_api_key(trimmed)?;
        let mut session = self.session.lock().map_err(|_| state_error())?;
        session.key = if trimmed.is_empty() {
            None
        } else {
            Some(Zeroizing::new(trimmed.into()))
        };
        session.generation = session.generation.wrapping_add(1);
        session.cache.clear();
        Ok(VtSettings {
            configured: session.key.is_some(),
        })
    }

    pub async fn lookup(&self, hash: &str) -> Result<VtReport, VtError> {
        let hash = validate_hash(hash)?;
        let (key, generation) = {
            let mut session = self.session.lock().map_err(|_| state_error())?;
            let key = session
                .key
                .clone()
                .ok_or_else(|| VtError::new("missing-key", "请先在选项中设置 VT API Key"))?;
            let now = Instant::now();
            session
                .cache
                .retain(|_, (time, _)| now.duration_since(*time) < CACHE_TTL);
            if let Some((_, report)) = session.cache.get(&hash) {
                return Ok(report.clone());
            }
            session.reserve(now)?;
            (key, session.generation)
        };
        let report = fetch_report(&self.client, API, &hash, &key).await?;
        let mut session = self.session.lock().map_err(|_| state_error())?;
        if session.generation != generation {
            return Err(VtError::new(
                "settings-changed",
                "API 设置已更改，请重新查询",
            ));
        }
        // Keep memory bounded during very large sessions.
        if session.cache.len() >= 1024 {
            session.cache.clear();
        }
        session.cache.insert(hash, (Instant::now(), report.clone()));
        Ok(report)
    }
}

fn state_error() -> VtError {
    VtError::new("state-error", "VT 会话状态不可用，请重启应用")
}

async fn fetch_report(
    client: &Client,
    base: &str,
    hash: &str,
    key: &str,
) -> Result<VtReport, VtError> {
    let mut header =
        HeaderValue::from_str(key).map_err(|_| VtError::new("invalid-key", "API Key 格式无效"))?;
    header.set_sensitive(true);
    let mut response = client
        .get(format!("{base}/files/{hash}"))
        .header("x-apikey", header)
        .send()
        .await
        .map_err(|_| VtError::new("network-error", "无法连接 VT，请检查网络后重试"))?;
    match response.status() {
        StatusCode::OK => {}
        StatusCode::NOT_FOUND => {
            return Ok(VtReport {
                hash: hash.into(),
                status: "not-found".into(),
                malicious: 0,
                suspicious: 0,
                total: 0,
                last_analysis_date: None,
            })
        }
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            return Err(VtError::new("authentication", "API Key 无效或没有查询权限"))
        }
        StatusCode::TOO_MANY_REQUESTS => {
            return Err(VtError {
                code: "rate-limited".into(),
                message: "VT 请求额度已用尽，请稍后重试或检查每日额度".into(),
                retry_after_seconds: response
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.parse().ok()),
            })
        }
        _ => {
            return Err(VtError::new(
                "service-error",
                "VT 服务暂时无法返回报告，请稍后重试",
            ))
        }
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE as u64)
    {
        return Err(VtError::new("invalid-response", "VT 报告超过大小限制"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| VtError::new("network-error", "读取 VT 报告失败，请重试"))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE {
            return Err(VtError::new("invalid-response", "VT 报告超过大小限制"));
        }
        bytes.extend_from_slice(&chunk);
    }
    decode_report(hash, &bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
    };
    const HASH: &str = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    fn server(status: &str, extra: &str, body: &str) -> (String, std::thread::JoinHandle<String>) {
        let reply = format!(
            "HTTP/1.1 {status}\r\nContent-Length: {}\r\n{extra}Connection: close\r\n\r\n{body}",
            body.len()
        );
        serve(reply)
    }

    fn serve(reply: String) -> (String, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let handle = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            loop {
                let mut buf = [0; 1024];
                let size = stream.read(&mut buf).unwrap();
                request.extend_from_slice(&buf[..size]);
                if size == 0 || request.windows(4).any(|s| s == b"\r\n\r\n") {
                    break;
                }
            }
            stream.write_all(reply.as_bytes()).unwrap();
            String::from_utf8(request).unwrap()
        });
        (address, handle)
    }

    #[tokio::test]
    async fn sends_only_hash_get_and_sensitive_key_header() {
        let body = format!(
            r#"{{"data":{{"id":"{HASH}","type":"file","attributes":{{"last_analysis_stats":{{"malicious":2,"undetected":68}}}}}}}}"#
        );
        let (base, server) = server("200 OK", "", &body);
        let client = Client::builder().no_proxy().build().unwrap();
        let report = fetch_report(&client, &base, HASH, "test-key")
            .await
            .unwrap();
        assert_eq!(report.malicious, 2);
        assert_eq!(report.total, 70);
        let request = server.join().unwrap();
        assert!(request.starts_with(&format!("GET /files/{HASH} HTTP/1.1\r\n")));
        assert!(request.contains("x-apikey: test-key\r\n"));
        assert!(!request.contains("content-length:"));
        assert!(!request.split("\r\n").next().unwrap().contains("test-key"));
    }

    #[tokio::test]
    async fn handles_absent_auth_quota_and_redirect_without_following_it() {
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        for (status, headers, code) in [
            ("404 Not Found", "", "not-found"),
            ("401 Unauthorized", "", "authentication"),
            (
                "429 Too Many Requests",
                "Retry-After: 30\r\n",
                "rate-limited",
            ),
            (
                "302 Found",
                "Location: http://127.0.0.1:1/steal\r\n",
                "service-error",
            ),
            ("200 OK", "", "invalid-response"),
        ] {
            let (base, server) = server(status, headers, "{}");
            let result = fetch_report(&client, &base, HASH, "secret-key").await;
            if code == "not-found" {
                assert_eq!(result.unwrap().status, code);
            } else {
                let error = result.unwrap_err();
                assert_eq!(error.code, code);
                assert!(!error.message.contains("secret-key"));
                if code == "rate-limited" {
                    assert_eq!(error.retry_after_seconds, Some(30));
                }
            }
            server.join().unwrap();
        }
    }

    #[test]
    fn sliding_window_is_shared_and_does_not_reset_when_key_changes() {
        let mut session = Session::default();
        let now = Instant::now();
        for seconds in [0, 1, 2, 3] {
            session.reserve(now + Duration::from_secs(seconds)).unwrap();
        }
        assert_eq!(
            session
                .reserve(now + Duration::from_secs(59))
                .unwrap_err()
                .retry_after_seconds,
            Some(2)
        );
        session.reserve(now + WINDOW).unwrap();
        assert!(session.reserve(now + WINDOW).is_err());
        let client = VtClient::new().unwrap();
        client.session.lock().unwrap().requests.push_back(now);
        client.set_api_key("a".repeat(64)).unwrap();
        assert_eq!(client.session.lock().unwrap().requests.len(), 1);
        assert!(client.settings().unwrap().configured);
        client.set_api_key(String::new()).unwrap();
        assert!(!client.settings().unwrap().configured);
    }

    #[tokio::test]
    async fn cache_hits_do_not_spend_quota_and_expired_entries_cannot_bypass_the_gate() {
        let client = VtClient::new().unwrap();
        client.set_api_key("a".repeat(64)).unwrap();
        {
            let mut session = client.session.lock().unwrap();
            let now = Instant::now();
            session.requests = VecDeque::from([now; 4]);
            session.cache.insert(
                HASH.into(),
                (
                    now,
                    VtReport {
                        hash: HASH.into(),
                        status: "not-found".into(),
                        malicious: 0,
                        suspicious: 0,
                        total: 0,
                        last_analysis_date: None,
                    },
                ),
            );
        }
        assert_eq!(client.lookup(HASH).await.unwrap().status, "not-found");
        assert_eq!(client.session.lock().unwrap().requests.len(), 4);
        client
            .session
            .lock()
            .unwrap()
            .cache
            .get_mut(HASH)
            .unwrap()
            .0 = Instant::now() - CACHE_TTL;
        assert_eq!(client.lookup(HASH).await.unwrap_err().code, "rate-limited");
        client.set_api_key(String::new()).unwrap();
        assert!(client.session.lock().unwrap().cache.is_empty());
        assert_eq!(client.lookup(HASH).await.unwrap_err().code, "missing-key");
    }

    #[tokio::test]
    async fn rejects_oversized_response_before_loading_its_body() {
        let (base, server) = serve(
            "HTTP/1.1 200 OK\r\nContent-Length: 9999999\r\nConnection: close\r\n\r\n{}".into(),
        );
        let client = Client::builder().no_proxy().build().unwrap();
        let error = fetch_report(&client, &base, HASH, "test-key")
            .await
            .unwrap_err();
        assert_eq!(error.code, "invalid-response");
        assert!(error.message.contains("大小限制"));
        server.join().unwrap();
    }
}
