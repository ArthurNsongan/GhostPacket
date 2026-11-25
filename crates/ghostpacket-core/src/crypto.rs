//! Ed25519 signing and verification.
//!
//! The crate never draws randomness: the 32-byte signing seed comes from the
//! caller (`crypto.getRandomValues` in the browser, constants in tests).

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};

use crate::error::GhostError;

pub const SEED_LEN: usize = 32;
pub const PUBLIC_KEY_LEN: usize = 32;
pub const SIGNATURE_LEN: usize = 64;

pub struct Keypair {
    signing: SigningKey,
}

impl Keypair {
    pub fn from_seed(seed: &[u8]) -> Result<Self, GhostError> {
        let bytes: [u8; SEED_LEN] = seed
            .try_into()
            .map_err(|_| GhostError::InvalidSeed { len: seed.len() })?;
        Ok(Keypair {
            signing: SigningKey::from_bytes(&bytes),
        })
    }

    pub fn public_key(&self) -> [u8; PUBLIC_KEY_LEN] {
        self.signing.verifying_key().to_bytes()
    }

    pub fn sign(&self, message: &[u8]) -> [u8; SIGNATURE_LEN] {
        self.signing.sign(message).to_bytes()
    }
}

/// Checks that 32 bytes are a usable issuer key: a valid curve point that is
/// not of small order (such "weak" keys, e.g. all zeros, can never pass
/// `verify_strict`, so pinning one in a keyring would be meaningless).
pub fn validate_public_key(public_key: &[u8; PUBLIC_KEY_LEN]) -> Result<(), GhostError> {
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| GhostError::InvalidPublicKey)?;
    if key.is_weak() {
        return Err(GhostError::InvalidPublicKey);
    }
    Ok(())
}

/// Verifies `signature` over `message` with a raw 32-byte public key.
pub fn verify(
    public_key: &[u8; PUBLIC_KEY_LEN],
    message: &[u8],
    signature: &[u8],
) -> Result<(), GhostError> {
    let key = VerifyingKey::from_bytes(public_key).map_err(|_| GhostError::InvalidPublicKey)?;
    let sig_bytes: [u8; SIGNATURE_LEN] = signature
        .try_into()
        .map_err(|_| GhostError::InvalidSignature)?;
    let sig = Signature::from_bytes(&sig_bytes);
    // `verify_strict` rejects small-order keys and malleable signatures.
    key.verify_strict(message, &sig)
        .map_err(|_| GhostError::InvalidSignature)
}

/// Short human-checkable fingerprint: `GPKT-XXXX-XXXX` from SHA-256(pubkey).
pub fn fingerprint(public_key: &[u8; PUBLIC_KEY_LEN]) -> String {
    let digest = Sha256::digest(public_key);
    let mut out = String::with_capacity(14);
    out.push_str("GPKT-");
    for (i, byte) in digest.iter().take(4).enumerate() {
        if i == 2 {
            out.push('-');
        }
        out.push_str(&hex_byte(*byte));
    }
    out
}

pub fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&hex_byte(*b));
    }
    out
}

pub fn from_hex(text: &str) -> Result<Vec<u8>, GhostError> {
    let clean: Vec<u8> = text
        .bytes()
        .filter(|c| !c.is_ascii_whitespace())
        .collect();
    if !clean.len().is_multiple_of(2) {
        return Err(GhostError::InvalidArgument { what: "hex length" });
    }
    let mut out = Vec::with_capacity(clean.len() / 2);
    for pair in clean.chunks(2) {
        let hi = hex_val(pair.first().copied().unwrap_or(b'?'))?;
        let lo = hex_val(pair.get(1).copied().unwrap_or(b'?'))?;
        out.push((hi << 4) | lo);
    }
    Ok(out)
}

fn hex_val(c: u8) -> Result<u8, GhostError> {
    match c {
        b'0'..=b'9' => Ok(c - b'0'),
        b'a'..=b'f' => Ok(c - b'a' + 10),
        b'A'..=b'F' => Ok(c - b'A' + 10),
        _ => Err(GhostError::InvalidArgument { what: "hex digit" }),
    }
}

fn hex_byte(b: u8) -> String {
    const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
    let mut s = String::with_capacity(2);
    s.push(DIGITS[(b >> 4) as usize] as char);
    s.push(DIGITS[(b & 0x0F) as usize] as char);
    s
}
