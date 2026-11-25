//! Server-side verifier for GhostPacket proofs.
//!
//! A field device verifies a frame offline, keeps it in its outbox, and
//! uploads it when connectivity returns. The server must not trust the
//! device's verdict: it re-runs the full GPKT verification with the same Rust
//! code (`ghostpacket-core`) and keeps its own anti-replay ledger, so a voucher
//! redeemed on two offline devices is caught at sync time.
//!
//! Limits of the model (documented, not hidden): proofs travel over public
//! channels, so anyone who recorded a frame can submit it. A bearer token
//! (`GHOSTPACKET_TOKEN`) restricts submission to your own devices; it does not
//! say *which* device redeemed first.

pub mod http;

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use ghostpacket_core::crypto;
use ghostpacket_core::protocol::{decode_and_verify_frame_with, FLAG_ENCRYPTED, MAX_FRAME_SIZE};
use ghostpacket_core::schema::DocumentBody;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub const DEFAULT_MAX_LEDGER: usize = 100_000;

pub struct Config {
    /// Pinned issuer keys. Empty: accept any valid signer (trust on first use).
    pub trusted: Vec<[u8; 32]>,
    /// Opens encrypted proofs (must be the NFC form typed on the devices).
    /// Without it they are rejected with PASSPHRASE_REQUIRED: the issuer key is
    /// inside the encrypted document, so the signature cannot be checked.
    pub passphrase: Option<Zeroizing<String>>,
    /// JSONL file that persists the ledger across restarts.
    pub ledger_path: Option<PathBuf>,
    /// The single browser origin allowed to POST (also checked against `Origin`).
    pub allow_origin: Option<String>,
    /// Bearer token required for POST and detailed health (`None`: open).
    pub token: Option<Zeroizing<String>>,
    /// Ledger size cap: beyond it new proofs get 503 LEDGER_FULL.
    pub max_ledger: usize,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            trusted: Vec::new(),
            passphrase: None,
            ledger_path: None,
            allow_origin: None,
            token: None,
            max_ledger: DEFAULT_MAX_LEDGER,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LedgerRecord {
    pub key: String,
    pub doc_id: String,
    pub fingerprint: String,
    pub doc_type: u8,
    pub doc_timestamp: u64,
    pub received_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum Verdict {
    /// Valid and seen for the first time: recorded.
    Accepted {
        /// SHA-256 of the frame (hex): an opaque receipt.
        receipt: String,
        encrypted: bool,
        /// Metadata and document, omitted for encrypted proofs: an eavesdropper who
        /// replays an overheard ciphertext learns nothing but accepted / replay.
        #[serde(flatten, skip_serializing_if = "Option::is_none")]
        details: Option<Details>,
    },
    /// Valid, but the same document was already redeemed.
    Replay {
        receipt: String,
        first_received_at: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        doc_id: Option<String>,
    },
    /// Failed verification (stable GhostPacket error code).
    Rejected { code: String, message: String },
    /// Server-side problem: the client should retry later.
    Unavailable { code: String, message: String },
}

#[derive(Debug, Serialize)]
pub struct Details {
    pub doc_id: String,
    pub doc_type: u8,
    pub fingerprint: String,
    pub issuer_pubkey_hex: String,
    pub trusted_issuer: bool,
    pub doc_timestamp: u64,
    pub document: Option<Value>,
}

impl Verdict {
    pub fn http_status(&self) -> u16 {
        match self {
            Verdict::Accepted { .. } => 201,
            Verdict::Replay { .. } => 409,
            Verdict::Rejected { .. } => 422,
            Verdict::Unavailable { .. } => 503,
        }
    }
}

struct Ledger {
    map: HashMap<String, LedgerRecord>,
    /// The file does not end with a newline (torn last line after a crash).
    needs_newline: bool,
}

pub struct Verifier {
    config: Config,
    ledger: Mutex<Ledger>,
    /// One PBKDF2 at a time: crafted encrypted frames cannot saturate the CPU.
    decrypt_gate: Mutex<()>,
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn doc_id_text(id: &[u8; 8]) -> String {
    if id.iter().all(|b| (0x21..0x7f).contains(b) || *b == b' ') && id.first().is_some_and(|b| *b != b' ') {
        id.iter().map(|&b| b as char).collect::<String>().trim_end().to_string()
    } else {
        crypto::to_hex(id)
    }
}

fn receipt(frame: &[u8]) -> String {
    crypto::to_hex(&Sha256::digest(frame))
}

fn load_ledger(path: &PathBuf) -> Result<Ledger, String> {
    let mut map = HashMap::new();
    if !path.exists() {
        return Ok(Ledger { map, needs_newline: false });
    }
    let content = std::fs::read_to_string(path).map_err(|e| format!("ledger {} unreadable: {e}", path.display()))?;
    let needs_newline = !content.is_empty() && !content.ends_with('\n');
    let lines: Vec<&str> = content.lines().collect();
    let n = lines.len();
    for (i, line) in lines.iter().enumerate() {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        // A crash mid-append leaves a truncated record: it opens a JSON object but never closes it.
        // The record was never acknowledged (the 201 is sent after sync_data), so the client retries.
        // After a restart the server appends on a fresh line, so the fragment may sit mid-file.
        let torn = t.starts_with('{') && !t.ends_with('}');
        match serde_json::from_str::<LedgerRecord>(line) {
            Ok(r) => {
                map.insert(r.key.clone(), r);
            }
            Err(_) if torn || (i + 1 == n && needs_newline) => eprintln!("ledger: ignoring torn line {}", i + 1),
            // Anything else could hide redemptions: refuse to start.
            Err(e) => return Err(format!("ledger {} line {} is corrupt ({e}); fix or move the file", path.display(), i + 1)),
        }
    }
    Ok(Ledger { map, needs_newline })
}

impl Verifier {
    pub fn new(config: Config) -> Result<Self, String> {
        let ledger = match &config.ledger_path {
            Some(p) => load_ledger(p)?,
            None => Ledger { map: HashMap::new(), needs_newline: false },
        };
        Ok(Verifier {
            config,
            ledger: Mutex::new(ledger),
            decrypt_gate: Mutex::new(()),
        })
    }

    pub fn ledger_len(&self) -> usize {
        self.ledger.lock().map(|l| l.map.len()).unwrap_or(0)
    }

    pub fn allow_origin(&self) -> Option<&str> {
        self.config.allow_origin.as_deref()
    }

    pub fn token(&self) -> Option<&str> {
        self.config.token.as_deref().map(String::as_str)
    }

    /// Full GPKT verification, then the server-side anti-replay ledger.
    pub fn submit(&self, frame: &[u8]) -> Verdict {
        if frame.len() > MAX_FRAME_SIZE {
            return Verdict::Rejected {
                code: "FRAME_TOO_LARGE".into(),
                message: format!("Frame too large: {} bytes (maximum 512)", frame.len()),
            };
        }
        let encrypted = frame.get(5).is_some_and(|f| f & FLAG_ENCRYPTED != 0);
        let pass = self.config.passphrase.as_deref().map(|p| p.as_bytes());
        let result = if encrypted && pass.is_some() {
            let _gate = self.decrypt_gate.lock().unwrap_or_else(|p| p.into_inner());
            decode_and_verify_frame_with(frame, &self.config.trusted, pass)
        } else {
            decode_and_verify_frame_with(frame, &self.config.trusted, pass)
        };
        let v = match result {
            Ok(v) => v,
            Err(e) => {
                let code = e.code();
                // After decryption, distinct codes would act as an oracle: merge them.
                let structural = matches!(
                    code,
                    "FRAME_TOO_SHORT" | "FRAME_TOO_LARGE" | "INVALID_PREAMBLE" | "UNSUPPORTED_VERSION" | "INVALID_FLAGS" | "LENGTH_MISMATCH" | "PAYLOAD_EMPTY" | "CRC32_MISMATCH" | "PASSPHRASE_REQUIRED"
                );
                return if encrypted && !structural {
                    Verdict::Rejected { code: "ENCRYPTED_PROOF_REJECTED".into(), message: "Encrypted proof rejected".into() }
                } else {
                    Verdict::Rejected { code: code.into(), message: e.to_string() }
                };
            }
        };
        let doc_id = doc_id_text(&v.document.doc_id);
        // Full key and raw id: no 32-bit fingerprint collisions, no trimming ambiguity.
        let key = format!("{}/{}/{}", v.issuer_pubkey_hex, crypto::to_hex(&v.document.doc_id), v.document.timestamp);
        let receipt = receipt(frame);

        let mut ledger = self.ledger.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(first) = ledger.map.get(&key) {
            return Verdict::Replay {
                receipt,
                first_received_at: first.received_at,
                doc_id: (!v.encrypted).then_some(doc_id),
            };
        }
        if ledger.map.len() >= self.config.max_ledger {
            return Verdict::Unavailable { code: "LEDGER_FULL".into(), message: "Server ledger is full".into() };
        }
        let record = LedgerRecord {
            key: key.clone(),
            doc_id: doc_id.clone(),
            fingerprint: v.fingerprint.clone(),
            doc_type: v.doc_type,
            doc_timestamp: v.document.timestamp,
            received_at: now_secs(),
        };
        if let Some(path) = &self.config.ledger_path {
            // Persist (one write + fsync) before acknowledging: a crash must not forget a redemption.
            let Ok(json) = serde_json::to_string(&record) else {
                return Verdict::Unavailable { code: "LEDGER_WRITE_FAILED".into(), message: "Server ledger unavailable".into() };
            };
            let mut line = if ledger.needs_newline { String::from("\n") } else { String::new() };
            line.push_str(&json);
            line.push('\n');
            let written = OpenOptions::new()
                .create(true)
                .append(true)
                .open(path)
                .and_then(|mut f| f.write_all(line.as_bytes()).and_then(|_| f.sync_data()));
            if let Err(e) = written {
                ledger.needs_newline = true;
                eprintln!("ledger write failed: {e}");
                return Verdict::Unavailable { code: "LEDGER_WRITE_FAILED".into(), message: "Server ledger unavailable, retry later".into() };
            }
            ledger.needs_newline = false;
        }
        ledger.map.insert(key, record);

        let details = (!v.encrypted).then(|| Details {
            doc_id,
            doc_type: v.doc_type,
            fingerprint: v.fingerprint,
            issuer_pubkey_hex: v.issuer_pubkey_hex,
            trusted_issuer: v.trusted_issuer,
            doc_timestamp: v.document.timestamp,
            document: serde_json::to_value(&v.document.body).ok(),
        });
        Verdict::Accepted { receipt, encrypted: v.encrypted, details }
    }
}

/// Parses a 64-character hex Ed25519 public key (for `--trust`); weak keys are refused.
pub fn parse_key(hex: &str) -> Result<[u8; 32], String> {
    let bytes = crypto::from_hex(hex.trim()).map_err(|e| e.to_string())?;
    let key: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| format!("expected 32 bytes (64 hex characters), got {}", bytes.len()))?;
    crypto::validate_public_key(&key).map_err(|e| e.to_string())?;
    Ok(key)
}

/// Human summary of a document body, for CLI output.
pub fn describe(body: &DocumentBody) -> String {
    match body {
        DocumentBody::TontineReceipt { member, amount_minor, currency, .. } => format!("tontine receipt · {member} · {amount_minor} {currency}"),
        DocumentBody::MedicalPrescription { clinic, items, .. } => format!("prescription · {clinic} · {} item(s)", items.len()),
        DocumentBody::EmergencyVoucher { program, items, .. } => format!("aid voucher · {program} · {} item(s)", items.len()),
        DocumentBody::CustomMessage { sender, title, .. } => format!("message · {sender} · {title}"),
    }
}
