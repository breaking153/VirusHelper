#![cfg(windows)]

mod handler;
mod lifetime;
mod page;
mod selection;

use std::ffi::c_void;
use windows::{
    core::{implement, IUnknown, Interface, Ref, BOOL, GUID, HRESULT},
    Win32::{Foundation::*, System::Com::*},
};

pub const CLSID: GUID = GUID::from_u128(0x6f5d6c28_415b_48ee_b3e8_baad03a18d41);

#[implement(IClassFactory)]
struct Factory(lifetime::Lease);

impl IClassFactory_Impl for Factory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<IUnknown>,
        iid: *const GUID,
        out: *mut *mut c_void,
    ) -> windows::core::Result<()> {
        if out.is_null() || iid.is_null() {
            return Err(E_POINTER.into());
        }
        unsafe {
            *out = std::ptr::null_mut();
        }
        if outer.is_some() {
            return Err(CLASS_E_NOAGGREGATION.into());
        }
        let object: IUnknown = handler::Handler::new().into();
        unsafe { object.query(iid, out).ok() }
    }
    fn LockServer(&self, lock: BOOL) -> windows::core::Result<()> {
        lifetime::lock_server(lock.as_bool());
        Ok(())
    }
}

/// COM loader export.
///
/// # Safety
/// Non-null arguments must point to readable GUIDs and a writable output pointer.
#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    clsid: *const GUID,
    iid: *const GUID,
    out: *mut *mut c_void,
) -> HRESULT {
    if out.is_null() || iid.is_null() || clsid.is_null() {
        return E_POINTER;
    }
    unsafe {
        *out = std::ptr::null_mut();
    }
    if unsafe { *clsid } != CLSID {
        return CLASS_E_CLASSNOTAVAILABLE;
    }
    let factory: IClassFactory = Factory(lifetime::Lease::new()).into();
    unsafe { factory.query(iid, out) }
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> HRESULT {
    if lifetime::can_unload() {
        S_OK
    } else {
        S_FALSE
    }
}
