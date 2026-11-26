//! Protocol vectors: round-trips, size bounds (US-02) and rejection of every
//! corruption (US-03).

mod common;

use common::*;
use ghostpacket_core::channel_sim::flip_bit;
use ghostpacket_core::crypto::{self, Keypair};
use ghostpacket_core::error::GhostError;
use ghostpacket_core::fountain::Xorshift64Star;
use ghostpacket_core::protocol::{
    decode_and_verify_frame, encode_frame, inspect_frame, FLAG_LZ4, MAX_FRAME_SIZE, OVERHEAD,
};
use ghostpacket_core::schema::{DocumentBody, DocumentDraft};

#[test]
fn presets_roundtrip_and_respect_size_bounds() {
    for (name, draft) in presets() {
        let enc = encode(draft.clone());
        println!(
            "{name}: serialized {} B -> payload {} B (lz4 = {}) -> frame {} B",
            enc.serialized_len, enc.payload_len, enc.compressed, enc.frame_len
        );
        assert!(
            (150..=300).contains(&enc.payload_len),
            "{name}: payload {} B outside 150..=300",
            enc.payload_len
        );
        assert!(enc.frame_len <= MAX_FRAME_SIZE);
        assert_eq!(enc.frame_len, OVERHEAD + enc.payload_len);

        let ok = decode_and_verify_frame(&enc.bytes, &[]).expect("valid frame");
        assert_eq!(ok.document.body, draft.body);
        assert_eq!(ok.document.doc_id, draft.doc_id);
        assert_eq!(ok.document.timestamp, draft.timestamp);
        assert_eq!(ok.fingerprint, enc.fingerprint);
    }
}

#[test]
fn encoding_is_deterministic() {
    let a = encode(tontine());
    let b = encode(tontine());
    assert_eq!(a.bytes, b.bytes);
    assert_eq!(&a.bytes[0..4], b"GPKT");
    assert_eq!(a.bytes[4], 0x01);
}

#[test]
fn every_single_bit_flip_is_rejected() {
    for (name, draft) in presets() {
        let frame = encode(draft).bytes;
        for byte in 0..frame.len() {
            for bit in 0..8u8 {
                let bad = flip_bit(&frame, byte, bit).unwrap();
                let res = decode_and_verify_frame(&bad, &[]);
                assert!(res.is_err(), "{name}: flip at byte {byte} bit {bit} accepted");
            }
        }
    }
}

#[test]
fn payload_flip_reports_crc_mismatch() {
    let frame = encode(prescription()).bytes;
    let bad = flip_bit(&frame, 20, 3).unwrap();
    match decode_and_verify_frame(&bad, &[]) {
        Err(GhostError::CrcMismatch { .. }) => {}
        other => panic!("expected CRC32 mismatch, got {other:?}"),
    }
}

#[test]
fn signature_flip_reports_invalid_signature() {
    let frame = encode(voucher()).bytes;
    let last = frame.len() - 1;
    let bad = flip_bit(&frame, last, 0).unwrap();
    assert_eq!(
        decode_and_verify_frame(&bad, &[]).unwrap_err(),
        GhostError::InvalidSignature
    );
}

#[test]
fn resigned_content_with_recomputed_crc_is_still_rejected() {
    // Attacker edits the amount and fixes the CRC32 but cannot re-sign.
    let enc = encode(tontine());
    let mut frame = enc.bytes.clone();
    let n = enc.payload_len;
    frame[8 + n / 2] ^= 0x40;
    let crc = crc32fast::hash(&frame[..8 + n]);
    frame[8 + n..12 + n].copy_from_slice(&crc.to_be_bytes());
    let err = decode_and_verify_frame(&frame, &[]).unwrap_err();
    assert!(
        matches!(
            err,
            GhostError::InvalidSignature
                | GhostError::Lz4DecompressionFailed
                | GhostError::SchemaDecodeFailed
                | GhostError::FieldTooLong { .. }
        ),
        "got {err:?}"
    );
}

#[test]
fn structural_errors_have_explicit_codes() {
    let frame = encode(tontine()).bytes;

    let mut bad = frame.clone();
    bad[0] = b'X';
    assert_eq!(decode_and_verify_frame(&bad, &[]).unwrap_err().code(), "INVALID_PREAMBLE");

    let mut bad = frame.clone();
    bad[4] = 0x03;
    assert_eq!(decode_and_verify_frame(&bad, &[]).unwrap_err().code(), "UNSUPPORTED_VERSION");

    // A v1 frame relabelled as v2 is read with the v2 (u32) length: it cannot match.
    let mut bad = frame.clone();
    bad[4] = 0x02;
    assert_eq!(decode_and_verify_frame(&bad, &[]).unwrap_err().code(), "LENGTH_MISMATCH");

    let mut bad = frame.clone();
    bad[5] |= 0x80;
    assert_eq!(decode_and_verify_frame(&bad, &[]).unwrap_err().code(), "INVALID_FLAGS");

    let mut bad = frame.clone();
    bad[7] = bad[7].wrapping_add(1);
    assert_eq!(decode_and_verify_frame(&bad, &[]).unwrap_err().code(), "LENGTH_MISMATCH");

    assert_eq!(
        decode_and_verify_frame(&frame[..60], &[]).unwrap_err().code(),
        "FRAME_TOO_SHORT"
    );
    let mut long = frame.clone();
    long.resize(600, 0);
    assert_eq!(decode_and_verify_frame(&long, &[]).unwrap_err().code(), "FRAME_TOO_LARGE");
}

/// High-entropy ASCII so LZ4 cannot shrink it back under the limit.
fn noise_text(rng: &mut Xorshift64Star, len: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    (0..len)
        .map(|_| ALPHABET[rng.next_below(ALPHABET.len() as u64) as usize] as char)
        .collect()
}

#[test]
fn oversized_document_is_refused_before_framing() {
    let mut rng = Xorshift64Star::new(7);
    let draft = DocumentDraft {
        doc_id: *b"BIG-0001",
        timestamp: TIMESTAMP,
        body: DocumentBody::EmergencyVoucher {
            program: noise_text(&mut rng, 64),
            distributor: noise_text(&mut rng, 64),
            beneficiary_ref: noise_text(&mut rng, 64),
            items: (0..8)
                .map(|i| ghostpacket_core::schema::VoucherItem {
                    label: noise_text(&mut rng, 64),
                    quantity: 1_000_000 + i,
                    unit: "unit".into(),
                })
                .collect(),
            valid_until: TIMESTAMP,
            note: noise_text(&mut rng, 120),
        },
    };
    match encode_frame(draft, &SEED_A, 0) {
        Err(GhostError::PayloadTooLarge { len }) => assert!(len > 436),
        other => panic!("expected PAYLOAD_TOO_LARGE, got {other:?}"),
    }
}

#[test]
fn field_limits_are_enforced() {
    let mut draft = tontine();
    if let DocumentBody::TontineReceipt { member, .. } = &mut draft.body {
        *member = "m".repeat(65);
    }
    assert_eq!(
        encode_frame(draft, &SEED_A, 0).unwrap_err().code(),
        "FIELD_TOO_LONG"
    );
}

#[test]
fn lz4_bomb_is_blocked_before_allocation() {
    // Hand-built frame whose LZ4 prefix announces 1 MiB.
    let kp = Keypair::from_seed(&SEED_A).unwrap();
    let mut payload = (1u32 << 20).to_le_bytes().to_vec();
    payload.extend_from_slice(&[0x1F, 0x00, 0x01, 0x00, 0xFF, 0xFF, 0xFF, 0xFF]);
    let mut frame = b"GPKT".to_vec();
    frame.push(0x01);
    frame.push(FLAG_LZ4);
    frame.extend_from_slice(&(payload.len() as u16).to_be_bytes());
    frame.extend_from_slice(&payload);
    let crc = crc32fast::hash(&frame);
    frame.extend_from_slice(&crc.to_be_bytes());
    let sig = kp.sign(&frame);
    frame.extend_from_slice(&sig);
    assert_eq!(
        decode_and_verify_frame(&frame, &[]).unwrap_err(),
        GhostError::DecompressedTooLarge { len: 1 << 20 }
    );
}

#[test]
fn trusted_keyring_rejects_other_issuers() {
    let frame = encode(tontine()).bytes;
    let pk_a = Keypair::from_seed(&SEED_A).unwrap().public_key();
    let pk_b = Keypair::from_seed(&SEED_B).unwrap().public_key();
    let ok = decode_and_verify_frame(&frame, &[pk_a]).unwrap();
    assert!(ok.trusted_issuer);
    assert_eq!(
        decode_and_verify_frame(&frame, &[pk_b]).unwrap_err(),
        GhostError::UntrustedIssuer
    );
}

#[test]
fn fingerprint_format() {
    let pk = Keypair::from_seed(&SEED_A).unwrap().public_key();
    let fp = crypto::fingerprint(&pk);
    assert_eq!(fp.len(), 14);
    assert!(fp.starts_with("GPKT-"));
    assert_eq!(&fp[9..10], "-");
}

#[test]
fn inspector_flags_the_broken_field() {
    let enc = encode(tontine());
    let good = inspect_frame(&enc.bytes);
    assert!(good.ok);
    assert!(good.fields.iter().all(|f| f.valid != Some(false)));

    let bad = flip_bit(&enc.bytes, 10, 1).unwrap();
    let report = inspect_frame(&bad);
    assert!(!report.ok);
    assert_eq!(report.error_code, Some("CRC32_MISMATCH"));
    let crc = report.fields.iter().find(|f| f.name == "crc32").unwrap();
    assert_eq!(crc.valid, Some(false));
}

// --- V2: custom messages and end-to-end encryption ------------------------------

use ghostpacket_core::protocol::{decode_and_verify_frame_with, encode_frame_with, inspect_frame_with, Encryption, FLAG_ENCRYPTED};

const SALT: [u8; 16] = [0x5A; 16];
const PASS: &[u8] = b"baobab-moon-2026";

fn max_message() -> DocumentDraft {
    DocumentDraft {
        doc_id: *b"MSG-0001",
        timestamp: u64::MAX,
        // High-entropy text so LZ4 cannot help: worst case for the size budget.
        body: DocumentBody::CustomMessage {
            sender: noise_text(&mut Xorshift64Star::new(1), 48),
            title: noise_text(&mut Xorshift64Star::new(2), 60),
            message: noise_text(&mut Xorshift64Star::new(3), 240),
        },
    }
}

fn encrypt(draft: DocumentDraft) -> ghostpacket_core::protocol::EncodedFrame {
    encode_frame_with(draft, &SEED_A, DEMO_FLAGS, Some(Encryption { passphrase: PASS, salt: &SALT })).unwrap()
}

#[test]
fn custom_message_roundtrip_has_doc_type_4() {
    let draft = DocumentDraft {
        doc_id: *b"MSG-0042",
        timestamp: TIMESTAMP,
        body: DocumentBody::CustomMessage {
            sender: "Fatou Ndiaye".into(),
            title: "Meeting moved".into(),
            message: "The tontine meets Saturday at 10:00 under the baobab.".into(),
        },
    };
    let enc = encode(draft.clone());
    let ok = decode_and_verify_frame(&enc.bytes, &[]).unwrap();
    assert_eq!(ok.doc_type, 0x04);
    assert_eq!(ok.document.body, draft.body);
}

#[test]
fn custom_message_bounds_are_enforced() {
    for (field, sender, title, message) in [
        ("sender", 49, 1, 1),
        ("title", 1, 61, 1),
        ("message", 1, 1, 241),
    ] {
        let draft = DocumentDraft {
            doc_id: *b"MSG-0002",
            timestamp: TIMESTAMP,
            body: DocumentBody::CustomMessage {
                sender: "a".repeat(sender),
                title: "b".repeat(title),
                message: "c".repeat(message),
            },
        };
        match encode_frame(draft, &SEED_A, 0) {
            Err(GhostError::FieldTooLong { field: f, .. }) => assert_eq!(f, field),
            other => panic!("{field}: expected FIELD_TOO_LONG, got {other:?}"),
        }
    }
}

#[test]
fn largest_encrypted_custom_message_fits_512_bytes() {
    let enc = encrypt(max_message());
    println!("max encrypted message: payload {} B, frame {} B", enc.payload_len, enc.frame_len);
    assert!(enc.frame_len <= MAX_FRAME_SIZE);
    assert!(enc.encrypted && enc.flags & FLAG_ENCRYPTED != 0);
    let ok = decode_and_verify_frame_with(&enc.bytes, &[], Some(PASS)).unwrap();
    assert!(ok.encrypted);
    assert_eq!(ok.document.body, max_message().body);
}

#[test]
fn encrypted_frame_hides_plaintext_and_needs_the_passphrase() {
    let enc = encrypt(tontine());
    let needle = b"Aminata";
    assert!(!enc.bytes.windows(needle.len()).any(|w| w == needle), "plaintext leaked");
    assert_eq!(decode_and_verify_frame(&enc.bytes, &[]).unwrap_err(), GhostError::PassphraseRequired);
    assert_eq!(
        decode_and_verify_frame_with(&enc.bytes, &[], Some(b"wrong")).unwrap_err(),
        GhostError::DecryptionFailed
    );
    let ok = decode_and_verify_frame_with(&enc.bytes, &[], Some(PASS)).unwrap();
    assert_eq!(ok.document.body, tontine().body);
}

#[test]
fn encrypted_frames_reject_every_single_bit_flip() {
    let frame = encrypt(voucher()).bytes;
    for byte in 0..frame.len() {
        for bit in 0..8u8 {
            let bad = flip_bit(&frame, byte, bit).unwrap();
            assert!(
                decode_and_verify_frame_with(&bad, &[], Some(PASS)).is_err(),
                "flip at byte {byte} bit {bit} accepted"
            );
        }
    }
}

#[test]
fn tampered_ciphertext_with_fixed_crc_fails_decryption() {
    let enc = encrypt(prescription());
    let mut frame = enc.bytes.clone();
    let n = enc.payload_len;
    frame[8 + 20] ^= 0x01;
    let crc = crc32fast::hash(&frame[..8 + n]);
    frame[8 + n..12 + n].copy_from_slice(&crc.to_be_bytes());
    assert_eq!(
        decode_and_verify_frame_with(&frame, &[], Some(PASS)).unwrap_err(),
        GhostError::DecryptionFailed
    );
}

#[test]
fn caller_cannot_set_the_encrypted_flag_directly() {
    assert_eq!(
        encode_frame(tontine(), &SEED_A, FLAG_ENCRYPTED).unwrap_err().code(),
        "INVALID_FLAGS"
    );
}

#[test]
fn inspector_labels_encrypted_payload() {
    let enc = encrypt(tontine());
    let locked = inspect_frame(&enc.bytes);
    assert_eq!(locked.error_code, Some("PASSPHRASE_REQUIRED"));
    let payload = locked.fields.iter().find(|f| f.name == "payload").unwrap();
    assert!(payload.detail.contains("ENC"));
    assert!(inspect_frame_with(&enc.bytes, Some(PASS)).ok);
    let wrong = inspect_frame_with(&enc.bytes, Some(b"nope"));
    assert_eq!(wrong.error_code, Some("DECRYPTION_FAILED"));
    assert_eq!(wrong.fields.iter().find(|f| f.name == "payload").unwrap().valid, Some(false));
}

#[test]
fn encryption_cost_is_within_budget() {
    let t0 = std::time::Instant::now();
    let enc = encrypt(tontine());
    let seal_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let t1 = std::time::Instant::now();
    decode_and_verify_frame_with(&enc.bytes, &[], Some(PASS)).unwrap();
    let open_ms = t1.elapsed().as_secs_f64() * 1000.0;
    println!("native release: seal {seal_ms:.1} ms, open+verify {open_ms:.1} ms");
    assert!(seal_ms < 500.0 && open_ms < 500.0);
}

#[test]
fn weak_and_invalid_public_keys_are_refused_for_pinning() {
    assert!(crypto::validate_public_key(&Keypair::from_seed(&SEED_A).unwrap().public_key()).is_ok());
    // All zeros decodes to a small-order point: valid encoding, useless key.
    assert_eq!(crypto::validate_public_key(&[0u8; 32]).unwrap_err(), GhostError::InvalidPublicKey);
    // The identity point (y = 1) is small order too.
    let mut identity = [0u8; 32];
    identity[0] = 1;
    assert_eq!(crypto::validate_public_key(&identity).unwrap_err(), GhostError::InvalidPublicKey);
}
