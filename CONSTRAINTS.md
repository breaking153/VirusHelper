# Quality constraints

- Rust and TypeScript must compile without ignored type errors or disabled diagnostics.
- Rust formatting, Clippy with warnings denied, core behavioral tests and frontend tests must pass.
- Selected algorithms use standard implementations and published digest vectors; no hand-written cryptographic primitives.
- Hashing streams in 1 MiB chunks and supports cancellation between reads; no whole-file buffering.
- Hashing stays local. Only explicit VirusTotal actions may send a selected MD5/SHA-1/SHA-256 hash to VirusTotal; file contents are never uploaded. No generic shell or filesystem access is exposed to the webview.
- Per the user's persistence requirement, VirusTotal API keys are saved only in Windows Credential Manager / macOS Keychain and automatically restored on startup. Clearing a Key deletes the saved credential. Keys are never returned to the frontend after saving, logged, or written to plaintext config/localStorage. Storage failures must be reported without claiming a successful save. Requests use a fixed HTTPS endpoint, validated hashes, bounded responses, timeout, and a 4-request/60-second local limit.
- Malformed manifests report line numbers. Paths cannot escape the manifest root. Exports cannot overwrite source files.
- UI handles empty, running, cancelled, success, mismatch and error states; keyboard accessible controls and light/dark themes.
- Windows/macOS build configuration is required. Actual platform validation must be reported separately from configured CI.
