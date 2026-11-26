//! GhostPacket binary frame (big-endian).
//!
//! ```text
//! Offset  Size  Field
//! 0       4     Sync preamble "GPKT" (0x47 0x50 0x4B 0x54)
//! 4       1     Version = 0x01
//! 5       1     Flags: b0 LZ4 | b1 FSK | b2 Fountain | b3 Demo | b4 Encrypted | b5..b7 reserved = 0
//! 6       2     Payload length N (u16 BE, 1..=436)
//! 8       N     Payload (postcard document, LZ4 block with u32 LE size prefix if b0)
//! 8+N     4     CRC32 (IEEE) of bytes 0..8+N
//! 12+N    64    Ed25519 signature of bytes 0..12+N
//! ```
//! Total = 76 + N bytes, at most 512.
//!
//! GPKT v2 (version 0x02) is identical except for a u32 BE payload length at
//! offset 6..10: total = 78 + N bytes, N ≤ 128 KB (documents with an image).

use serde::Serialize;

use crate::crypto::{self, Keypair, PUBLIC_KEY_LEN, SIGNATURE_LEN};
use crate::encryption::{self, ENCRYPTION_OVERHEAD};
use crate::error::GhostError;
use crate::schema::{DocumentDraft, GhostDocument};
use zeroize::Zeroizing;

pub const PREAMBLE: [u8; 4] = *b"GPKT";
pub const VERSION: u8 = 0x01;
pub const HEADER_LEN: usize = 8;
pub const CRC_LEN: usize = 4;
pub const OVERHEAD: usize = HEADER_LEN + CRC_LEN + SIGNATURE_LEN; // 76
pub const MAX_FRAME_SIZE: usize = 512;
pub const MAX_PAYLOAD_LEN: usize = MAX_FRAME_SIZE - OVERHEAD; // 436
pub const MIN_FRAME_SIZE: usize = OVERHEAD + 1; // 77
pub const MAX_DECOMPRESSED_BYTES: usize = 4096;

/// GPKT v2: same frame with a u32 payload length, for documents that carry an
/// image (streamed over ChromaCrypt or the fountain). v1 frames are unchanged.
pub const VERSION_V2: u8 = 0x02;
pub const HEADER_LEN_V2: usize = 10;
pub const OVERHEAD_V2: usize = HEADER_LEN_V2 + CRC_LEN + SIGNATURE_LEN; // 78
pub const MAX_PAYLOAD_LEN_V2: usize = 128 * 1024;
pub const MAX_FRAME_SIZE_V2: usize = OVERHEAD_V2 + MAX_PAYLOAD_LEN_V2; // 131 150
pub const MAX_DECOMPRESSED_BYTES_V2: usize = 136 * 1024;
/// Largest frame of any version, for transports and servers that bound input.
pub const MAX_ANY_FRAME_SIZE: usize = MAX_FRAME_SIZE_V2;

pub const FLAG_LZ4: u8 = 0b0000_0001;
pub const FLAG_FSK: u8 = 0b0000_0010;
pub const FLAG_FOUNTAIN: u8 = 0b0000_0100;
pub const FLAG_DEMO: u8 = 0b0000_1000;
pub const FLAG_ENCRYPTED: u8 = 0b0001_0000;
pub const FLAGS_RESERVED: u8 = 0b1110_0000;
/// Flags a caller may request; LZ4 and ENCRYPTED are decided by the encoder.
pub const FLAGS_CALLER: u8 = FLAG_FSK | FLAG_FOUNTAIN | FLAG_DEMO;

/// Per-version frame geometry and bounds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Layout {
    version: u8,
    header_len: usize,
    max_payload: usize,
    max_frame: usize,
    max_decompressed: usize,
}

const V1: Layout = Layout {
    version: VERSION,
    header_len: HEADER_LEN,
    max_payload: MAX_PAYLOAD_LEN,
    max_frame: MAX_FRAME_SIZE,
    max_decompressed: MAX_DECOMPRESSED_BYTES,
};

const V2: Layout = Layout {
    version: VERSION_V2,
    header_len: HEADER_LEN_V2,
    max_payload: MAX_PAYLOAD_LEN_V2,
    max_frame: MAX_FRAME_SIZE_V2,
    max_decompressed: MAX_DECOMPRESSED_BYTES_V2,
};

impl Layout {
    fn overhead(self) -> usize {
        self.header_len + CRC_LEN + SIGNATURE_LEN
    }

    fn write_len(self, out: &mut Vec<u8>, n: usize) -> Result<(), GhostError> {
        if self.version == VERSION {
            let v = u16::try_from(n).map_err(|_| GhostError::PayloadTooLarge { len: n })?;
            out.extend_from_slice(&v.to_be_bytes());
        } else {
            let v = u32::try_from(n).map_err(|_| GhostError::PayloadTooLarge { len: n })?;
            out.extend_from_slice(&v.to_be_bytes());
        }
        Ok(())
    }

    fn read_len(self, frame: &[u8]) -> Result<usize, GhostError> {
        if self.version == VERSION {
            Ok(u16::from_be_bytes([byte(frame, 6)?, byte(frame, 7)?]) as usize)
        } else {
            Ok(read_u32(frame, 6)? as usize)
        }
    }
}

/// Passphrase and fresh 16-byte salt for an encrypted frame.
pub struct Encryption<'a> {
    pub passphrase: &'a [u8],
    pub salt: &'a [u8],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EncodedFrame {
    #[serde(skip)]
    pub bytes: Vec<u8>,
    pub version: u8,
    pub frame_len: usize,
    pub serialized_len: usize,
    pub payload_len: usize,
    pub compressed: bool,
    pub encrypted: bool,
    pub flags: u8,
    pub crc32: u32,
    pub issuer_pubkey_hex: String,
    pub fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifiedFrame {
    pub document: GhostDocument,
    pub version: u8,
    pub doc_type: u8,
    pub frame_len: usize,
    pub payload_len: usize,
    pub decompressed_len: usize,
    pub compressed: bool,
    pub encrypted: bool,
    pub flags: u8,
    pub crc32: u32,
    pub issuer_pubkey_hex: String,
    pub fingerprint: String,
    pub trusted_issuer: bool,
    /// SHA-256 (hex) of the attached image, if the document carries one.
    pub image_sha256: Option<String>,
}

/// Builds, compresses, checksums and signs a plaintext frame.
pub fn encode_frame(
    draft: DocumentDraft,
    signing_seed: &[u8],
    caller_flags: u8,
) -> Result<EncodedFrame, GhostError> {
    encode_frame_with(draft, signing_seed, caller_flags, None)
}

/// Builds a v1 frame (≤ 512 bytes), optionally encrypting the payload, then
/// checksums and signs it. The signature covers the ciphertext, so a receiver
/// without the passphrase can still reject a tampered frame by its CRC32.
pub fn encode_frame_with(
    draft: DocumentDraft,
    signing_seed: &[u8],
    caller_flags: u8,
    encryption: Option<Encryption<'_>>,
) -> Result<EncodedFrame, GhostError> {
    encode_layout(draft, signing_seed, caller_flags, encryption, V1)
}

/// Builds a GPKT v2 frame (payload up to 128 KB), e.g. a document with an image.
pub fn encode_frame_v2_with(
    draft: DocumentDraft,
    signing_seed: &[u8],
    caller_flags: u8,
    encryption: Option<Encryption<'_>>,
) -> Result<EncodedFrame, GhostError> {
    encode_layout(draft, signing_seed, caller_flags, encryption, V2)
}

fn encode_layout(
    draft: DocumentDraft,
    signing_seed: &[u8],
    caller_flags: u8,
    encryption: Option<Encryption<'_>>,
    layout: Layout,
) -> Result<EncodedFrame, GhostError> {
    if caller_flags & !FLAGS_CALLER != 0 {
        return Err(GhostError::InvalidFlags {
            flags: caller_flags,
        });
    }
    let keypair = Keypair::from_seed(signing_seed)?;
    let pubkey = keypair.public_key();
    let document = GhostDocument::from_draft(draft, pubkey);
    let serialized = document.to_bytes()?;
    if serialized.len() > layout.max_decompressed {
        return Err(GhostError::DecompressedTooLarge {
            len: serialized.len(),
        });
    }

    let compressed_payload = compress_payload(&serialized)?;
    let (inner, compressed) = if compressed_payload.len() < serialized.len() {
        (compressed_payload, true)
    } else {
        (serialized.clone(), false)
    };
    if inner.is_empty() {
        return Err(GhostError::PayloadEmpty);
    }

    let encrypted = encryption.is_some();
    let n = inner.len() + if encrypted { ENCRYPTION_OVERHEAD } else { 0 };
    // Size is checked before encrypting: nothing is spent on a frame that cannot ship.
    if n > layout.max_payload {
        return Err(GhostError::PayloadTooLarge { len: n });
    }
    let flags = caller_flags
        | if compressed { FLAG_LZ4 } else { 0 }
        | if encrypted { FLAG_ENCRYPTED } else { 0 };
    let mut frame = Vec::with_capacity(layout.overhead() + n);
    frame.extend_from_slice(&PREAMBLE);
    frame.push(layout.version);
    frame.push(flags);
    layout.write_len(&mut frame, n)?;
    let payload = match encryption {
        Some(e) => encryption::seal(&inner, &frame, e.passphrase, e.salt)?,
        None => inner,
    };
    if payload.len() != n {
        return Err(GhostError::InvalidArgument { what: "sealed payload length" });
    }
    frame.extend_from_slice(&payload);
    let crc = crc32fast::hash(&frame);
    frame.extend_from_slice(&crc.to_be_bytes());
    let signature = keypair.sign(&frame);
    frame.extend_from_slice(&signature);

    Ok(EncodedFrame {
        version: layout.version,
        frame_len: frame.len(),
        bytes: frame,
        serialized_len: serialized.len(),
        payload_len: n,
        compressed,
        encrypted,
        flags,
        crc32: crc,
        issuer_pubkey_hex: crypto::to_hex(&pubkey),
        fingerprint: crypto::fingerprint(&pubkey),
    })
}

/// Verifies a plaintext frame (an encrypted one gives `PASSPHRASE_REQUIRED`).
pub fn decode_and_verify_frame(
    frame: &[u8],
    trusted: &[[u8; PUBLIC_KEY_LEN]],
) -> Result<VerifiedFrame, GhostError> {
    decode_and_verify_frame_with(frame, trusted, None)
}

/// Verifies a v1 or v2 frame in the order fixed by the spec and returns the document:
/// size → preamble → version/flags → length → CRC32 → decrypt (if encrypted)
/// → bounded LZ4 → schema → keyring → strict Ed25519.
///
/// If `trusted` is non-empty, the issuer key must be one of them.
pub fn decode_and_verify_frame_with(
    frame: &[u8],
    trusted: &[[u8; PUBLIC_KEY_LEN]],
    passphrase: Option<&[u8]>,
) -> Result<VerifiedFrame, GhostError> {
    let header = check_structure(frame)?;
    let n = header.payload_len;
    let h = header.layout.header_len;

    let crc_offset = h + n;
    let actual_crc = crc32fast::hash(slice(frame, 0, crc_offset)?);
    let expected_crc = read_u32(frame, crc_offset)?;
    if actual_crc != expected_crc {
        return Err(GhostError::CrcMismatch {
            expected: expected_crc,
            actual: actual_crc,
        });
    }

    let payload = slice(frame, h, crc_offset)?;
    let encrypted = header.flags & FLAG_ENCRYPTED != 0;
    // Decrypted bytes are wiped on drop, including when a later step rejects the frame.
    let inner = if encrypted {
        let pass = passphrase.ok_or(GhostError::PassphraseRequired)?;
        encryption::open(payload, slice(frame, 0, h)?, pass)?
    } else {
        Zeroizing::new(payload.to_vec())
    };
    let compressed = header.flags & FLAG_LZ4 != 0;
    let serialized = if compressed {
        Zeroizing::new(decompress_payload(&inner, header.layout.max_decompressed)?)
    } else {
        inner
    };

    let document = GhostDocument::from_bytes(&serialized)?;
    let issuer = document.issuer_pubkey;
    let trusted_issuer = trusted.contains(&issuer);
    if !trusted.is_empty() && !trusted_issuer {
        return Err(GhostError::UntrustedIssuer);
    }

    let signed_end = crc_offset + CRC_LEN;
    let signed = slice(frame, 0, signed_end)?;
    let signature = slice(frame, signed_end, signed_end + SIGNATURE_LEN)?;
    crypto::verify(&issuer, signed, signature)?;

    Ok(VerifiedFrame {
        version: header.layout.version,
        doc_type: document.doc_type(),
        frame_len: frame.len(),
        payload_len: n,
        decompressed_len: serialized.len(),
        compressed,
        encrypted,
        flags: header.flags,
        crc32: expected_crc,
        issuer_pubkey_hex: crypto::to_hex(&issuer),
        fingerprint: crypto::fingerprint(&issuer),
        trusted_issuer,
        image_sha256: document.image_sha256(),
        document,
    })
}

struct Header {
    layout: Layout,
    flags: u8,
    payload_len: usize,
}

/// Steps 1–4 of the verification order: size, preamble, version/flags, length.
fn check_structure(frame: &[u8]) -> Result<Header, GhostError> {
    let len = frame.len();
    if len < MIN_FRAME_SIZE {
        return Err(GhostError::FrameTooShort { len });
    }
    if len > MAX_ANY_FRAME_SIZE {
        return Err(GhostError::FrameTooLarge { len });
    }
    if slice(frame, 0, 4)? != PREAMBLE {
        return Err(GhostError::InvalidPreamble);
    }
    let version = byte(frame, 4)?;
    let layout = match version {
        VERSION => V1,
        VERSION_V2 => V2,
        _ => return Err(GhostError::UnsupportedVersion { version }),
    };
    if len > layout.max_frame {
        return Err(GhostError::FrameTooLarge { len });
    }
    let flags = byte(frame, 5)?;
    if flags & FLAGS_RESERVED != 0 {
        return Err(GhostError::InvalidFlags { flags });
    }
    let n = layout.read_len(frame)?;
    if n == 0 {
        return Err(GhostError::PayloadEmpty);
    }
    let declared = layout.overhead().checked_add(n).ok_or(GhostError::LengthMismatch { declared: usize::MAX, actual: len })?;
    if n > layout.max_payload || declared != len {
        return Err(GhostError::LengthMismatch { declared, actual: len });
    }
    Ok(Header {
        layout,
        flags,
        payload_len: n,
    })
}

fn compress_payload(raw: &[u8]) -> Result<Vec<u8>, GhostError> {
    let size = u32::try_from(raw.len()).map_err(|_| GhostError::PayloadTooLarge { len: raw.len() })?;
    let block = lz4_flex::block::compress(raw);
    let mut out = Vec::with_capacity(4 + block.len());
    out.extend_from_slice(&size.to_le_bytes());
    out.extend_from_slice(&block);
    Ok(out)
}

/// LZ4 block with u32 LE size prefix. The declared size is checked against
/// the version's bound (4 KB in v1, 136 KB in v2) before any allocation (anti LZ4 bomb).
fn decompress_payload(payload: &[u8], max: usize) -> Result<Vec<u8>, GhostError> {
    let size_bytes: [u8; 4] = slice(payload, 0, 4)
        .map_err(|_| GhostError::Lz4DecompressionFailed)?
        .try_into()
        .map_err(|_| GhostError::Lz4DecompressionFailed)?;
    let declared = u32::from_le_bytes(size_bytes) as usize;
    if declared > max {
        return Err(GhostError::DecompressedTooLarge { len: declared });
    }
    if declared == 0 {
        return Err(GhostError::Lz4DecompressionFailed);
    }
    let block = payload.get(4..).ok_or(GhostError::Lz4DecompressionFailed)?;
    let out = lz4_flex::block::decompress(block, declared)
        .map_err(|_| GhostError::Lz4DecompressionFailed)?;
    if out.len() != declared {
        return Err(GhostError::Lz4DecompressionFailed);
    }
    Ok(out)
}

// --- Frame inspection (works on invalid frames too) -------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldSpan {
    pub name: &'static str,
    pub offset: usize,
    pub len: usize,
    /// `None` when the field could not be checked.
    pub valid: Option<bool>,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameInspection {
    pub frame_len: usize,
    pub fields: Vec<FieldSpan>,
    pub ok: bool,
    pub error_code: Option<&'static str>,
    pub error_message: Option<String>,
}

/// Splits a frame into its fields for the hex inspector, flagging each one.
pub fn inspect_frame(frame: &[u8]) -> FrameInspection {
    inspect_frame_with(frame, None)
}

/// Same as [`inspect_frame`], opening encrypted payloads with `passphrase`.
pub fn inspect_frame_with(frame: &[u8], passphrase: Option<&[u8]>) -> FrameInspection {
    let len = frame.len();
    let mut fields = Vec::new();

    let preamble_ok = frame.get(0..4).map(|p| p == PREAMBLE);
    fields.push(FieldSpan {
        name: "sync",
        offset: 0,
        len: 4.min(len),
        valid: preamble_ok,
        detail: "GPKT".into(),
    });
    if let Some(v) = frame.get(4) {
        fields.push(FieldSpan {
            name: "version",
            offset: 4,
            len: 1,
            valid: Some(*v == VERSION || *v == VERSION_V2),
            detail: format!("0x{v:02X}"),
        });
    }
    if let Some(f) = frame.get(5) {
        let mut names = Vec::new();
        if f & FLAG_LZ4 != 0 {
            names.push("LZ4");
        }
        if f & FLAG_FSK != 0 {
            names.push("FSK");
        }
        if f & FLAG_FOUNTAIN != 0 {
            names.push("FOUNTAIN");
        }
        if f & FLAG_DEMO != 0 {
            names.push("DEMO");
        }
        if f & FLAG_ENCRYPTED != 0 {
            names.push("ENC");
        }
        fields.push(FieldSpan {
            name: "flags",
            offset: 5,
            len: 1,
            valid: Some(f & FLAGS_RESERVED == 0),
            detail: format!("0x{f:02X} {}", names.join("|")),
        });
    }
    let layout = if frame.get(4) == Some(&VERSION_V2) { V2 } else { V1 };
    let len_bytes = layout.header_len - 6;
    let declared = if frame.len() >= layout.header_len { layout.read_len(frame).ok() } else { None };
    let header_len = layout.header_len;
    if let Some(n) = declared {
        fields.push(FieldSpan {
            name: "length",
            offset: 6,
            len: len_bytes,
            valid: Some((1..=layout.max_payload).contains(&n) && layout.overhead().checked_add(n) == Some(len)),
            detail: format!("N = {n}"),
        });
        let payload_end = header_len.saturating_add(n).min(len);
        if payload_end > header_len {
            let enc = frame.get(5).is_some_and(|f| f & FLAG_ENCRYPTED != 0);
            fields.push(FieldSpan {
                name: "payload",
                offset: header_len,
                len: payload_end - header_len,
                valid: None,
                detail: if enc {
                    format!("{} bytes · ENC ChaCha20-Poly1305", payload_end - header_len)
                } else {
                    format!("{} bytes", payload_end - header_len)
                },
            });
        }
        let crc_off = header_len.saturating_add(n);
        if let (Some(region), Ok(stored)) = (frame.get(0..crc_off), read_u32(frame, crc_off)) {
            let actual = crc32fast::hash(region);
            fields.push(FieldSpan {
                name: "crc32",
                offset: crc_off,
                len: CRC_LEN,
                valid: Some(actual == stored),
                detail: format!("stored 0x{stored:08X} / computed 0x{actual:08X}"),
            });
        }
        let sig_off = crc_off.saturating_add(CRC_LEN);
        if sig_off < len {
            let sig_len = (len - sig_off).min(SIGNATURE_LEN);
            fields.push(FieldSpan {
                name: "signature",
                offset: sig_off,
                len: sig_len,
                valid: None,
                detail: "Ed25519".into(),
            });
        }
    }

    let result = decode_and_verify_frame_with(frame, &[], passphrase);
    let (ok, code, message) = match &result {
        Ok(_) => (true, None, None),
        Err(e) => (false, Some(e.code()), Some(e.to_string())),
    };
    let sig_valid = match &result {
        Ok(_) => Some(true),
        Err(GhostError::InvalidSignature) => Some(false),
        Err(_) => None,
    };
    if let Some(field) = fields.iter_mut().find(|f| f.name == "signature") {
        field.valid = sig_valid;
    }
    if let Some(field) = fields.iter_mut().find(|f| f.name == "payload") {
        field.valid = match &result {
            Ok(_) => Some(true),
            Err(
                GhostError::DecryptionFailed
                | GhostError::Lz4DecompressionFailed
                | GhostError::DecompressedTooLarge { .. }
                | GhostError::SchemaDecodeFailed
                | GhostError::FieldTooLong { .. }
                | GhostError::TooManyItems { .. }
                | GhostError::ImageTooLarge { .. }
                | GhostError::ImageFormatInvalid,
            ) => Some(false),
            Err(_) => None,
        };
    }

    FrameInspection {
        frame_len: len,
        fields,
        ok,
        error_code: code,
        error_message: message,
    }
}

// --- Bounds-checked helpers --------------------------------------------------

fn slice(data: &[u8], start: usize, end: usize) -> Result<&[u8], GhostError> {
    data.get(start..end)
        .ok_or(GhostError::FrameTooShort { len: data.len() })
}

fn byte(data: &[u8], idx: usize) -> Result<u8, GhostError> {
    data.get(idx)
        .copied()
        .ok_or(GhostError::FrameTooShort { len: data.len() })
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32, GhostError> {
    let b: [u8; 4] = slice(data, offset, offset.saturating_add(4))?
        .try_into()
        .map_err(|_| GhostError::FrameTooShort { len: data.len() })?;
    Ok(u32::from_be_bytes(b))
}
