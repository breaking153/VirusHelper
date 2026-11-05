use crate::file_format::{detect_format, FORMAT_SAMPLE_SIZE};
use crate::{Algorithm, HashError};
use digest::{Digest, DynDigest};
use std::{
    collections::BTreeMap,
    fs::File,
    io::Read,
    path::Path,
    sync::atomic::{AtomicBool, Ordering},
};

const BUFFER_SIZE: usize = 1024 * 1024;

enum HashState {
    Crypto(Box<dyn DynDigest>),
    Blake3(Box<blake3::Hasher>),
    Crc32(crc32fast::Hasher),
    Xxh64(xxhash_rust::xxh64::Xxh64),
}

impl HashState {
    fn new(algorithm: Algorithm) -> Self {
        match algorithm {
            Algorithm::Md5 => Self::Crypto(Box::new(md5::Md5::new())),
            Algorithm::Sha1 => Self::Crypto(Box::new(sha1::Sha1::new())),
            Algorithm::Sha256 => Self::Crypto(Box::new(sha2::Sha256::new())),
            Algorithm::Sha512 => Self::Crypto(Box::new(sha2::Sha512::new())),
            Algorithm::Sha3_256 => Self::Crypto(Box::new(sha3::Sha3_256::new())),
            Algorithm::Blake3 => Self::Blake3(Box::default()),
            Algorithm::Crc32 => Self::Crc32(crc32fast::Hasher::new()),
            Algorithm::Xxh64 => Self::Xxh64(xxhash_rust::xxh64::Xxh64::new(0)),
        }
    }

    fn update(&mut self, bytes: &[u8]) {
        match self {
            Self::Crypto(hasher) => hasher.update(bytes),
            Self::Blake3(hasher) => {
                hasher.update(bytes);
            }
            Self::Crc32(hasher) => hasher.update(bytes),
            Self::Xxh64(hasher) => hasher.update(bytes),
        }
    }

    fn finish(self) -> String {
        match self {
            Self::Crypto(hasher) => hasher
                .finalize()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
            Self::Blake3(hasher) => hasher.finalize().to_hex().to_string(),
            Self::Crc32(hasher) => format!("{:08x}", hasher.finalize()),
            Self::Xxh64(hasher) => format!("{:016x}", hasher.digest()),
        }
    }
}

pub fn hash_reader(
    reader: impl Read,
    algorithms: &[Algorithm],
    cancel: &AtomicBool,
    progress: impl FnMut(u64),
) -> Result<BTreeMap<Algorithm, String>, HashError> {
    hash_reader_with_format(reader, algorithms, cancel, progress).map(|result| result.hashes)
}

pub(crate) struct HashedFile {
    pub hashes: BTreeMap<Algorithm, String>,
    pub file_format: String,
}

fn hash_reader_with_format(
    mut reader: impl Read,
    algorithms: &[Algorithm],
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> Result<HashedFile, HashError> {
    if algorithms.is_empty() {
        return Err(HashError::InvalidInput("请至少选择一种哈希算法".into()));
    }
    let mut states: BTreeMap<_, _> = algorithms
        .iter()
        .map(|a| (*a, HashState::new(*a)))
        .collect();
    let mut buffer = vec![0; BUFFER_SIZE];
    let mut sample = Vec::with_capacity(FORMAT_SAMPLE_SIZE);
    let mut processed = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(HashError::Cancelled);
        }
        let length = match reader.read(&mut buffer) {
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            result => result?,
        };
        if length == 0 {
            break;
        }
        let take = length.min(FORMAT_SAMPLE_SIZE - sample.len());
        sample.extend_from_slice(&buffer[..take]);
        for state in states.values_mut() {
            state.update(&buffer[..length]);
        }
        processed += length as u64;
        progress(processed);
    }
    if processed == 0 {
        progress(0);
    }
    Ok(HashedFile {
        hashes: states
            .into_iter()
            .map(|(algorithm, state)| (algorithm, state.finish()))
            .collect(),
        file_format: detect_format(&sample, processed > sample.len() as u64),
    })
}

pub fn hash_file(
    path: &Path,
    algorithms: &[Algorithm],
    cancel: &AtomicBool,
    progress: impl FnMut(u64),
) -> Result<BTreeMap<Algorithm, String>, HashError> {
    hash_file_with_format(path, algorithms, cancel, progress).map(|result| result.hashes)
}

pub(crate) fn hash_file_with_format(
    path: &Path,
    algorithms: &[Algorithm],
    cancel: &AtomicBool,
    mut progress: impl FnMut(u64),
) -> Result<HashedFile, HashError> {
    let mut file = File::open(path)?;
    let before = file.metadata()?;
    if !before.is_file() {
        return Err(HashError::InvalidInput("只能计算常规文件".into()));
    }
    let mut read = 0;
    let hashes = hash_reader_with_format(&mut file, algorithms, cancel, |bytes| {
        read = bytes;
        progress(bytes);
    })?;
    let after = file.metadata()?;
    let current = std::fs::metadata(path)?;
    if read != before.len()
        || after.len() != before.len()
        || current.len() != before.len()
        || before.modified().ok() != after.modified().ok()
        || before.modified().ok() != current.modified().ok()
    {
        return Err(HashError::Changed);
    }
    Ok(hashes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detects_signatures_across_short_reads_in_the_existing_hash_stream() {
        struct ShortReads(std::io::Cursor<Vec<u8>>);
        impl Read for ShortReads {
            fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
                let n = buffer.len().min(2);
                self.0.read(&mut buffer[..n])
            }
        }
        let bytes = b"\x89PNG\r\n\x1a\n";
        let result = hash_reader_with_format(
            ShortReads(std::io::Cursor::new(bytes.to_vec())),
            &[Algorithm::Md5],
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(result.file_format, "PNG");
        let normal = hash_reader(
            std::io::Cursor::new(bytes),
            &[Algorithm::Md5],
            &AtomicBool::new(false),
            |_| {},
        )
        .unwrap();
        assert_eq!(result.hashes, normal);
    }
}
