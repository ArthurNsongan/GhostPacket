//! Identity vault: an issuer's 32-byte Ed25519 seed sealed under a passphrase,
//! so a clinic or a treasurer keeps the same key (and fingerprint) across
//! sessions and a receiver's pin stays valid.
//!
//! ```text
//! [Magic "GPKV" 4][Version 1][Public key 32][salt 16][ChaCha20-Poly1305(seed) 32][tag 16]  = 101 bytes
//! ```
//! The key and nonce come from PBKDF2-HMAC-SHA256 (`VAULT_ITERATIONS`). The
//! magic, version and public key are associated data: swapping the public key
//! fails authentication. After decryption the seed must derive that public key.
//! The salt is fresh for every seal and comes from the caller.

use zeroize::Zeroizing;

use crate::crypto::{Keypair, PUBLIC_KEY_LEN};
use crate::encryption::{self, ENCRYPTION_OVERHEAD, SALT_LEN};
use crate::error::GhostError;

pub const VAULT_MAGIC: [u8; 4] = *b"GPKV";
pub const VAULT_VERSION: u8 = 0x01;
pub const SEED_LEN: usize = 32;
pub const VAULT_LEN: usize = 4 + 1 + PUBLIC_KEY_LEN + SEED_LEN + ENCRYPTION_OVERHEAD; // 101
/// A vault can be copied off the device and attacked offline: stretch harder
/// than broadcast frames (unlocked once per session, ~0.5 s in WASM on a desktop).
pub const VAULT_ITERATIONS: u32 = 210_000;
pub const MIN_VAULT_PASSPHRASE_BYTES: usize = 10;

fn header(public_key: &[u8; PUBLIC_KEY_LEN]) -> Vec<u8> {
    let mut h = Vec::with_capacity(4 + 1 + PUBLIC_KEY_LEN);
    h.extend_from_slice(&VAULT_MAGIC);
    h.push(VAULT_VERSION);
    h.extend_from_slice(public_key);
    h
}

/// Seals `seed` under `passphrase` with a fresh 16-byte `salt`.
pub fn seal_seed(seed: &[u8], passphrase: &[u8], salt: &[u8]) -> Result<Vec<u8>, GhostError> {
    if passphrase.len() < MIN_VAULT_PASSPHRASE_BYTES {
        return Err(GhostError::PassphraseTooShort {
            len: passphrase.len(),
            min: MIN_VAULT_PASSPHRASE_BYTES,
        });
    }
    if salt.len() != SALT_LEN {
        return Err(GhostError::InvalidSalt { len: salt.len() });
    }
    let public_key = Keypair::from_seed(seed)?.public_key();
    let mut out = header(&public_key);
    let sealed = encryption::seal_with(seed, &out, passphrase, salt, VAULT_ITERATIONS)?;
    out.extend_from_slice(&sealed);
    if out.len() != VAULT_LEN {
        return Err(GhostError::VaultInvalid);
    }
    Ok(out)
}

/// Public key stored in a vault (no passphrase needed: shown before unlocking).
pub fn vault_public_key(vault: &[u8]) -> Result<[u8; PUBLIC_KEY_LEN], GhostError> {
    if vault.len() != VAULT_LEN || vault.get(0..4) != Some(&VAULT_MAGIC[..]) || vault.get(4) != Some(&VAULT_VERSION) {
        return Err(GhostError::VaultInvalid);
    }
    vault
        .get(5..5 + PUBLIC_KEY_LEN)
        .and_then(|k| k.try_into().ok())
        .ok_or(GhostError::VaultInvalid)
}

/// Opens a vault. A wrong passphrase, an altered byte or a swapped public key
/// all give `VAULT_INVALID`; the seed is wiped when dropped.
pub fn open_seed(vault: &[u8], passphrase: &[u8]) -> Result<Zeroizing<Vec<u8>>, GhostError> {
    let public_key = vault_public_key(vault)?;
    let head = header(&public_key);
    let sealed = vault.get(head.len()..).ok_or(GhostError::VaultInvalid)?;
    let seed = encryption::open_with(sealed, &head, passphrase, VAULT_ITERATIONS).map_err(|e| match e {
        GhostError::PassphraseRequired | GhostError::PassphraseTooLong { .. } => e,
        _ => GhostError::VaultInvalid,
    })?;
    if seed.len() != SEED_LEN || Keypair::from_seed(&seed)?.public_key() != public_key {
        return Err(GhostError::VaultInvalid);
    }
    Ok(seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEED: [u8; 32] = [0x42; 32];
    const SALT: [u8; 16] = [9; 16];
    const PASS: &[u8] = b"baobab moon harmattan";

    #[test]
    fn roundtrip_keeps_the_identity() {
        let v = seal_seed(&SEED, PASS, &SALT).unwrap();
        assert_eq!(v.len(), VAULT_LEN);
        assert_eq!(vault_public_key(&v).unwrap(), Keypair::from_seed(&SEED).unwrap().public_key());
        assert_eq!(open_seed(&v, PASS).unwrap().as_slice(), &SEED);
    }

    #[test]
    fn wrong_passphrase_tamper_and_key_swap_fail() {
        let v = seal_seed(&SEED, PASS, &SALT).unwrap();
        assert_eq!(open_seed(&v, b"wrong passphrase").unwrap_err(), GhostError::VaultInvalid);
        let mut bad = v.clone();
        bad[60] ^= 1;
        assert_eq!(open_seed(&bad, PASS).unwrap_err(), GhostError::VaultInvalid);
        // Claim another identity: the public key is authenticated data.
        let mut swapped = v.clone();
        let other = Keypair::from_seed(&[7; 32]).unwrap().public_key();
        swapped[5..37].copy_from_slice(&other);
        assert_eq!(open_seed(&swapped, PASS).unwrap_err(), GhostError::VaultInvalid);
        assert_eq!(open_seed(&v[..50], PASS).unwrap_err(), GhostError::VaultInvalid);
    }

    #[test]
    fn short_passphrase_and_bad_salt_are_refused() {
        assert_eq!(seal_seed(&SEED, b"short", &SALT).unwrap_err(), GhostError::PassphraseTooShort { len: 5, min: 10 });
        assert_eq!(seal_seed(&SEED, PASS, &[0; 8]).unwrap_err(), GhostError::InvalidSalt { len: 8 });
        assert!(matches!(seal_seed(&[1; 31], PASS, &SALT).unwrap_err(), GhostError::InvalidSeed { .. }));
    }
}
