//! Optional end-to-end encryption of the frame payload (`FLAG_ENCRYPTED`).
//!
//! Sealed payload layout: `[salt 16 B][ChaCha20-Poly1305 ciphertext][tag 16 B]`.
//!
//! Key (32 B) and nonce (12 B) both come from
//! `PBKDF2-HMAC-SHA256(passphrase, salt, PBKDF2_ITERATIONS)`. The salt is
//! supplied by the caller (`crypto.getRandomValues` in the browser) and must be
//! fresh for every frame: a new salt gives a new key *and* a new nonce, so a
//! nonce is never reused under one key. The 8-byte frame header is passed as
//! associated data, so header tampering fails authentication.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Key, Nonce};
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

use crate::error::GhostError;

pub const SALT_LEN: usize = 16;
pub const TAG_LEN: usize = 16;
pub const ENCRYPTION_OVERHEAD: usize = SALT_LEN + TAG_LEN;
/// Work factor for passphrase stretching. Every encrypted frame is broadcast,
/// so an eavesdropper can guess offline: the count is as high as the 500 ms
/// local budget allows on a low-end phone (~90 ms in WASM on a desktop,
/// measured). OWASP's 600k for PBKDF2-SHA256 would take seconds on a phone, so
/// strength mostly comes from the passphrase: the UI asks for several words.
pub const PBKDF2_ITERATIONS: u32 = 40_000;
pub const MAX_PASSPHRASE_BYTES: usize = 128;

struct Material {
    key: [u8; 32],
    nonce: [u8; 12],
}

impl Drop for Material {
    fn drop(&mut self) {
        self.key.zeroize();
        self.nonce.zeroize();
    }
}

fn check_passphrase(passphrase: &[u8]) -> Result<(), GhostError> {
    if passphrase.is_empty() {
        return Err(GhostError::PassphraseRequired);
    }
    if passphrase.len() > MAX_PASSPHRASE_BYTES {
        return Err(GhostError::PassphraseTooLong {
            len: passphrase.len(),
        });
    }
    Ok(())
}

fn derive(passphrase: &[u8], salt: &[u8; SALT_LEN], iterations: u32) -> Material {
    let mut out = Zeroizing::new([0u8; 44]);
    pbkdf2::pbkdf2_hmac::<Sha256>(passphrase, salt, iterations, out.as_mut());
    let mut m = Material {
        key: [0u8; 32],
        nonce: [0u8; 12],
    };
    m.key.copy_from_slice(&out[..32]);
    m.nonce.copy_from_slice(&out[32..]);
    m
}

/// Encrypts `plain`; returns `salt || ciphertext || tag`.
pub fn seal(plain: &[u8], aad: &[u8], passphrase: &[u8], salt: &[u8]) -> Result<Vec<u8>, GhostError> {
    seal_with(plain, aad, passphrase, salt, PBKDF2_ITERATIONS)
}

/// [`seal`] with an explicit PBKDF2 work factor (the identity vault uses more).
pub fn seal_with(plain: &[u8], aad: &[u8], passphrase: &[u8], salt: &[u8], iterations: u32) -> Result<Vec<u8>, GhostError> {
    check_passphrase(passphrase)?;
    let salt: [u8; SALT_LEN] = salt
        .try_into()
        .map_err(|_| GhostError::InvalidSalt { len: salt.len() })?;
    let m = derive(passphrase, &salt, iterations);
    let cipher = ChaCha20Poly1305::new(&Key::from(m.key));
    let sealed = cipher
        .encrypt(&Nonce::from(m.nonce), Payload { msg: plain, aad })
        .map_err(|_| GhostError::InvalidArgument { what: "encryption" })?;
    let mut out = Vec::with_capacity(SALT_LEN + sealed.len());
    out.extend_from_slice(&salt);
    out.extend_from_slice(&sealed);
    Ok(out)
}

/// Decrypts `salt || ciphertext || tag`. A wrong passphrase, a wrong header or
/// any altered byte gives `DECRYPTION_FAILED` and no plaintext. The plaintext
/// is wiped from memory when dropped (also when later checks reject the frame).
pub fn open(sealed: &[u8], aad: &[u8], passphrase: &[u8]) -> Result<Zeroizing<Vec<u8>>, GhostError> {
    open_with(sealed, aad, passphrase, PBKDF2_ITERATIONS)
}

/// [`open`] with an explicit PBKDF2 work factor.
pub fn open_with(sealed: &[u8], aad: &[u8], passphrase: &[u8], iterations: u32) -> Result<Zeroizing<Vec<u8>>, GhostError> {
    check_passphrase(passphrase)?;
    if sealed.len() < ENCRYPTION_OVERHEAD {
        return Err(GhostError::DecryptionFailed);
    }
    let (salt_part, body) = sealed.split_at(SALT_LEN);
    let salt: [u8; SALT_LEN] = salt_part
        .try_into()
        .map_err(|_| GhostError::DecryptionFailed)?;
    let m = derive(passphrase, &salt, iterations);
    let cipher = ChaCha20Poly1305::new(&Key::from(m.key));
    cipher
        .decrypt(&Nonce::from(m.nonce), Payload { msg: body, aad })
        .map(Zeroizing::new)
        .map_err(|_| GhostError::DecryptionFailed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SALT: [u8; 16] = [7; 16];

    #[test]
    fn roundtrip() {
        let sealed = seal(b"hello ghost", b"hdr", b"pass", &SALT).unwrap();
        assert_eq!(sealed.len(), 11 + ENCRYPTION_OVERHEAD);
        assert_eq!(open(&sealed, b"hdr", b"pass").unwrap().as_slice(), b"hello ghost");
    }

    #[test]
    fn wrong_passphrase_aad_or_byte_fails() {
        let sealed = seal(b"hello ghost", b"hdr", b"pass", &SALT).unwrap();
        assert_eq!(open(&sealed, b"hdr", b"nope").unwrap_err(), GhostError::DecryptionFailed);
        assert_eq!(open(&sealed, b"HDR", b"pass").unwrap_err(), GhostError::DecryptionFailed);
        let mut bad = sealed.clone();
        bad[20] ^= 1;
        assert_eq!(open(&bad, b"hdr", b"pass").unwrap_err(), GhostError::DecryptionFailed);
        assert_eq!(open(&sealed[..10], b"hdr", b"pass").unwrap_err(), GhostError::DecryptionFailed);
    }

    #[test]
    fn fresh_salt_changes_everything() {
        let a = seal(b"same", b"", b"pass", &[1; 16]).unwrap();
        let b = seal(b"same", b"", b"pass", &[2; 16]).unwrap();
        assert_ne!(a[SALT_LEN..], b[SALT_LEN..]);
    }

    #[test]
    fn passphrase_and_salt_are_validated() {
        assert_eq!(seal(b"x", b"", b"", &SALT).unwrap_err(), GhostError::PassphraseRequired);
        assert_eq!(seal(b"x", b"", &[b'a'; 129], &SALT).unwrap_err(), GhostError::PassphraseTooLong { len: 129 });
        assert_eq!(seal(b"x", b"", b"p", &[0; 8]).unwrap_err(), GhostError::InvalidSalt { len: 8 });
    }
}
