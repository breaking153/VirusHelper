use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Algorithm {
    Md5,
    Sha1,
    Sha256,
    Sha512,
    #[serde(rename = "sha3-256")]
    Sha3_256,
    Blake3,
    Crc32,
    Xxh64,
}

impl Algorithm {
    pub const ALL: [Self; 8] = [
        Self::Md5,
        Self::Sha1,
        Self::Sha256,
        Self::Sha512,
        Self::Sha3_256,
        Self::Blake3,
        Self::Crc32,
        Self::Xxh64,
    ];

    pub fn id(self) -> &'static str {
        match self {
            Self::Md5 => "md5",
            Self::Sha1 => "sha1",
            Self::Sha256 => "sha256",
            Self::Sha512 => "sha512",
            Self::Sha3_256 => "sha3-256",
            Self::Blake3 => "blake3",
            Self::Crc32 => "crc32",
            Self::Xxh64 => "xxh64",
        }
    }

    pub fn hex_len(self) -> usize {
        match self {
            Self::Md5 => 32,
            Self::Sha1 => 40,
            Self::Sha256 | Self::Sha3_256 | Self::Blake3 => 64,
            Self::Sha512 => 128,
            Self::Crc32 => 8,
            Self::Xxh64 => 16,
        }
    }

    pub fn valid_hash(self, hash: &str) -> bool {
        hash.len() == self.hex_len() && hash.bytes().all(|b| b.is_ascii_hexdigit())
    }
}
