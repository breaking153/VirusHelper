# Quality constraints

- Rust and TypeScript must compile without ignored type errors or disabled diagnostics.
- Rust formatting, Clippy with warnings denied, core behavioral tests and frontend tests must pass.
- Selected algorithms use standard implementations and published digest vectors; no hand-written cryptographic primitives.
- Hashing streams in 1 MiB chunks and supports cancellation between reads; no whole-file buffering.
- Hashing stays local. Only explicit VirusTotal actions may send a selected MD5/SHA-1/SHA-256 hash to VirusTotal; file contents are never uploaded. No generic shell or filesystem access is exposed to the webview.
- Per the user's persistence requirement, VirusTotal API keys are saved only in Windows Credential Manager / macOS Keychain and automatically restored on startup. Clearing a Key deletes the saved credential. Keys are never returned to the frontend after saving, logged, or written to plaintext config/localStorage. Storage failures must be reported without claiming a successful save. Requests use a fixed HTTPS endpoint, validated hashes, bounded responses, timeout, and server-reported quota handling. Per the user's updated requirement, do not enforce a local request-count or time-window limit; only VT responses determine rate/quota exhaustion.
- VT requests support an explicitly saved HTTP(S) or SOCKS5 proxy independently of the API Key; empty proxy means direct connection. Only HTTPS traffic to the fixed VT hosts is allowed, including through a proxy. Network checks send neither keys nor hashes. Proxy changes validate and build the transport before saving; failed persistence must retain the previous configuration.
- Malformed manifests report line numbers. Paths cannot escape the manifest root. Exports cannot overwrite source files.
- UI handles empty, running, cancelled, success, mismatch and error states; keyboard accessible controls and light/dark themes.
- Windows/macOS build configuration is required. Actual platform validation must be reported separately from configured CI.
