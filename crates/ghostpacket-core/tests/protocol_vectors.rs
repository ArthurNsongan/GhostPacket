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
    bad[4] = 0x02;
    assert_eq!(decode_and_verify_frame(&bad, &[]).unwrap_err().code(), "UNSUPPORTED_VERSION");

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
