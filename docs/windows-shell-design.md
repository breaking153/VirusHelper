# Windows Shell integration

Reference: OpenHashTab `Setup/Package.wxs` (blob
`6ea3b7a0f64537eeca15d8ebf4fd8cb66fdeedd6`) registers an Apartment COM DLL
under `AllFilesystemObjects\\shellex\\ContextMenuHandlers` and
`PropertySheetHandlers`. VirusHelper implements these documented interfaces
in original Rust code with its own CLSID; no OpenHashTab implementation is copied.

- A small Windows-only `windows-shell` cdylib implements `IClassFactory`,
  `IShellExtInit`, `IContextMenu`, and `IShellPropSheetExt`.
- Selection comes from `CF_HDROP`, preserving Unicode and multiple paths.
  The menu launches the adjacent Tauri executable directly, without a shell.
- The native property page computes hashes on a cancellable worker using
  `hash-core`, defaults to MD5, and recomputes on algorithm changes. The
  existing Tauri window remains the entry for VT and full application options.
- COM objects, pages and workers hold DLL lifetime references. No network
  or credential access occurs inside Explorer.
- Registration is per-user and explicitly uses the native registry view;
  installer/manual registration share the same CLSID and remove obsolete verbs.
  Unregistration removes only VirusHelper-owned keys and notifies the Shell.
- Windows 11's modern first-layer menu is a separate `IExplorerCommand` +
  package identity integration. OpenHashTab's classic interfaces do not provide it.
  Do not claim first-layer support from registry presence or COM activation alone.

Implementation order: (1) behavioral COM menu tests, handler and selection reader;
(2) property page lifecycle and worker tests; (3) build/bundle/register/unregister,
real COM activation and selection tests; (4) review, full existing quality gates,
local registration, documented verification limits.

Sources:
- https://github.com/liudonghua123/open-hashtab/blob/main/Setup/Package.wxs
- https://learn.microsoft.com/en-us/windows/win32/shell/reg-shell-exts
- https://learn.microsoft.com/en-us/windows/win32/shell/propsheet-handlers
- https://blogs.windows.com/windowsdeveloper/2021/07/19/extending-the-context-menu-and-share-dialog-in-windows-11/
