use hash_core::{run_batch, Algorithm, JobEvent, JobRequest};
use std::{
    cell::RefCell,
    path::PathBuf,
    rc::Rc,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc,
    },
};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        System::LibraryLoader::*,
        UI::{Controls::*, WindowsAndMessaging::*},
    },
};

const ALGORITHM: i32 = 101;
const RESULTS: i32 = 102;
const OPEN_APP: i32 = 103;

struct Page {
    state: RefCell<PageState>,
    template: Vec<u32>,
    _lease: crate::lifetime::Lease,
}
struct PageState {
    paths: Vec<PathBuf>,
    cancel: Arc<AtomicBool>,
    receiver: Option<Receiver<String>>,
}
impl Drop for PageState {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}

// A header with no controls, followed by menu/class/title WORD zeros. u32 storage
// gives the DWORD alignment required by PSP_DLGINDIRECT.
fn template() -> Vec<u32> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&(WS_CHILD.0 | DS_CONTROL as u32).to_le_bytes());
    bytes.extend_from_slice(&0u32.to_le_bytes());
    for value in [0u16, 0, 0, 250, 220, 0, 0, 0] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
        .chunks_exact(4)
        .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
        .collect()
}

pub fn add(paths: Vec<PathBuf>, callback: LPFNSVADDPROPSHEETPAGE, parameter: LPARAM) -> Result<()> {
    let callback = callback.ok_or_else(|| Error::from(E_POINTER))?;
    let state = Rc::new(Page {
        state: RefCell::new(PageState {
            paths,
            cancel: Arc::new(AtomicBool::new(false)),
            receiver: None,
        }),
        template: template(),
        _lease: crate::lifetime::Lease::new(),
    });
    let descriptor = PROPSHEETPAGEW {
        dwSize: std::mem::size_of::<PROPSHEETPAGEW>() as u32,
        dwFlags: PSP_DLGINDIRECT | PSP_USETITLE | PSP_USECALLBACK,
        hInstance: HINSTANCE(crate::handler::module()?.0),
        Anonymous1: PROPSHEETPAGEW_0 {
            pResource: state.template.as_ptr().cast_mut().cast(),
        },
        pszTitle: w!("VirusHelper 哈希"),
        pfnDlgProc: Some(dialog),
        pfnCallback: Some(page_callback),
        lParam: LPARAM(Rc::as_ptr(&state) as isize),
        ..Default::default()
    };
    let mut descriptor = descriptor;
    let handle = unsafe { CreatePropertySheetPageW(&mut descriptor) };
    if handle.0.is_null() {
        return Err(Error::from_thread());
    }
    if !unsafe { callback(handle, parameter) }.as_bool() {
        unsafe {
            DestroyPropertySheetPage(handle).ok()?;
        }
    }
    Ok(())
}

unsafe extern "system" fn page_callback(
    _: HWND,
    message: PSPCB_MESSAGE,
    descriptor: *mut PROPSHEETPAGEW,
) -> u32 {
    if !descriptor.is_null() {
        let pointer = unsafe { (*descriptor).lParam.0 as *const Page };
        unsafe {
            // Each successful ADDREF owns exactly one RELEASE reference; the
            // caller separately owns one across CreatePropertySheetPageW.
            if message == PSPCB_ADDREF {
                Rc::increment_strong_count(pointer);
            }
            if message == PSPCB_RELEASE {
                drop(Rc::from_raw(pointer));
            }
        }
    }
    1
}

fn hash_text(paths: Vec<PathBuf>, algorithm: Algorithm, cancel: &AtomicBool) -> String {
    let mut text = String::new();
    let request = JobRequest {
        paths,
        algorithms: vec![algorithm],
        checksums: Vec::new(),
    };
    let summary = run_batch(request, cancel, |event| {
        if let JobEvent::File { result } = event {
            // Bound the native edit control's memory. Full results are available
            // in the main app with pagination.
            if text.len() > 1_000_000 {
                return;
            }
            let hash = result
                .hashes
                .get(&algorithm)
                .map(String::as_str)
                .unwrap_or("");
            text.push_str(&format!(
                "{}\r\n{}\r\n\r\n",
                result.path.display(),
                result.error.as_deref().unwrap_or(hash)
            ));
        }
    });
    match summary {
        Ok(summary) => {
            if text.len() > 1_000_000 {
                text.push_str("结果过多，请在 VirusHelper 中查看完整列表。\r\n");
            }
            text.push_str(&format!(
                "完成 {} / {}，错误 {}{}",
                summary.completed,
                summary.total,
                summary.errors,
                if summary.cancelled {
                    "（已取消）"
                } else {
                    ""
                }
            ));
        }
        Err(error) => text.push_str(&error.to_string()),
    }
    text
}

fn start(state: &mut PageState, hwnd: HWND, algorithm: Algorithm) -> Result<()> {
    state.cancel.store(true, Ordering::Relaxed);
    state.cancel = Arc::new(AtomicBool::new(false));
    let cancel = state.cancel.clone();
    let paths = state.paths.clone();
    let (sender, receiver) = mpsc::channel();
    // Rust thread exit code lives in this DLL. Pin it before starting a worker
    // so closing a property sheet cannot unload the thread's return address.
    // Installers use versioned DLL filenames so upgrades can replace registration
    // while an older Explorer process is still holding this version.
    let mut module = HMODULE::default();
    unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
            PCWSTR(dialog as *const () as *const u16),
            &mut module,
        )?;
    }
    std::thread::Builder::new()
        .name("virushelper-property-hash".into())
        .spawn(move || {
            let _ = sender.send(hash_text(paths, algorithm, &cancel));
        })
        .map_err(|_| Error::from(E_FAIL))?;
    state.receiver = Some(receiver);
    unsafe {
        SetDlgItemTextW(hwnd, RESULTS, w!("正在计算…"))?;
        if SetTimer(Some(hwnd), 1, 100, None) == 0 {
            return Err(Error::from_thread());
        }
    }
    Ok(())
}

unsafe fn child(
    hwnd: HWND,
    class: PCWSTR,
    text: PCWSTR,
    id: i32,
    style: WINDOW_STYLE,
    rect: RECT,
) -> Result<HWND> {
    let mut rect = rect;
    unsafe {
        MapDialogRect(hwnd, &mut rect)?;
    }
    unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class,
            text,
            WS_CHILD | WS_VISIBLE | WS_TABSTOP | style,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
            Some(hwnd),
            Some(HMENU(id as usize as *mut _)),
            Some(HINSTANCE(crate::handler::module()?.0)),
            None,
        )
    }
}

unsafe fn initialize(hwnd: HWND, state: &mut PageState) -> Result<()> {
    let combo = unsafe {
        child(
            hwnd,
            w!("COMBOBOX"),
            w!(""),
            ALGORITHM,
            WINDOW_STYLE(CBS_DROPDOWNLIST as u32 | WS_VSCROLL.0),
            RECT {
                left: 8,
                top: 8,
                right: 110,
                bottom: 140,
            },
        )?
    };
    for algorithm in Algorithm::ALL {
        let name = HSTRING::from(algorithm.id().to_uppercase());
        unsafe {
            SendMessageW(
                combo,
                CB_ADDSTRING,
                None,
                Some(LPARAM(name.as_ptr() as isize)),
            );
        }
    }
    unsafe {
        SendMessageW(combo, CB_SETCURSEL, Some(WPARAM(0)), None);
        child(
            hwnd,
            w!("BUTTON"),
            w!("打开 VirusHelper / VT"),
            OPEN_APP,
            WINDOW_STYLE(BS_PUSHBUTTON as u32),
            RECT {
                left: 118,
                top: 8,
                right: 242,
                bottom: 23,
            },
        )?;
        let edit = child(
            hwnd,
            w!("EDIT"),
            w!(""),
            RESULTS,
            WS_BORDER
                | WS_VSCROLL
                | WS_HSCROLL
                | WINDOW_STYLE((ES_MULTILINE | ES_AUTOVSCROLL | ES_READONLY) as u32),
            RECT {
                left: 8,
                top: 32,
                right: 242,
                bottom: 210,
            },
        )?;
        SendMessageW(edit, EM_SETLIMITTEXT, Some(WPARAM(1_100_000)), None);
    }
    start(state, hwnd, Algorithm::Md5)
}

unsafe extern "system" fn dialog(
    hwnd: HWND,
    message: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> isize {
    if !matches!(message, WM_INITDIALOG | WM_COMMAND | WM_TIMER | WM_DESTROY) {
        return 0;
    }
    let pointer = if message == WM_INITDIALOG {
        let descriptor = unsafe { &*(lparam.0 as *const PROPSHEETPAGEW) };
        unsafe {
            SetWindowLongPtrW(hwnd, GWLP_USERDATA, descriptor.lParam.0);
        }
        descriptor.lParam.0 as *const Page
    } else {
        (unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) }) as *const Page
    };
    if pointer.is_null() {
        return 0;
    }
    // Synchronous Win32 calls can reenter this dialog. A shared reference to a
    // RefCell allows us to reject a reentrant mutation without aliased &mut.
    // Keep an Rc across callbacks, even if a nested call destroys the page.
    unsafe {
        Rc::increment_strong_count(pointer);
    }
    let page = unsafe { Rc::from_raw(pointer) };
    let Ok(mut state) = page.state.try_borrow_mut() else {
        return 0;
    };
    match message {
        WM_INITDIALOG => {
            if let Err(error) = unsafe { initialize(hwnd, &mut state) } {
                show_error(hwnd, &error);
            }
            return 1;
        }
        WM_COMMAND => {
            let id = (wparam.0 & 0xffff) as i32;
            let code = (wparam.0 >> 16) as u32;
            if id == ALGORITHM && code == CBN_SELCHANGE {
                if let Ok(combo) = unsafe { GetDlgItem(Some(hwnd), ALGORITHM) } {
                    let index = unsafe { SendMessageW(combo, CB_GETCURSEL, None, None) }.0 as usize;
                    if let Some(algorithm) = Algorithm::ALL.get(index) {
                        if let Err(error) = start(&mut state, hwnd, *algorithm) {
                            show_error(hwnd, &error);
                        }
                    }
                }
            } else if id == OPEN_APP && code == BN_CLICKED {
                if let Err(error) = crate::handler::launch(&state.paths) {
                    show_error(hwnd, &error);
                }
            }
        }
        WM_TIMER => {
            if let Some(receiver) = &state.receiver {
                match receiver.try_recv() {
                    Ok(text) => {
                        unsafe {
                            let _ = SetDlgItemTextW(hwnd, RESULTS, &HSTRING::from(text));
                            let _ = KillTimer(Some(hwnd), 1);
                        }
                        state.receiver = None;
                    }
                    Err(mpsc::TryRecvError::Disconnected) => {
                        show_error(hwnd, &Error::from(E_FAIL));
                        state.receiver = None;
                        unsafe {
                            let _ = KillTimer(Some(hwnd), 1);
                        }
                    }
                    Err(mpsc::TryRecvError::Empty) => {}
                }
            }
        }
        WM_DESTROY => {
            state.cancel.store(true, Ordering::Relaxed);
            state.receiver = None;
            unsafe {
                let _ = KillTimer(Some(hwnd), 1);
                SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
            }
        }
        _ => {}
    }
    0
}

fn show_error(hwnd: HWND, error: &Error) {
    unsafe {
        let _ = SetDlgItemTextW(hwnd, RESULTS, &HSTRING::from(format!("操作失败：{error}")));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_native_dialog_automatically_hashes_and_recomputes_after_algorithm_change() {
        // Test-owned hidden windows, never attached to Explorer or displayed.
        struct Window(HWND);
        impl Drop for Window {
            fn drop(&mut self) {
                unsafe {
                    let _ = DestroyWindow(self.0);
                }
            }
        }
        fn wait_for(hwnd: HWND, digest: &str) {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
            loop {
                unsafe {
                    let mut message = MSG::default();
                    while PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                        DispatchMessageW(&message);
                    }
                    let mut text = [0u16; 2048];
                    let length = GetDlgItemTextW(hwnd, RESULTS, &mut text) as usize;
                    if String::from_utf16_lossy(&text[..length]).contains(digest) {
                        return;
                    }
                }
                assert!(
                    std::time::Instant::now() < deadline,
                    "native dialog did not show expected digest"
                );
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("空 格 & 文件.txt");
        std::fs::write(&file, b"abc").unwrap();
        let page = Rc::new(Page {
            state: RefCell::new(PageState {
                paths: vec![file],
                cancel: Arc::new(AtomicBool::new(false)),
                receiver: None,
            }),
            template: template(),
            _lease: crate::lifetime::Lease::new(),
        });
        let descriptor = PROPSHEETPAGEW {
            lParam: LPARAM(Rc::as_ptr(&page) as isize),
            ..Default::default()
        };
        unsafe {
            let parent = Window(
                CreateWindowExW(
                    WINDOW_EX_STYLE::default(),
                    w!("STATIC"),
                    w!(""),
                    WS_POPUP,
                    0,
                    0,
                    600,
                    600,
                    None,
                    None,
                    None,
                    None,
                )
                .unwrap(),
            );
            let dialog = Window(
                CreateDialogIndirectParamW(
                    Some(HINSTANCE(crate::handler::module().unwrap().0)),
                    page.template.as_ptr().cast(),
                    Some(parent.0),
                    Some(super::dialog),
                    LPARAM(&descriptor as *const _ as isize),
                )
                .unwrap(),
            );
            assert!(!IsWindowVisible(parent.0).as_bool());
            wait_for(dialog.0, "900150983cd24fb0d6963f7d28e17f72");
            let combo = GetDlgItem(Some(dialog.0), ALGORITHM).unwrap();
            SendMessageW(combo, CB_SETCURSEL, Some(WPARAM(2)), None);
            SendMessageW(
                dialog.0,
                WM_COMMAND,
                Some(WPARAM(
                    ALGORITHM as usize | ((CBN_SELCHANGE as usize) << 16),
                )),
                Some(LPARAM(combo.0 as isize)),
            );
            wait_for(
                dialog.0,
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            );
        }
    }

    #[test]
    fn property_page_can_be_accepted_released_or_rejected_before_display() {
        unsafe extern "system" fn accept(page: HPROPSHEETPAGE, parameter: LPARAM) -> BOOL {
            unsafe {
                *(parameter.0 as *mut HPROPSHEETPAGE) = page;
            }
            TRUE
        }
        unsafe extern "system" fn reject(_: HPROPSHEETPAGE, _: LPARAM) -> BOOL {
            FALSE
        }
        let mut page = HPROPSHEETPAGE::default();
        add(
            vec![PathBuf::from("C:\\test.txt")],
            Some(accept),
            LPARAM(&mut page as *mut _ as isize),
        )
        .unwrap();
        assert!(!page.0.is_null());
        assert!(unsafe { DestroyPropertySheetPage(page) }.as_bool());
        add(vec![PathBuf::from("C:\\test.txt")], Some(reject), LPARAM(0)).unwrap();
    }
    #[test]
    fn property_results_default_md5_and_can_recompute_sha256_for_folders() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("中文.txt"), b"abc").unwrap();
        let paths = vec![dir.path().to_path_buf()];
        let cancel = AtomicBool::new(false);
        assert!(hash_text(paths.clone(), Algorithm::Md5, &cancel)
            .contains("900150983cd24fb0d6963f7d28e17f72"));
        assert!(hash_text(paths, Algorithm::Sha256, &cancel)
            .contains("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    }
}
