# VirusHelper Implementation Plan

> **For agentic workers:** Execute inline, task by task, with verification after each slice. The user approved the standalone application scope on 2026-10-17.

**Goal:** Deliver an offline Windows/macOS Tauri 2 file hashing and verification application.

**Architecture:** A standalone Rust core streams file bytes into selected hashers, parses portable checksum manifests and emits batch progress. A small Tauri adapter owns native dialogs, cancellation and exported results. React consumes typed IPC messages.

**Tech Stack:** Rust, Tauri 2, React, TypeScript, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-17-virushelper-design.md`

## Global Constraints

- Windows/macOS independent desktop app; no platform shell extension in 0.1.
- Eight algorithms; 1 MiB streaming buffer; no network or file history.
- Untrusted manifests cannot escape their directory; exports cannot overwrite input files.
- macOS builds are configured in CI and must not be described as locally tested.

## Task 1: Streaming hashing core

Files: `Cargo.toml`, `crates/hash-core/{Cargo.toml,src/lib.rs,src/algorithm.rs,src/hashing.rs,tests/hashing.rs}`.

- [ ] Test `hash_reader(reader, algorithms, cancel, on_progress)` against literal `abc` and empty SHA-256 vectors, cancellation between chunks, empty algorithm selection and changed files.
- [ ] Run `cargo test -p hash-core --test hashing`, confirm missing behavior fails.
- [ ] Implement `Algorithm` enum and digest states; read fixed buffers, update all hashers once per chunk, check cancellation and file metadata stability.
- [ ] Re-run tests and `cargo fmt --all -- --check`; save a Git checkpoint.

## Task 2: File batches and portable manifests

Files: `crates/hash-core/src/{manifest.rs,batch.rs}`, `crates/hash-core/tests/{manifest.rs,batch.rs}`.

- [ ] Test GNU/SFV literal fixtures, algorithm hints, malformed hashes, escaped names and traversal rejection. Test overlapping recursive inputs and a missing file that does not stop its neighbor.
- [ ] Run the focused tests before implementation.
- [ ] Implement `parse_manifest(text, hint)`, `resolve_entry(root, name)`, `render_manifest(entries, algorithm)` and `run_batch(request, cancel, emit)` with serialized progress/results.
- [ ] Verify all core tests and Clippy; save a Git checkpoint.

## Task 3: Native application adapter

Files: `src-tauri/{Cargo.toml,build.rs,tauri.conf.json,capabilities/default.json,src/{main.rs,lib.rs,commands.rs}}`, frontend package/build configuration.

- [ ] Add native dialogs and a mutex-owned single active cancellation token. `run_job` runs blocking filesystem work off the UI thread and sends `JobEvent` via Channel.
- [ ] Keep export data in Rust; derive relative filenames from chosen manifest location; validate source overwrite and manifest root restrictions.
- [ ] Configure Tauri 2, a local-only CSP, default native window decorations and app icons.
- [ ] Verify `cargo check -p virus-helper` and production frontend compilation.

## Task 4: Usable interface

Files: `src/{App.tsx,main.tsx,styles.css,types.ts,native.ts,model.ts,model.test.ts,useHashJob.ts,components/*}`.

- [ ] Test case-insensitive validated hash matching, file selection -> task -> result -> mismatch feedback and cancellation/error state using native IPC boundary doubles.
- [ ] Implement themed sidebar, algorithm selection, add/drop/import, queue, progress, result details, copy and checksum export. Clear stale results when inputs change.
- [ ] Disable actions during active tasks; preserve cancelled results; clean up drag listeners. Display explicit browser preview limitation.
- [ ] Run frontend tests/type checking/build, then inspect light/dark and narrow layouts in a browser.

## Task 5: Delivery

Files: `.github/workflows/{ci.yml,build.yml}`, `README.md`, `CONSTRAINTS.md`.

- [ ] Configure Windows and macOS Intel/ARM runner jobs using lockfiles, core tests, frontend checks and platform packages; upload artifacts without publishing a release.
- [ ] Document commands, capabilities, manifest formats, security boundaries and signing requirements.
- [ ] Run `cargo test --workspace`, `cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`, `npm test`, `npm run build`, `npm audit` and a Windows native build.
- [ ] Review requirements and final diff, update completed checkboxes, save final checkpoint and report evidence and remaining platform verification.
