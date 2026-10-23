use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::PathBuf};
use windows::{
    core::*,
    Win32::{
        Foundation::*,
        System::{Com::*, Ole::ReleaseStgMedium},
        UI::Shell::*,
    },
};

struct Medium(STGMEDIUM);
impl Drop for Medium {
    fn drop(&mut self) {
        unsafe { ReleaseStgMedium(&mut self.0) };
    }
}

/// CF_HDROP contains UTF-16 paths, not shell command-line text.
pub fn read(data: &IDataObject) -> Result<Vec<PathBuf>> {
    let format = FORMATETC {
        cfFormat: 15,
        dwAspect: DVASPECT_CONTENT.0,
        lindex: -1,
        tymed: TYMED_HGLOBAL.0 as u32,
        ..Default::default()
    };
    let medium = Medium(unsafe { data.GetData(&format)? });
    if medium.0.tymed != TYMED_HGLOBAL.0 as u32 {
        return Err(E_INVALIDARG.into());
    }
    let drop = HDROP(unsafe { medium.0.u.hGlobal.0 });
    let count = unsafe { DragQueryFileW(drop, u32::MAX, None) };
    if count == 0 || count > 100_000 {
        return Err(E_INVALIDARG.into());
    }
    let mut paths = Vec::with_capacity(count as usize);
    for index in 0..count {
        let length = unsafe { DragQueryFileW(drop, index, None) };
        if length == 0 || length > 32767 {
            return Err(E_INVALIDARG.into());
        }
        let mut buffer = vec![0; length as usize + 1];
        if unsafe { DragQueryFileW(drop, index, Some(&mut buffer)) } != length {
            return Err(E_INVALIDARG.into());
        }
        let path = PathBuf::from(OsString::from_wide(&buffer[..length as usize]));
        if !path.is_absolute() {
            return Err(E_INVALIDARG.into());
        }
        paths.push(path);
    }
    Ok(paths)
}

#[cfg(test)]
pub(crate) mod fixture {
    use super::*;
    use windows::Win32::UI::Shell::Common::ITEMIDLIST;

    pub struct Selection {
        pub data: Option<IDataObject>,
        pidls: Vec<*mut ITEMIDLIST>,
    }
    impl Selection {
        pub fn new(paths: &[PathBuf]) -> Self {
            unsafe {
                CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            }
            let mut result = Self {
                data: None,
                pidls: Vec::new(),
            };
            for path in paths {
                let mut pidl = std::ptr::null_mut();
                let name = HSTRING::from(path.as_os_str());
                unsafe {
                    SHParseDisplayName(&name, None, &mut pidl, 0, None).unwrap();
                }
                result.pidls.push(pidl);
            }
            let pidls: Vec<_> = result
                .pidls
                .iter()
                .map(|p| *p as *const ITEMIDLIST)
                .collect();
            result.data = Some(unsafe {
                SHGetDesktopFolder()
                    .unwrap()
                    .GetUIObjectOf(HWND::default(), &pidls, None)
                    .unwrap()
            });
            result
        }
    }
    impl Drop for Selection {
        fn drop(&mut self) {
            self.data.take();
            unsafe {
                for pidl in &self.pidls {
                    CoTaskMemFree(Some(pidl.cast()));
                }
                CoUninitialize();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn extracts_multiple_unicode_paths_without_shell_interpretation() {
        let dir = tempfile::tempdir().unwrap();
        let paths = [
            dir.path().join("空 格 & 测试.txt"),
            dir.path().join("two.txt"),
        ];
        for path in &paths {
            std::fs::write(path, b"abc").unwrap();
        }
        let selection = fixture::Selection::new(&paths);
        assert_eq!(read(selection.data.as_ref().unwrap()).unwrap(), paths);
    }
}
