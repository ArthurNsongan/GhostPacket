//! Deterministic error codes shared by every GhostPacket module.
//!
//! Each variant maps to a stable machine code (`SCREAMING_SNAKE_CASE`) that the
//! web UI displays as-is, plus a human-readable message.

use core::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GhostError {
    // --- Frame / protocol -------------------------------------------------
    FrameTooShort { len: usize },
    FrameTooLarge { len: usize },
    InvalidPreamble,
    UnsupportedVersion { version: u8 },
    InvalidFlags { flags: u8 },
    LengthMismatch { declared: usize, actual: usize },
    CrcMismatch { expected: u32, actual: u32 },
    Lz4DecompressionFailed,
    DecompressedTooLarge { len: usize },
    PayloadEmpty,
    PayloadTooLarge { len: usize },
    // --- Schema -----------------------------------------------------------
    SchemaEncodeFailed,
    SchemaDecodeFailed,
    FieldTooLong { field: &'static str, len: usize, max: usize },
    TooManyItems { len: usize, max: usize },
    // --- Crypto -----------------------------------------------------------
    PassphraseRequired,
    PassphraseTooLong { len: usize },
    InvalidSalt { len: usize },
    DecryptionFailed,
    InvalidSeed { len: usize },
    InvalidPublicKey,
    InvalidSignature,
    UntrustedIssuer,
    // --- Acoustic FSK -----------------------------------------------------
    InvalidSampleRate { rate: u32 },
    TooManySamples { len: usize },
    FskTooShort,
    FskNoPreamble,
    /// Preamble found at `sync_offset`, but the burst is not complete yet.
    FskIncomplete { sync_offset: usize },
    FskInvalidLength { len: usize },
    FecUncorrectable,
    // --- Optical fountain -------------------------------------------------
    DropletInvalid,
    DropletCrcMismatch,
    DropletSessionMismatch,
    FountainInvalidParams,
    FountainIncomplete,
    // --- Generic ----------------------------------------------------------
    InvalidArgument { what: &'static str },
}

impl GhostError {
    /// Stable machine-readable code displayed by the UI.
    pub fn code(&self) -> &'static str {
        match self {
            GhostError::FrameTooShort { .. } => "FRAME_TOO_SHORT",
            GhostError::FrameTooLarge { .. } => "FRAME_TOO_LARGE",
            GhostError::InvalidPreamble => "INVALID_PREAMBLE",
            GhostError::UnsupportedVersion { .. } => "UNSUPPORTED_VERSION",
            GhostError::InvalidFlags { .. } => "INVALID_FLAGS",
            GhostError::LengthMismatch { .. } => "LENGTH_MISMATCH",
            GhostError::CrcMismatch { .. } => "CRC32_MISMATCH",
            GhostError::Lz4DecompressionFailed => "LZ4_DECOMPRESSION_FAILED",
            GhostError::DecompressedTooLarge { .. } => "DECOMPRESSED_TOO_LARGE",
            GhostError::PayloadEmpty => "PAYLOAD_EMPTY",
            GhostError::PayloadTooLarge { .. } => "PAYLOAD_TOO_LARGE",
            GhostError::SchemaEncodeFailed => "SCHEMA_ENCODE_FAILED",
            GhostError::SchemaDecodeFailed => "SCHEMA_DECODE_FAILED",
            GhostError::FieldTooLong { .. } => "FIELD_TOO_LONG",
            GhostError::TooManyItems { .. } => "TOO_MANY_ITEMS",
            GhostError::PassphraseRequired => "PASSPHRASE_REQUIRED",
            GhostError::PassphraseTooLong { .. } => "PASSPHRASE_TOO_LONG",
            GhostError::InvalidSalt { .. } => "INVALID_SALT",
            GhostError::DecryptionFailed => "DECRYPTION_FAILED",
            GhostError::InvalidSeed { .. } => "INVALID_SEED",
            GhostError::InvalidPublicKey => "INVALID_PUBLIC_KEY",
            GhostError::InvalidSignature => "INVALID_SIGNATURE",
            GhostError::UntrustedIssuer => "UNTRUSTED_ISSUER",
            GhostError::InvalidSampleRate { .. } => "INVALID_SAMPLE_RATE",
            GhostError::TooManySamples { .. } => "TOO_MANY_SAMPLES",
            GhostError::FskTooShort => "FSK_TOO_SHORT",
            GhostError::FskNoPreamble => "FSK_NO_PREAMBLE",
            GhostError::FskIncomplete { .. } => "FSK_INCOMPLETE",
            GhostError::FskInvalidLength { .. } => "FSK_INVALID_LENGTH",
            GhostError::FecUncorrectable => "FEC_UNCORRECTABLE",
            GhostError::DropletInvalid => "DROPLET_INVALID",
            GhostError::DropletCrcMismatch => "DROPLET_CRC_MISMATCH",
            GhostError::DropletSessionMismatch => "DROPLET_SESSION_MISMATCH",
            GhostError::FountainInvalidParams => "FOUNTAIN_INVALID_PARAMS",
            GhostError::FountainIncomplete => "FOUNTAIN_INCOMPLETE",
            GhostError::InvalidArgument { .. } => "INVALID_ARGUMENT",
        }
    }
}

impl fmt::Display for GhostError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            GhostError::FrameTooShort { len } => {
                write!(f, "Frame too short: {len} bytes (minimum 77)")
            }
            GhostError::FrameTooLarge { len } => {
                write!(f, "Frame too large: {len} bytes (maximum 512)")
            }
            GhostError::InvalidPreamble => write!(f, "Invalid preamble (expected \"GPKT\")"),
            GhostError::UnsupportedVersion { version } => {
                write!(f, "Unsupported protocol version: 0x{version:02X}")
            }
            GhostError::InvalidFlags { flags } => {
                write!(f, "Reserved flag bits are set: 0x{flags:02X}")
            }
            GhostError::LengthMismatch { declared, actual } => write!(
                f,
                "Length mismatch: header declares {declared} bytes, frame holds {actual}"
            ),
            GhostError::CrcMismatch { expected, actual } => write!(
                f,
                "Integrity broken: CRC32 expected 0x{expected:08X}, computed 0x{actual:08X}"
            ),
            GhostError::Lz4DecompressionFailed => write!(f, "LZ4 decompression failed"),
            GhostError::DecompressedTooLarge { len } => write!(
                f,
                "Declared decompressed size {len} bytes > 4096 limit (LZ4 bomb blocked)"
            ),
            GhostError::PayloadEmpty => write!(f, "Empty payload"),
            GhostError::PayloadTooLarge { len } => {
                write!(f, "Payload of {len} bytes > 436 limit (frame ≤ 512 bytes)")
            }
            GhostError::SchemaEncodeFailed => write!(f, "Document serialization failed"),
            GhostError::SchemaDecodeFailed => write!(f, "Document unreadable after decompression"),
            GhostError::FieldTooLong { field, len, max } => {
                write!(f, "Field \"{field}\" too long: {len} bytes (max {max})")
            }
            GhostError::TooManyItems { len, max } => {
                write!(f, "Too many line items: {len} (max {max})")
            }
            GhostError::PassphraseRequired => {
                write!(f, "Encrypted frame: a passphrase is required to open it")
            }
            GhostError::PassphraseTooLong { len } => {
                write!(f, "Passphrase too long: {len} bytes (max 128)")
            }
            GhostError::InvalidSalt { len } => {
                write!(f, "Invalid encryption salt: {len} bytes (expected 16)")
            }
            GhostError::DecryptionFailed => write!(
                f,
                "Decryption failed: wrong passphrase or altered ciphertext (ChaCha20-Poly1305)"
            ),
            GhostError::InvalidSeed { len } => {
                write!(f, "Invalid Ed25519 seed: {len} bytes (expected 32)")
            }
            GhostError::InvalidPublicKey => write!(f, "Invalid Ed25519 public key"),
            GhostError::InvalidSignature => {
                write!(f, "Invalid Ed25519 signature: document forged or altered")
            }
            GhostError::UntrustedIssuer => {
                write!(f, "Unknown issuer: public key not in the trusted keyring")
            }
            GhostError::InvalidSampleRate { rate } => {
                write!(f, "Unsupported sample rate: {rate} Hz")
            }
            GhostError::TooManySamples { len } => {
                write!(f, "Signal too long: {len} samples")
            }
            GhostError::FskTooShort => write!(f, "Audio signal too short to hold a frame"),
            GhostError::FskNoPreamble => write!(f, "No FSK preamble detected"),
            GhostError::FskIncomplete { sync_offset } => write!(
                f,
                "Preamble locked at sample {sync_offset}, reception in progress"
            ),
            GhostError::FskInvalidLength { len } => {
                write!(f, "Invalid FSK frame length: {len}")
            }
            GhostError::FecUncorrectable => {
                write!(f, "Too many symbol errors: Reed-Solomon cannot correct them")
            }
            GhostError::DropletInvalid => write!(f, "Malformed fountain droplet"),
            GhostError::DropletCrcMismatch => write!(f, "Corrupted droplet (CRC16)"),
            GhostError::DropletSessionMismatch => {
                write!(f, "Droplet from another transmission session")
            }
            GhostError::FountainInvalidParams => write!(f, "Invalid fountain parameters"),
            GhostError::FountainIncomplete => write!(f, "Fountain reconstruction incomplete"),
            GhostError::InvalidArgument { what } => write!(f, "Invalid argument: {what}"),
        }
    }
}

impl std::error::Error for GhostError {}
