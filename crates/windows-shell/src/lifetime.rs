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
        let mut current = LOCKS.load(Ordering::Acquire);
        while current > 0 {
            match LOCKS.compare_exchange_weak(
                current,
                current - 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => break,
                Err(value) => current = value,
            }
        }
    }
}
pub fn can_unload() -> bool {
    REFERENCES.load(Ordering::Acquire) == 0 && LOCKS.load(Ordering::Acquire) == 0
}
