//! Noninteractive smoke test against registered COM and Explorer's menu provider.
#[cfg(windows)]
fn main() -> windows::core::Result<()> {
    use std::path::PathBuf;
    use windows::{
        core::*,
        Win32::{
            Foundation::*,
            System::Com::*,
            UI::{Controls::*, Shell::Common::ITEMIDLIST, Shell::*, WindowsAndMessaging::*},
        },
    };
    unsafe extern "system" fn accept(page: HPROPSHEETPAGE, parameter: LPARAM) -> BOOL {
        unsafe {
            *(parameter.0 as *mut HPROPSHEETPAGE) = page;
        }
        TRUE
    }
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        let arguments: Vec<_> = std::env::args_os().skip(1).collect();
        let invoke = arguments.iter().any(|a| a == "--invoke");
        let paths: Vec<PathBuf> = arguments
            .into_iter()
            .filter(|a| a != "--invoke")
            .map(PathBuf::from)
            .collect();
        assert!(
            !paths.is_empty(),
            "Pass absolute paths to test fixture files"
        );
        let mut pidls = Vec::new();
        for path in &paths {
            let mut pidl = std::ptr::null_mut();
            SHParseDisplayName(&HSTRING::from(path.as_os_str()), None, &mut pidl, 0, None)?;
            pidls.push(pidl);
        }
        let refs: Vec<*const ITEMIDLIST> = pidls.iter().map(|p| *p as *const _).collect();
        let desktop = SHGetDesktopFolder()?;
        let data: IDataObject = desktop.GetUIObjectOf(HWND::default(), &refs, None)?;
        let handler: IShellExtInit =
            CoCreateInstance(&virushelper_shell::CLSID, None, CLSCTX_INPROC_SERVER)?;
        handler.Initialize(None, &data, None)?;
        let menu_handler: IContextMenu = handler.cast()?;
        let menu = CreatePopupMenu()?;
        assert_eq!(
            menu_handler.QueryContextMenu(menu, 0, 42, 99, 0),
            HRESULT(1)
        );
        assert_eq!(GetMenuItemID(menu, 0), 42);
        DestroyMenu(menu)?;
        let pages: IShellPropSheetExt = handler.cast()?;
        let mut page = HPROPSHEETPAGE::default();
        pages.AddPages(Some(accept), LPARAM(&mut page as *mut _ as isize))?;
        assert!(!page.0.is_null());
        DestroyPropertySheetPage(page).ok()?;
        println!("Registered COM activation, Unicode multi-selection, menu command, property-page creation/release: PASS");

        // Ask the real filesystem menu provider to assemble a menu for fixture
        // paths. It is never displayed or attached to the user's windows.
        let parent: IShellFolder = SHBindToParent(pidls[0], None)?;
        let children: Vec<*const ITEMIDLIST> =
            pidls.iter().map(|p| ILFindLastID(*p) as *const _).collect();
        let shell_menu: IContextMenu = parent.GetUIObjectOf(HWND::default(), &children, None)?;
        let menu = CreatePopupMenu()?;
        shell_menu
            .QueryContextMenu(menu, 0, 1, 32767, CMF_NORMAL)
            .ok()?;
        let mut found = false;
        for index in 0..GetMenuItemCount(Some(menu)) {
            let mut name = [0u16; 512];
            let length = GetMenuStringW(menu, index as u32, Some(&mut name), MF_BYPOSITION);
            let name = String::from_utf16_lossy(&name[..length as usize]);
            if name.contains("VirusHelper") {
                found = true;
            }
        }
        DestroyMenu(menu)?;
        println!("Explorer filesystem provider includes VirusHelper in classic menu: {found}");
        assert!(
            found,
            "Registration is present but Explorer did not enumerate the handler"
        );
        if invoke {
            let info = CMINVOKECOMMANDINFO {
                cbSize: std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32,
                lpVerb: PCSTR::null(),
                nShow: SW_SHOWNORMAL.0,
                ..Default::default()
            };
            menu_handler.InvokeCommand(&info)?;
            println!("Invoked handler with all fixture paths: PASS");
        }
        drop((shell_menu, pages, menu_handler, handler, data, desktop));
        for pidl in pidls {
            CoTaskMemFree(Some(pidl.cast()));
        }
        CoUninitialize();
    }
    Ok(())
}

#[cfg(not(windows))]
fn main() {}
