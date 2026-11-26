//! GhostPacket core: compact signed frames, acoustic 4-FSK modem and optical
//! Luby Transform fountain, exposed to JavaScript through `wasm-bindgen`.
//!
//! Every exported function returns `Result<_, JsValue>`; errors are plain
//! objects `{ code, message }` with a stable `code`.

pub mod channel_sim;
pub mod chroma;
pub mod crypto;
pub mod encryption;
pub mod error;
pub mod fec;
pub mod fountain;
pub mod fountain_wide;
pub mod fsk;
pub mod ofdm;
pub mod protocol;
pub mod schema;
pub mod vault;

use js_sys::{Reflect, Uint8Array};
use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::error::GhostError;
use crate::fsk::FskMode;
use crate::schema::DocumentDraft;

#[derive(Serialize)]
struct JsError {
    code: &'static str,
    message: String,
}

fn js_err(e: GhostError) -> JsValue {
    let payload = JsError {
        code: e.code(),
        message: e.to_string(),
    };
    serde_wasm_bindgen::to_value(&payload).unwrap_or_else(|_| JsValue::from_str(e.code()))
}

fn to_js<T: Serialize>(value: &T) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value)
        .map_err(|_| js_err(GhostError::InvalidArgument { what: "serialization" }))
}

fn with_bytes(obj: JsValue, key: &str, bytes: &[u8]) -> Result<JsValue, JsValue> {
    Reflect::set(&obj, &JsValue::from_str(key), &Uint8Array::from(bytes))?;
    Ok(obj)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Limits {
    max_frame_size: usize,
    max_payload_len: usize,
    min_frame_size: usize,
    overhead: usize,
    max_decompressed_bytes: usize,
    droplet_block_size: usize,
    max_samples: usize,
    max_sender_bytes: usize,
    max_title_bytes: usize,
    max_message_bytes: usize,
    encryption_overhead: usize,
    salt_len: usize,
    pbkdf2_iterations: u32,
    max_passphrase_bytes: usize,
    max_frame_size_v2: usize,
    max_image_bytes: usize,
    chroma_grid: usize,
    chroma_capacity: usize,
    ofdm_max_frame: usize,
    vault_len: usize,
    min_vault_passphrase_bytes: usize,
}

/// Crate version, for the UI footer and the MCP inspector.
#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Protocol bounds, so the UI never hard-codes them.
#[wasm_bindgen]
pub fn limits() -> Result<JsValue, JsValue> {
    to_js(&Limits {
        max_frame_size: protocol::MAX_FRAME_SIZE,
        max_payload_len: protocol::MAX_PAYLOAD_LEN,
        min_frame_size: protocol::MIN_FRAME_SIZE,
        overhead: protocol::OVERHEAD,
        max_decompressed_bytes: protocol::MAX_DECOMPRESSED_BYTES,
        droplet_block_size: fountain::DEFAULT_BLOCK_SIZE,
        max_samples: fsk::MAX_SAMPLES,
        max_sender_bytes: schema::MAX_SENDER_BYTES,
        max_title_bytes: schema::MAX_TITLE_BYTES,
        max_message_bytes: schema::MAX_MESSAGE_BYTES,
        encryption_overhead: encryption::ENCRYPTION_OVERHEAD,
        salt_len: encryption::SALT_LEN,
        pbkdf2_iterations: encryption::PBKDF2_ITERATIONS,
        max_passphrase_bytes: encryption::MAX_PASSPHRASE_BYTES,
        max_frame_size_v2: protocol::MAX_FRAME_SIZE_V2,
        max_image_bytes: schema::MAX_IMAGE_BYTES,
        chroma_grid: chroma::GRID,
        chroma_capacity: chroma::CHROMA_CAPACITY,
        ofdm_max_frame: ofdm::OFDM_MAX_FRAME,
        vault_len: vault::VAULT_LEN,
        min_vault_passphrase_bytes: vault::MIN_VAULT_PASSPHRASE_BYTES,
    })
}

/// Fingerprint of a 64-char hex Ed25519 public key (keyring / identity QR).
/// Rejects strings that are not a valid curve point.
#[wasm_bindgen]
pub fn fingerprint_of(public_key_hex: &str) -> Result<String, JsValue> {
    let key = parse_public_key(public_key_hex).map_err(js_err)?;
    Ok(crypto::fingerprint(&key))
}

fn parse_public_key(hex: &str) -> Result<[u8; 32], GhostError> {
    if hex.trim().len() != 64 {
        return Err(GhostError::InvalidPublicKey);
    }
    let bytes = crypto::from_hex(hex)?;
    let key: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| GhostError::InvalidPublicKey)?;
    crypto::validate_public_key(&key)?;
    Ok(key)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyInfo {
    public_key_hex: String,
    fingerprint: String,
}

/// Public key and fingerprint for a 32-byte signing seed.
#[wasm_bindgen]
pub fn key_info(seed: &[u8]) -> Result<JsValue, JsValue> {
    let kp = crypto::Keypair::from_seed(seed).map_err(js_err)?;
    let pk = kp.public_key();
    to_js(&KeyInfo {
        public_key_hex: crypto::to_hex(&pk),
        fingerprint: crypto::fingerprint(&pk),
    })
}

/// Serializes, compresses and signs a document draft.
/// With `passphrase` and a fresh 16-byte `salt`, the payload is encrypted
/// (ChaCha20-Poly1305, FLAG_ENCRYPTED). Returns metadata plus `frame: Uint8Array`.
#[wasm_bindgen]
pub fn encode_document(
    draft: JsValue,
    signing_seed: &[u8],
    flags: u8,
    passphrase: Option<String>,
    salt: Option<Vec<u8>>,
) -> Result<JsValue, JsValue> {
    let draft: DocumentDraft = serde_wasm_bindgen::from_value(draft)
        .map_err(|_| js_err(GhostError::InvalidArgument { what: "document draft" }))?;
    let encryption = match (&passphrase, &salt) {
        (Some(p), Some(s)) => Some(protocol::Encryption {
            passphrase: p.as_bytes(),
            salt: s.as_slice(),
        }),
        (Some(_), None) => return Err(js_err(GhostError::InvalidSalt { len: 0 })),
        (None, _) => None,
    };
    let encoded = protocol::encode_frame_with(draft, signing_seed, flags, encryption).map_err(js_err)?;
    let obj = to_js(&encoded)?;
    with_bytes(obj, "frame", &encoded.bytes)
}

/// Full verification (structure, CRC32, decryption, LZ4, schema, keyring, Ed25519).
/// `trusted_hex` is an array of 64-char hex public keys; empty = TOFU mode.
/// `passphrase` opens encrypted frames.
#[wasm_bindgen]
pub fn decode_frame(frame: &[u8], trusted_hex: JsValue, passphrase: Option<String>) -> Result<JsValue, JsValue> {
    // Bound the keyring before converting (and copying) its strings.
    if js_sys::Array::is_array(&trusted_hex) && js_sys::Array::from(&trusted_hex).length() > 256 {
        return Err(js_err(GhostError::InvalidArgument { what: "keyring size" }));
    }
    let list: Vec<String> = if trusted_hex.is_undefined() || trusted_hex.is_null() {
        Vec::new()
    } else {
        serde_wasm_bindgen::from_value(trusted_hex)
            .map_err(|_| js_err(GhostError::InvalidArgument { what: "trusted keys" }))?
    };
    if list.len() > 256 {
        return Err(js_err(GhostError::InvalidArgument { what: "keyring size" }));
    }
    let mut trusted = Vec::with_capacity(list.len());
    for hex in &list {
        trusted.push(parse_public_key(hex).map_err(js_err)?);
    }
    let verified = protocol::decode_and_verify_frame_with(frame, &trusted, passphrase.as_deref().map(str::as_bytes))
        .map_err(js_err)?;
    to_js(&verified)
}

/// Field-by-field dissection for the hex inspector (never fails).
#[wasm_bindgen]
pub fn inspect_frame(frame: &[u8], passphrase: Option<String>) -> Result<JsValue, JsValue> {
    to_js(&protocol::inspect_frame_with(frame, passphrase.as_deref().map(str::as_bytes)))
}

/// PCM burst for `frame`. `mode`: 0 = robust (15 ms), 1 = fast (6 ms).
#[wasm_bindgen]
pub fn fsk_modulate(frame: &[u8], sample_rate: u32, mode: u8) -> Result<Vec<f32>, JsValue> {
    let mode = FskMode::from_code(mode).map_err(js_err)?;
    fsk::modulate(frame, sample_rate, mode).map_err(js_err)
}

/// Finds and decodes one burst. Returns metadata plus `frame: Uint8Array`.
#[wasm_bindgen]
pub fn fsk_demodulate(samples: &[f32], sample_rate: u32, mode: u8) -> Result<JsValue, JsValue> {
    let mode = FskMode::from_code(mode).map_err(js_err)?;
    let res = fsk::demodulate(samples, sample_rate, mode).map_err(js_err)?;
    let obj = to_js(&res)?;
    with_bytes(obj, "frame", &res.frame)
}

/// Burst duration in seconds.
#[wasm_bindgen]
pub fn fsk_burst_seconds(frame_len: usize, mode: u8) -> Result<f64, JsValue> {
    let mode = FskMode::from_code(mode).map_err(js_err)?;
    Ok(fsk::burst_seconds(frame_len, mode))
}

/// Adds white Gaussian noise at `snr_db` (deterministic for a given seed).
#[wasm_bindgen]
pub fn inject_awgn(samples: &[f32], snr_db: f32, seed: u32) -> Vec<f32> {
    channel_sim::inject_awgn(samples, snr_db, seed as u64)
}

/// Deterministic optical loss decision for droplet `index`.
#[wasm_bindgen]
pub fn is_dropped(seed: u32, index: u32, drop_pct: f32) -> bool {
    channel_sim::is_dropped(seed as u64, index as u64, drop_pct)
}

/// Copy of `frame` with one bit flipped (US-03 integrity demo).
#[wasm_bindgen]
pub fn flip_bit(frame: &[u8], byte_idx: usize, bit_idx: u8) -> Result<Vec<u8>, JsValue> {
    channel_sim::flip_bit(frame, byte_idx, bit_idx).map_err(js_err)
}

#[wasm_bindgen]
pub fn crc32(data: &[u8]) -> u32 {
    crc32fast::hash(data)
}

/// Hann-windowed FFT magnitude (dBFS) for the spectrogram.
#[wasm_bindgen]
pub struct Spectrum {
    inner: fsk::SpectrumAnalyzer,
}

#[wasm_bindgen]
impl Spectrum {
    #[wasm_bindgen(constructor)]
    pub fn new(size: usize) -> Result<Spectrum, JsValue> {
        Ok(Spectrum {
            inner: fsk::SpectrumAnalyzer::new(size).map_err(js_err)?,
        })
    }

    pub fn compute(&mut self, samples: &[f32]) -> Vec<f32> {
        self.inner.compute(samples)
    }
}

/// Fountain encoder (emitter side of the optical channel).
#[wasm_bindgen]
pub struct FountainTx {
    inner: fountain::FountainEncoder,
}

#[wasm_bindgen]
impl FountainTx {
    #[wasm_bindgen(constructor)]
    pub fn new(frame: &[u8], session: u16, block_size: usize) -> Result<FountainTx, JsValue> {
        Ok(FountainTx {
            inner: fountain::FountainEncoder::new(frame, session, block_size).map_err(js_err)?,
        })
    }

    pub fn k(&self) -> usize {
        self.inner.k()
    }

    #[wasm_bindgen(js_name = dropletLen)]
    pub fn droplet_len(&self) -> usize {
        self.inner.droplet_len()
    }

    pub fn droplet(&self, seed: u32) -> Vec<u8> {
        self.inner.droplet(seed)
    }

    #[wasm_bindgen(js_name = nextDroplet)]
    pub fn next_droplet(&mut self) -> Vec<u8> {
        self.inner.next_droplet()
    }
}

/// Fountain decoder (receiver side of the optical channel).
#[wasm_bindgen]
pub struct FountainRx {
    inner: fountain::FountainDecoder,
}

impl Default for FountainRx {
    fn default() -> Self {
        FountainRx::new()
    }
}

#[wasm_bindgen]
impl FountainRx {
    #[wasm_bindgen(constructor)]
    pub fn new() -> FountainRx {
        FountainRx {
            inner: fountain::FountainDecoder::new(),
        }
    }

    pub fn ingest(&mut self, droplet: &[u8]) -> Result<JsValue, JsValue> {
        let step = self.inner.ingest(droplet).map_err(js_err)?;
        to_js(&step)
    }

    pub fn frame(&self) -> Result<Vec<u8>, JsValue> {
        self.inner.frame().map_err(js_err)
    }

    pub fn stats(&self) -> Result<JsValue, JsValue> {
        to_js(&self.inner.stats())
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

// --- V3: identity vault -----------------------------------------------------------

/// Seals a 32-byte signing seed under a passphrase (≥ 10 bytes) with a fresh 16-byte salt.
#[wasm_bindgen]
pub fn vault_seal(seed: &[u8], passphrase: &str, salt: &[u8]) -> Result<Vec<u8>, JsValue> {
    vault::seal_seed(seed, passphrase.as_bytes(), salt).map_err(js_err)
}

/// Opens a vault; `VAULT_INVALID` on a wrong passphrase or any altered byte.
#[wasm_bindgen]
pub fn vault_open(vault_bytes: &[u8], passphrase: &str) -> Result<Uint8Array, JsValue> {
    // Copied straight into JS memory; the Rust copy is zeroized on drop.
    vault::open_seed(vault_bytes, passphrase.as_bytes()).map(|s| Uint8Array::from(&s[..])).map_err(js_err)
}

/// Public key and fingerprint stored in a vault (shown on the unlock screen).
#[wasm_bindgen]
pub fn vault_identity(vault_bytes: &[u8]) -> Result<JsValue, JsValue> {
    let pk = vault::vault_public_key(vault_bytes).map_err(js_err)?;
    to_js(&KeyInfo {
        public_key_hex: crypto::to_hex(&pk),
        fingerprint: crypto::fingerprint(&pk),
    })
}

// --- V3: GPKT v2 (documents with an image) -------------------------------------------

/// Like `encode_document`, but builds a GPKT v2 frame (payload up to 128 KB).
#[wasm_bindgen]
pub fn encode_document_v2(
    draft: JsValue,
    signing_seed: &[u8],
    flags: u8,
    passphrase: Option<String>,
    salt: Option<Vec<u8>>,
) -> Result<JsValue, JsValue> {
    let draft: DocumentDraft = serde_wasm_bindgen::from_value(draft)
        .map_err(|_| js_err(GhostError::InvalidArgument { what: "document draft" }))?;
    let encryption = match (&passphrase, &salt) {
        (Some(p), Some(s)) => Some(protocol::Encryption { passphrase: p.as_bytes(), salt: s.as_slice() }),
        (Some(_), None) => return Err(js_err(GhostError::InvalidSalt { len: 0 })),
        (None, _) => None,
    };
    let encoded = protocol::encode_frame_v2_with(draft, signing_seed, flags, encryption).map_err(js_err)?;
    let obj = to_js(&encoded)?;
    with_bytes(obj, "frame", &encoded.bytes)
}

// --- V3: ChromaCrypt color matrix + wide fountain ------------------------------------

/// Emitter: splits a (v1 or v2) frame into wide-fountain droplets, one per matrix.
#[wasm_bindgen]
pub struct ChromaTx {
    inner: fountain_wide::WideEncoder,
}

#[wasm_bindgen]
impl ChromaTx {
    #[wasm_bindgen(constructor)]
    pub fn new(frame: &[u8], session: u16) -> Result<ChromaTx, JsValue> {
        let block = fountain_wide::block_size_for(chroma::CHROMA_CAPACITY);
        Ok(ChromaTx { inner: fountain_wide::WideEncoder::new(frame, session, block).map_err(js_err)? })
    }

    pub fn k(&self) -> usize {
        self.inner.k()
    }

    /// `GRID × GRID` palette indices (0..8, bits r g b) of the matrix for droplet `seed`.
    pub fn cells(&self, seed: u32) -> Result<Vec<u8>, JsValue> {
        chroma::encode(&self.inner.droplet(seed)).map_err(js_err)
    }

    pub fn droplet(&self, seed: u32) -> Vec<u8> {
        self.inner.droplet(seed)
    }
}

/// Receiver: camera image → matrix → droplet → wide fountain.
#[wasm_bindgen]
pub struct ChromaRx {
    inner: fountain_wide::WideDecoder,
}

impl Default for ChromaRx {
    fn default() -> Self {
        ChromaRx::new()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChromaScan {
    found: bool,
    error_code: Option<&'static str>,
    corners: Vec<[f32; 2]>,
    corrected_bytes: usize,
    step: Option<fountain_wide::WideStep>,
}

#[wasm_bindgen]
impl ChromaRx {
    #[wasm_bindgen(constructor)]
    pub fn new() -> ChromaRx {
        ChromaRx { inner: fountain_wide::WideDecoder::new() }
    }

    /// Reads one RGBA camera image. Never throws on an unreadable image:
    /// `found` is false with an `errorCode` (CHROMA_NOT_FOUND, CHROMA_UNCORRECTABLE…).
    pub fn scan(&mut self, rgba: &[u8], width: usize, height: usize) -> Result<JsValue, JsValue> {
        let scan = match chroma::decode(rgba, width, height) {
            Err(e) => ChromaScan { found: false, error_code: Some(e.code()), corners: Vec::new(), corrected_bytes: 0, step: None },
            Ok(d) => match self.inner.ingest(&d.packet) {
                Ok(step) => ChromaScan { found: true, error_code: None, corners: d.corners, corrected_bytes: d.corrected_bytes, step: Some(step) },
                Err(e) => ChromaScan { found: true, error_code: Some(e.code()), corners: d.corners, corrected_bytes: d.corrected_bytes, step: None },
            },
        };
        to_js(&scan)
    }

    /// Feeds a droplet directly (virtual loopback without pixels).
    pub fn ingest(&mut self, droplet: &[u8]) -> Result<JsValue, JsValue> {
        to_js(&self.inner.ingest(droplet).map_err(js_err)?)
    }

    pub fn frame(&self) -> Result<Vec<u8>, JsValue> {
        self.inner.frame().map_err(js_err)
    }

    /// Bytes known so far (unknown blocks zero), for progressive image reveal only.
    pub fn partial(&self) -> Vec<u8> {
        self.inner.partial()
    }

    #[wasm_bindgen(js_name = decodedMap)]
    pub fn decoded_map(&self) -> Vec<u8> {
        self.inner.decoded_map().into_iter().map(u8::from).collect()
    }

    pub fn reset(&mut self) {
        self.inner.reset();
    }
}

/// Palette index → [r, g, b] for the renderer.
#[wasm_bindgen]
pub fn chroma_palette() -> Vec<u8> {
    (0..8u8).flat_map(chroma::palette_rgb).collect()
}

// --- V3: acoustic OFDM -------------------------------------------------------------

/// PCM burst (32-carrier DQPSK OFDM, ≈ 4 kbit/s) for a frame up to 16 KB.
#[wasm_bindgen]
pub fn ofdm_modulate(frame: &[u8], sample_rate: u32) -> Result<Vec<f32>, JsValue> {
    ofdm::modulate(frame, sample_rate).map_err(js_err)
}

/// Finds and decodes one OFDM burst. Returns metadata plus `frame: Uint8Array`.
#[wasm_bindgen]
pub fn ofdm_demodulate(samples: &[f32], sample_rate: u32) -> Result<JsValue, JsValue> {
    let res = ofdm::demodulate(samples, sample_rate).map_err(js_err)?;
    let obj = to_js(&res)?;
    with_bytes(obj, "frame", &res.frame)
}

#[wasm_bindgen]
pub fn ofdm_burst_seconds(frame_len: usize, sample_rate: u32) -> f64 {
    ofdm::burst_seconds(frame_len, sample_rate)
}
