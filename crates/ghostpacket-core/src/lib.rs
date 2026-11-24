//! GhostPacket core: compact signed frames, acoustic 4-FSK modem and optical
//! Luby Transform fountain, exposed to JavaScript through `wasm-bindgen`.
//!
//! Every exported function returns `Result<_, JsValue>`; errors are plain
//! objects `{ code, message }` with a stable `code`.

pub mod channel_sim;
pub mod crypto;
pub mod error;
pub mod fec;
pub mod fountain;
pub mod fsk;
pub mod protocol;
pub mod schema;

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
    })
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
/// Returns metadata plus `frame: Uint8Array`.
#[wasm_bindgen]
pub fn encode_document(draft: JsValue, signing_seed: &[u8], flags: u8) -> Result<JsValue, JsValue> {
    let draft: DocumentDraft = serde_wasm_bindgen::from_value(draft)
        .map_err(|_| js_err(GhostError::InvalidArgument { what: "document draft" }))?;
    let encoded = protocol::encode_frame(draft, signing_seed, flags).map_err(js_err)?;
    let obj = to_js(&encoded)?;
    with_bytes(obj, "frame", &encoded.bytes)
}

/// Full verification (structure, CRC32, LZ4, schema, Ed25519).
/// `trusted_hex` is an array of 64-char hex public keys; empty = TOFU mode.
#[wasm_bindgen]
pub fn decode_frame(frame: &[u8], trusted_hex: JsValue) -> Result<JsValue, JsValue> {
    let list: Vec<String> = if trusted_hex.is_undefined() || trusted_hex.is_null() {
        Vec::new()
    } else {
        serde_wasm_bindgen::from_value(trusted_hex)
            .map_err(|_| js_err(GhostError::InvalidArgument { what: "trusted keys" }))?
    };
    let mut trusted = Vec::with_capacity(list.len());
    for hex in &list {
        let bytes = crypto::from_hex(hex).map_err(js_err)?;
        let key: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| js_err(GhostError::InvalidPublicKey))?;
        trusted.push(key);
    }
    let verified = protocol::decode_and_verify_frame(frame, &trusted).map_err(js_err)?;
    to_js(&verified)
}

/// Field-by-field dissection for the hex inspector (never fails).
#[wasm_bindgen]
pub fn inspect_frame(frame: &[u8]) -> Result<JsValue, JsValue> {
    to_js(&protocol::inspect_frame(frame))
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
