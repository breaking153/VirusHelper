use crate::{decode_report, validate_hash, VtError, VtReport, VtSettings};
use reqwest::{header::HeaderValue, Client, StatusCode};
use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

const API: &str = "https://www.virustotal.com/api/v3";
const CACHE_TTL: Duration = Duration::from_secs(600);
const MAX_RESPONSE: usize = 4 * 1024 * 1024;

struct Session {
    transport: VtTransport,
    key: Option<Zeroizing<String>>,
    generation: u64,
    cache: HashMap<String, (Instant, VtReport)>,
}

pub struct VtTransport {
    client: Client,
    proxy: Option<String>,
}

pub struct VtClient {
    session: Mutex<Session>,
}

impl VtClient {
    pub fn new() -> Result<Self, VtError> {
        Ok(Self {
            session: Mutex::new(Session {
                transport: Self::prepare_proxy("")?,
                key: None,
                generation: 0,
                cache: HashMap::new(),
            }),
        })
    }

    /// Build before persisting so invalid proxy settings never replace a working transport.
    pub fn prepare_proxy(value: &str) -> Result<VtTransport, VtError> {
        let value = value.trim();
        let proxy = if value.is_empty() {
            None
        } else {
            let value = value
                .strip_prefix("socks://")
                .map(|rest| format!("socks5h://{rest}"))
                .unwrap_or_else(|| value.to_owned());
            let url = reqwest::Url::parse(&value).map_err(|_| proxy_error())?;
            if !matches!(url.scheme(), "http" | "https" | "socks5" | "socks5h")
                || url.host_str().is_none()
                || url.port_or_known_default().is_none_or(|port| port == 0)
                || !url.username().is_empty()
                || url.password().is_some()
                || !matches!(url.path(), "" | "/")
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return Err(proxy_error());
            }
            Some(url.to_string())
        };
        let mut builder = Client::builder()
            .no_proxy()
            .https_only(true)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("VirusHelper/", env!("CARGO_PKG_VERSION")));
        if let Some(url) = &proxy {
            builder = builder.proxy(reqwest::Proxy::all(url).map_err(|_| proxy_error())?);
        }
        let client = builder
            .build()
            .map_err(|_| VtError::new("client-error", "无法初始化 VT 网络客户端"))?;
        Ok(VtTransport { client, proxy })
    }

    pub fn set_proxy(&self, transport: VtTransport) -> Result<VtSettings, VtError> {
        let mut session = self.session.lock().map_err(|_| state_error())?;
        session.transport = transport;
        session.generation = session.generation.wrapping_add(1);
        session.cache.clear();
        Ok(session.settings())
    }

    pub fn settings(&self) -> Result<VtSettings, VtError> {
        let session = self.session.lock().map_err(|_| state_error())?;
        Ok(session.settings())
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
        Ok(session.settings())
    }

    /// Verify the HTTPS route without sending a hash or API key (no API quota).
    pub async fn test_connection(&self) -> Result<String, VtError> {
        let (client, using_proxy) = {
            let session = self.session.lock().map_err(|_| state_error())?;
            (
                session.transport.client.clone(),
                session.transport.proxy.is_some(),
            )
        };
        let response = client
            .head("https://www.virustotal.com/")
            .send()
            .await
            .map_err(|error| network_error(&error, using_proxy))?;
        if response.status() == StatusCode::PROXY_AUTHENTICATION_REQUIRED {
            return Err(VtError::new(
                "proxy-authentication",
                "代理要求认证，请使用无需认证的本地代理地址",
            ));
        }
        Ok(format!(
            "已连接到 VT（HTTP {}，未校验 API Key）",
            response.status().as_u16()
        ))
    }

    pub async fn lookup(&self, hash: &str) -> Result<VtReport, VtError> {
        self.lookup_at(hash, API).await
    }

    // Production uses the fixed HTTPS API above; the private base argument lets
    // transport tests exercise session/cache behavior against a local fixture.
    async fn lookup_at(&self, hash: &str, base: &str) -> Result<VtReport, VtError> {
        let hash = validate_hash(hash)?;
        let (key, generation, client, using_proxy) = {
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
            (
                key,
                session.generation,
                session.transport.client.clone(),
                session.transport.proxy.is_some(),
            )
        };
        let report = fetch_report(&client, base, &hash, &key)
            .await
            .map_err(|mut error| {
                if using_proxy && matches!(error.code.as_str(), "network-error" | "timeout") {
                    error.message = if error.code == "timeout" {
                        "连接 VT 超时"
                    } else {
                        "无法连接 VT"
                    }
                    .to_owned()
                        + "；请检查代理是否运行、地址和协议是否正确";
                }
                error
            })?;
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

impl Session {
    fn settings(&self) -> VtSettings {
        VtSettings {
            configured: self.key.is_some(),
            proxy: self.transport.proxy.clone(),
        }
    }
}

fn proxy_error() -> VtError {
    VtError::new("invalid-proxy", "代理地址无效：请填写 http://、https://、socks5:// 或 socks5h://主机:端口，不含用户名、密码或路径；留空为直连")
}

fn network_error(error: &reqwest::Error, using_proxy: bool) -> VtError {
    let (code, detail) = if error.is_timeout() {
        ("timeout", "连接 VT 超时")
    } else {
        ("network-error", "无法连接 VT")
    };
    VtError::new(
        code,
        &format!(
            "{detail}；{}",
            if using_proxy {
                "请检查代理是否运行、地址和协议是否正确"
            } else {
                "请检查网络或在选项中配置 VT 代理"
            }
        ),
    )
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
        .map_err(|error| network_error(&error, false))?;
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
                threat_label: None,
                threat_categories: Vec::new(),
            })
        }
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            return Err(VtError::new(
                "authentication",
                &format!(
                    "VT 接口返回 HTTP {}：API Key 无效或没有查询权限",
                    response.status().as_u16()
                ),
            ))
        }
        StatusCode::TOO_MANY_REQUESTS => {
            return Err(VtError {
                code: "rate-limited".into(),
                message: "VT 接口返回 HTTP 429：请求频率或账户额度已达到限制".into(),
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
                &format!(
                    "VT 接口返回 HTTP {}，请稍后重试",
                    response.status().as_u16()
                ),
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

    #[test]
    fn validates_proxy_protocol_host_port_and_rejects_secret_or_path_input() {
        for value in [
            "",
            "http://localhost:8890",
            "https://localhost:8443",
            "socks5://127.0.0.1:8890",
            "socks5h://[::1]:8890",
            "socks://localhost:8890",
        ] {
            assert!(VtClient::prepare_proxy(value).is_ok(), "{value}");
        }
        for value in [
            "localhost:8890",
            "ftp://localhost:8890",
            "socks5://localhost",
            "http://localhost:0",
            "http://secret:password@localhost:8890",
            "http://localhost:8890/path",
            "http://localhost:8890?key=secret",
            "http://localhost:8890#secret",
        ] {
            let error = VtClient::prepare_proxy(value).err().unwrap();
            assert_eq!(error.code, "invalid-proxy");
            assert!(!error.message.contains("secret"));
        }
    }

    #[tokio::test]
    async fn https_requests_use_http_connect_or_socks_remote_dns_without_exposing_the_key() {
        for scheme in ["http", "socks5h"] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            listener.set_nonblocking(true).unwrap();
            let proxy = format!("{scheme}://{}", listener.local_addr().unwrap());
            let fixture = std::thread::spawn(move || {
                let deadline = Instant::now() + Duration::from_secs(5);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(Instant::now() < deadline, "Proxy was bypassed");
                            std::thread::sleep(Duration::from_millis(2));
                        }
                        Err(error) => panic!("{error}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                if scheme == "http" {
                    let mut request = Vec::new();
                    while !request.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                        let mut buf = [0; 1024];
                        let count = stream.read(&mut buf).unwrap();
                        assert!(count > 0);
                        request.extend_from_slice(&buf[..count]);
                    }
                    let request = String::from_utf8(request).unwrap();
                    assert!(request.starts_with("CONNECT www.virustotal.com:443 HTTP/1.1\r\n"));
                    assert!(!request.contains("x-apikey"));
                    assert!(!request.contains("test-proxy-secret"));
                    stream
                        .write_all(b"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n")
                        .unwrap();
                } else {
                    let mut header = [0; 2];
                    stream.read_exact(&mut header).unwrap();
                    assert_eq!(header[0], 5);
                    let mut methods = vec![0; header[1] as usize];
                    stream.read_exact(&mut methods).unwrap();
                    assert!(methods.contains(&0));
                    stream.write_all(&[5, 0]).unwrap();
                    let mut request = [0; 5];
                    stream.read_exact(&mut request).unwrap();
                    assert_eq!(&request[..4], &[5, 1, 0, 3]);
                    let mut host = vec![0; request[4] as usize];
                    stream.read_exact(&mut host).unwrap();
                    assert_eq!(host, b"www.virustotal.com");
                    let mut port = [0; 2];
                    stream.read_exact(&mut port).unwrap();
                    assert_eq!(u16::from_be_bytes(port), 443);
                    stream.write_all(&[5, 2, 0, 1, 0, 0, 0, 0, 0, 0]).unwrap();
                }
            });
            let client = VtClient::new().unwrap();
            client.set_api_key("test-proxy-secret".into()).unwrap();
            client
                .set_proxy(VtClient::prepare_proxy(&proxy).unwrap())
                .unwrap();
            let error = client.lookup(HASH).await.unwrap_err();
            assert_eq!(error.code, "network-error");
            assert!(error.message.contains("代理"));
            assert!(!error.message.contains("test-proxy-secret"));
            fixture.join().unwrap();
        }
    }

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
            ("429 Too Many Requests", "", "rate-limited"),
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
                    assert_eq!(
                        error.retry_after_seconds,
                        if headers.is_empty() { None } else { Some(30) }
                    );
                }
            }
            server.join().unwrap();
        }
    }

    fn local_client() -> VtClient {
        VtClient {
            session: Mutex::new(Session {
                transport: VtTransport {
                    client: Client::builder().no_proxy().build().unwrap(),
                    proxy: None,
                },
                key: None,
                generation: 0,
                cache: HashMap::new(),
            }),
        }
    }

    #[tokio::test]
    async fn session_lock_does_not_serialize_parallel_http_requests() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let fixture = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut connections = Vec::new();
            // Hold every response until all four requests have arrived. A
            // serialized client cannot complete this handshake.
            while connections.len() < 4 {
                let mut stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(Instant::now() < deadline, "VT requests were serialized");
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(3)))
                    .unwrap();
                let mut request = Vec::new();
                loop {
                    let mut buf = [0; 1024];
                    let n = stream.read(&mut buf).unwrap();
                    request.extend_from_slice(&buf[..n]);
                    if n == 0 || request.windows(4).any(|s| s == b"\r\n\r\n") {
                        break;
                    }
                }
                connections.push(stream);
            }
            for mut stream in connections {
                stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}").unwrap();
            }
        });
        let client = local_client();
        client.set_api_key("a".repeat(64)).unwrap();
        let hashes: Vec<_> = (1..=4).map(|i| format!("{i:064x}")).collect();
        let results = tokio::join!(
            client.lookup_at(&hashes[0], &base),
            client.lookup_at(&hashes[1], &base),
            client.lookup_at(&hashes[2], &base),
            client.lookup_at(&hashes[3], &base),
        );
        for result in [results.0, results.1, results.2, results.3] {
            assert_eq!(result.unwrap().status, "not-found");
        }
        fixture.join().unwrap();
    }

    #[tokio::test]
    async fn more_than_four_requests_reach_server_and_only_http_429_limits_them() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let fixture = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(10);
            let mut requests = Vec::new();
            while requests.len() < 7 {
                let mut stream = match listener.accept() {
                    Ok((stream, _)) => stream,
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            Instant::now() < deadline,
                            "Expected every query to reach VT"
                        );
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(e) => panic!("{e}"),
                };
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                loop {
                    let mut buf = [0; 1024];
                    let n = stream.read(&mut buf).unwrap();
                    request.extend_from_slice(&buf[..n]);
                    if n == 0 || request.windows(4).any(|s| s == b"\r\n\r\n") {
                        break;
                    }
                }
                requests.push(String::from_utf8(request).unwrap());
                let status = if requests.len() == 7 {
                    "429 Too Many Requests\r\nRetry-After: 3"
                } else {
                    "404 Not Found"
                };
                write!(
                    stream,
                    "HTTP/1.1 {status}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
                )
                .unwrap();
            }
            requests
        });
        let client = local_client();
        client.set_api_key("a".repeat(64)).unwrap();
        for n in 0..7 {
            let hash = format!("{n:064x}");
            let result = client.lookup_at(&hash, &base).await;
            if n < 6 {
                assert_eq!(result.unwrap().status, "not-found");
            } else {
                let error = result.unwrap_err();
                assert_eq!(error.code, "rate-limited");
                assert_eq!(error.retry_after_seconds, Some(3));
                assert!(error.message.contains("HTTP 429"));
            }
        }
        let requests = fixture.join().unwrap();
        assert_eq!(requests.len(), 7);
        for request in requests {
            assert!(request.contains("x-apikey:"));
        }
    }

    #[tokio::test]
    async fn cache_hits_stay_local_and_expired_entries_fetch_without_a_local_gate() {
        let client = local_client();
        client.set_api_key("a".repeat(64)).unwrap();
        client.session.lock().unwrap().cache.insert(
            HASH.into(),
            (
                Instant::now(),
                VtReport {
                    hash: HASH.into(),
                    status: "not-found".into(),
                    malicious: 0,
                    suspicious: 0,
                    total: 0,
                    last_analysis_date: None,
                    threat_label: None,
                    threat_categories: Vec::new(),
                },
            ),
        );
        // No listener: a fresh cached report must not attempt network access.
        assert_eq!(
            client
                .lookup_at(HASH, "http://127.0.0.1:1")
                .await
                .unwrap()
                .status,
            "not-found"
        );
        client
            .session
            .lock()
            .unwrap()
            .cache
            .get_mut(HASH)
            .unwrap()
            .0 = Instant::now() - CACHE_TTL;
        let (base, fixture) = server("404 Not Found", "", "{}");
        assert_eq!(
            client.lookup_at(HASH, &base).await.unwrap().status,
            "not-found"
        );
        assert!(fixture
            .join()
            .unwrap()
            .starts_with(&format!("GET /files/{HASH}")));
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
