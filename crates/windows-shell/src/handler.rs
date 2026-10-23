use std::{cell::RefCell, os::windows::process::CommandExt, path::PathBuf, process::Command};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        System::{Com::IDataObject, LibraryLoader::*, Registry::HKEY},
        UI::{Shell::Common::ITEMIDLIST, Shell::*, WindowsAndMessaging::*},
    },
};

#[implement(IShellExtInit, IContextMenu, IShellPropSheetExt)]
pub struct Handler {
    paths: RefCell<Vec<PathBuf>>,
    _lease: crate::lifetime::Lease,
}

impl IShellPropSheetExt_Impl for Handler_Impl {
    fn AddPages(
        &self,
        add: windows::Win32::UI::Controls::LPFNSVADDPROPSHEETPAGE,
        parameter: LPARAM,
    ) -> Result<()> {
        if self.paths.borrow().is_empty() {
            return Ok(());
        }
        crate::page::add(self.paths.borrow().clone(), add, parameter)
    }
    fn ReplacePage(
        &self,
        _: u32,
        _: windows::Win32::UI::Controls::LPFNSVADDPROPSHEETPAGE,
        _: LPARAM,
    ) -> Result<()> {
        Err(E_NOTIMPL.into())
    }
}
impl Handler {
    pub fn new() -> Self {
        Self {
            paths: RefCell::new(Vec::new()),
            _lease: crate::lifetime::Lease::new(),
        }
    }
}

impl IShellExtInit_Impl for Handler_Impl {
    fn Initialize(&self, _: *const ITEMIDLIST, data: Ref<IDataObject>, _: HKEY) -> Result<()> {
        self.paths.borrow_mut().clear();
        *self.paths.borrow_mut() =
            crate::selection::read(data.as_ref().ok_or_else(|| Error::from(E_INVALIDARG))?)?;
        Ok(())
    }
}

pub fn module() -> Result<HMODULE> {
    let mut handle = HMODULE::default();
    unsafe {
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            PCWSTR(crate::DllGetClassObject as *const () as *const u16),
            &mut handle,
        )?;
    }
    Ok(handle)
}

pub fn executable() -> Result<PathBuf> {
    use std::{ffi::OsString, os::windows::ffi::OsStringExt};
    let mut buffer = vec![0; 32768];
    let length = unsafe { GetModuleFileNameW(Some(module()?), &mut buffer) } as usize;
    if length == 0 || length == buffer.len() {
        return Err(Error::from_thread());
    }
    let dll = PathBuf::from(OsString::from_wide(&buffer[..length]));
    Ok(dll.with_file_name("virus-helper.exe"))
}

pub fn launch(paths: &[PathBuf]) -> Result<()> {
    if paths.is_empty() {
        return Err(E_INVALIDARG.into());
    }
    // Command performs Windows argument quoting. No cmd.exe or PowerShell is used.
    Command::new(executable()?)
        .arg("--")
        .args(paths)
        .creation_flags(0x08000000)
        .spawn()
        .map_err(|e| {
            Error::from_hresult(HRESULT::from_win32(e.raw_os_error().unwrap_or(1) as u32))
        })?;
    Ok(())
}

impl IContextMenu_Impl for Handler_Impl {
    fn QueryContextMenu(
        &self,
        menu: HMENU,
        index: u32,
        first: u32,
        last: u32,
        flags: u32,
    ) -> HRESULT {
        if flags & (CMF_DEFAULTONLY | CMF_NOVERBS) != 0
            || first > last
            || self.paths.borrow().is_empty()
        {
            return S_OK;
        }
        match unsafe {
            InsertMenuW(
                menu,
                index,
                MF_BYPOSITION | MF_STRING,
                first as usize,
                w!("使用 VirusHelper 计算哈希"),
            )
        } {
            Ok(()) => HRESULT(1),
            Err(error) => error.code(),
        }
    }
    fn InvokeCommand(&self, info: *const CMINVOKECOMMANDINFO) -> Result<()> {
        if info.is_null() {
            return Err(E_POINTER.into());
        }
        let info = unsafe { &*info };
        if info.cbSize < std::mem::size_of::<CMINVOKECOMMANDINFO>() as u32 {
            return Err(E_INVALIDARG.into());
        }
        let value = info.lpVerb.0 as usize;
        let valid = if value <= u16::MAX as usize {
            value == 0
        } else if info.fMask & SEE_MASK_UNICODE == SEE_MASK_UNICODE
            && info.cbSize >= std::mem::size_of::<CMINVOKECOMMANDINFOEX>() as u32
        {
            let extended = unsafe { &*(info as *const _ as *const CMINVOKECOMMANDINFOEX) };
            !extended.lpVerbW.is_null()
                && unsafe { extended.lpVerbW.to_string() }
                    .is_ok_and(|s| s.eq_ignore_ascii_case("VirusHelper.Hash"))
        } else {
            unsafe { info.lpVerb.to_string() }
                .is_ok_and(|s| s.eq_ignore_ascii_case("VirusHelper.Hash"))
        };
        if !valid {
            return Err(E_INVALIDARG.into());
        }
        launch(&self.paths.borrow())
    }
    fn GetCommandString(
        &self,
        id: usize,
        kind: u32,
        _: *const u32,
        output: PSTR,
        capacity: u32,
    ) -> Result<()> {
        if id != 0 {
            return Err(E_INVALIDARG.into());
        }
        if kind == GCS_VALIDATEA || kind == GCS_VALIDATEW {
            return Ok(());
        }
        if output.is_null() || capacity == 0 {
            return Err(E_POINTER.into());
        }
        let text = match kind {
            GCS_VERBA | GCS_VERBW => "VirusHelper.Hash",
            GCS_HELPTEXTA | GCS_HELPTEXTW => "Calculate file hashes with VirusHelper",
            _ => return Err(E_NOTIMPL.into()),
        };
        // COM specifies cchMax in UTF-16 characters for the Unicode variants.
        if kind & GCS_UNICODE != 0 {
            let utf16: Vec<u16> = text.encode_utf16().collect();
            let count = utf16.len().min(capacity as usize - 1);
            unsafe {
                std::ptr::copy_nonoverlapping(utf16.as_ptr(), output.0.cast(), count);
                *output.0.cast::<u16>().add(count) = 0;
            }
        } else {
            let count = text.len().min(capacity as usize - 1);
            unsafe {
                std::ptr::copy_nonoverlapping(text.as_ptr(), output.0, count);
                *output.0.add(count) = 0;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_files_add_one_command_at_the_shell_assigned_id() {
        let handler: IContextMenu = Handler::new().into();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.txt");
        std::fs::write(&path, "abc").unwrap();
        let selection = crate::selection::fixture::Selection::new(&[path]);
        let init: IShellExtInit = handler.cast().unwrap();
        unsafe {
            init.Initialize(None, selection.data.as_ref().unwrap(), None)
                .unwrap();
        }
        let menu = unsafe { CreatePopupMenu().unwrap() };
        assert_eq!(
            unsafe { handler.QueryContextMenu(menu, 0, 42, 99, 0) },
            HRESULT(1)
        );
        assert_eq!(unsafe { GetMenuItemCount(Some(menu)) }, 1);
        assert_eq!(unsafe { GetMenuItemID(menu, 0) }, 42);
        unsafe {
            DestroyMenu(menu).unwrap();
        }
    }

    #[test]
    fn empty_selection_and_default_only_queries_leave_the_menu_unchanged() {
        let handler: IContextMenu = Handler::new().into();
        let menu = unsafe { CreatePopupMenu().unwrap() };
        assert_eq!(
            unsafe { handler.QueryContextMenu(menu, 0, 42, 99, 0) },
            S_OK
        );
        assert_eq!(unsafe { GetMenuItemCount(Some(menu)) }, 0);
        unsafe {
            DestroyMenu(menu).unwrap();
        }
    }
}
