use std::sync::atomic::{AtomicUsize, Ordering};
static REFERENCES: AtomicUsize = AtomicUsize::new(0);
static LOCKS: AtomicUsize = AtomicUsize::new(0);
pub struct Lease;
impl Lease {
    pub fn new() -> Self {
        REFERENCES.fetch_add(1, Ordering::AcqRel);
        Self
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        REFERENCES.fetch_sub(1, Ordering::AcqRel);
    }
}
pub fn lock_server(lock: bool) {
    if lock {
        LOCKS.fetch_add(1, Ordering::AcqRel);
    } else {
        let _ = LOCKS.fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| n.checked_sub(1));
    }
}
pub fn can_unload() -> bool {
    REFERENCES.load(Ordering::Acquire) == 0 && LOCKS.load(Ordering::Acquire) == 0
}
