# Quality constraints

- Rust and TypeScript must compile without ignored type errors or disabled diagnostics.
- Rust formatting, Clippy with warnings denied, core behavioral tests and frontend tests must pass.
- Selected algorithms use standard implementations and published digest vectors; no hand-written cryptographic primitives.
- Hashing streams in 1 MiB chunks and supports cancellation between reads; no whole-file buffering.
- Hashes and file contents stay offline. No generic shell or filesystem access is exposed to the webview.
- Malformed manifests report line numbers. Paths cannot escape the manifest root. Exports cannot overwrite source files.
- UI handles empty, running, cancelled, success, mismatch and error states; keyboard accessible controls and light/dark themes.
- Windows/macOS build configuration is required. Actual platform validation must be reported separately from configured CI.
