//! GPKT v2 frames (documents with an image) and the identity vault.

use ghostpacket_core::crypto::Keypair;
use ghostpacket_core::error::GhostError;
use ghostpacket_core::protocol::{
    decode_and_verify_frame, decode_and_verify_frame_with, encode_frame_v2_with, encode_frame_with, Encryption, FLAG_FOUNTAIN, MAX_FRAME_SIZE, VERSION_V2,
};
use ghostpacket_core::schema::{DocumentBody, DocumentDraft, IMAGE_MIME_JPEG, IMAGE_MIME_WEBP, MAX_IMAGE_BYTES};
use ghostpacket_core::vault;

const SEED: [u8; 32] = [0x11; 32];

/// A fake but well-formed WebP container of `len` bytes, incompressible content.
fn webp(len: usize) -> Vec<u8> {
    let mut v = Vec::with_capacity(len);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&((len - 8) as u32).to_le_bytes());
    v.extend_from_slice(b"WEBPVP8 ");
    let mut x: u32 = 0x1234_5678;
    while v.len() < len {
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        v.push(x as u8);
    }
    v
}

fn image_draft(image: Vec<u8>, mime: u8) -> DocumentDraft {
    DocumentDraft {
        doc_id: *b"IMG-0815",
        timestamp: 1_793_448_000,
        body: DocumentBody::ImageDocument {
            title: "Malaria RDT".into(),
            subject_ref: "PAT-0815 (F, 34 y)".into(),
            caption: "Rapid test, two lines: positive".into(),
            related_doc_id: *b"RX-77310",
            mime,
            width: 640,
            height: 480,
            image,
        },
    }
}

#[test]
fn image_document_roundtrips_in_a_v2_frame() {
    let img = webp(16 * 1024);
    let enc = encode_frame_v2_with(image_draft(img.clone(), IMAGE_MIME_WEBP), &SEED, FLAG_FOUNTAIN, None).unwrap();
    assert_eq!(enc.version, VERSION_V2);
    assert!(enc.frame_len > MAX_FRAME_SIZE);
    assert_eq!(enc.bytes[4], 0x02);
    let v = decode_and_verify_frame(&enc.bytes, &[]).unwrap();
    assert_eq!(v.version, 2);
    assert_eq!(v.doc_type, 5);
    match v.document.body {
        DocumentBody::ImageDocument { image, related_doc_id, .. } => {
            assert_eq!(image, img);
            assert_eq!(&related_doc_id, b"RX-77310");
        }
        other => panic!("unexpected body {other:?}"),
    }
    assert_eq!(v.image_sha256.as_deref().map(str::len), Some(64));
}

#[test]
fn a_large_image_does_not_fit_in_v1() {
    let err = encode_frame_with(image_draft(webp(4 * 1024), IMAGE_MIME_WEBP), &SEED, 0, None).unwrap_err();
    // The 4 KB v1 decompression bound or the 436-byte payload bound refuses it.
    assert!(matches!(err, GhostError::PayloadTooLarge { .. } | GhostError::DecompressedTooLarge { .. }), "{err:?}");
}

#[test]
fn encrypted_v2_needs_the_passphrase() {
    let enc = encode_frame_v2_with(
        image_draft(webp(8 * 1024), IMAGE_MIME_WEBP),
        &SEED,
        0,
        Some(Encryption { passphrase: b"baobab moon", salt: &[3; 16] }),
    )
    .unwrap();
    assert!(enc.encrypted);
    assert_eq!(decode_and_verify_frame(&enc.bytes, &[]).unwrap_err(), GhostError::PassphraseRequired);
    assert_eq!(decode_and_verify_frame_with(&enc.bytes, &[], Some(b"nope")).unwrap_err(), GhostError::DecryptionFailed);
    assert!(decode_and_verify_frame_with(&enc.bytes, &[], Some(b"baobab moon")).is_ok());
}

#[test]
fn tampered_image_is_caught_by_crc_then_signature() {
    let mut f = encode_frame_v2_with(image_draft(webp(12 * 1024), IMAGE_MIME_WEBP), &SEED, 0, None).unwrap().bytes;
    f[5000] ^= 0x10;
    assert_eq!(decode_and_verify_frame(&f, &[]).unwrap_err().code(), "CRC32_MISMATCH");
    // An attacker who also fixes the CRC still cannot fix the Ed25519 signature.
    let crc_off = f.len() - 64 - 4;
    let crc = crc32fast::hash(&f[..crc_off]);
    f[crc_off..crc_off + 4].copy_from_slice(&crc.to_be_bytes());
    let err = decode_and_verify_frame(&f, &[]).unwrap_err();
    assert!(matches!(err, GhostError::InvalidSignature | GhostError::SchemaDecodeFailed | GhostError::ImageFormatInvalid), "{err:?}");
}

#[test]
fn image_bounds_and_formats_are_enforced() {
    let err = encode_frame_v2_with(image_draft(webp(MAX_IMAGE_BYTES + 1), IMAGE_MIME_WEBP), &SEED, 0, None).unwrap_err();
    assert!(matches!(err, GhostError::ImageTooLarge { .. }), "{err:?}");
    // WebP bytes declared as JPEG.
    assert_eq!(encode_frame_v2_with(image_draft(webp(2048), IMAGE_MIME_JPEG), &SEED, 0, None).unwrap_err(), GhostError::ImageFormatInvalid);
    let mut zero = image_draft(webp(2048), IMAGE_MIME_WEBP);
    if let DocumentBody::ImageDocument { width, .. } = &mut zero.body {
        *width = 0;
    }
    assert_eq!(encode_frame_v2_with(zero, &SEED, 0, None).unwrap_err(), GhostError::ImageFormatInvalid);
}

#[test]
fn hostile_v2_headers_are_rejected_before_allocation() {
    let f = encode_frame_v2_with(image_draft(webp(2048), IMAGE_MIME_WEBP), &SEED, 0, None).unwrap().bytes;
    // Declared length u32::MAX: no overflow, no allocation, a length error.
    let mut huge = f.clone();
    huge[6..10].copy_from_slice(&u32::MAX.to_be_bytes());
    assert_eq!(decode_and_verify_frame(&huge, &[]).unwrap_err().code(), "LENGTH_MISMATCH");
    // A frame longer than the v2 bound.
    let long = vec![0u8; 131_151];
    assert_eq!(decode_and_verify_frame(&long, &[]).unwrap_err().code(), "FRAME_TOO_LARGE");
}

#[test]
fn vault_keeps_the_same_fingerprint_across_sessions() {
    let pass = b"baobab moon harmattan";
    let v = vault::seal_seed(&SEED, pass, &[5; 16]).unwrap();
    let reopened = vault::open_seed(&v, pass).unwrap();
    assert_eq!(Keypair::from_seed(&reopened).unwrap().public_key(), Keypair::from_seed(&SEED).unwrap().public_key());
    assert_eq!(vault::open_seed(&v, b"not the passphrase").unwrap_err(), GhostError::VaultInvalid);
}

// --- Round ledgers (LedgerBatchDelta, doc type 0x06) ---------------------------

fn ledger(n: usize) -> DocumentDraft {
    use ghostpacket_core::schema::LedgerEntry;
    DocumentDraft {
        doc_id: *b"LDG-0009",
        timestamp: 1_793_448_000,
        body: DocumentBody::LedgerBatchDelta {
            group: "Médina Women's Tontine, Dakar".into(),
            collector: "Fatou Ndiaye, treasurer".into(),
            currency: "XOF".into(),
            cycle: 9,
            entries: (0..n)
                .map(|i| LedgerEntry {
                    member: format!("Member {i:02} (member #{})", i + 17),
                    amount_minor: 25_000,
                    receipt_id: *format!("TNT-{i:04}").as_bytes().first_chunk::<8>().unwrap(),
                })
                .collect(),
            note: "Round 9 closed: every contribution in one signed frame.".into(),
        },
    }
}

#[test]
fn a_round_of_twenty_contributions_ships_in_one_v2_frame() {
    // Twenty entries do not fit a 512-byte v1 frame…
    assert!(matches!(encode_frame_with(ledger(20), &SEED, FLAG_FOUNTAIN, None).unwrap_err(), GhostError::PayloadTooLarge { .. }));
    // …but sign and verify as GPKT v2, well inside one OFDM burst (16 KB).
    let enc = encode_frame_v2_with(ledger(20), &SEED, FLAG_FOUNTAIN, None).unwrap();
    assert_eq!(enc.version, VERSION_V2);
    assert!(enc.frame_len < 16 * 1024, "{} B", enc.frame_len);
    let v = decode_and_verify_frame(&enc.bytes, &[]).unwrap();
    assert_eq!(v.doc_type, 6);
    match v.document.body {
        DocumentBody::LedgerBatchDelta { entries, cycle, .. } => {
            assert_eq!(entries.len(), 20);
            assert_eq!(cycle, 9);
            assert_eq!(&entries[3].receipt_id, b"TNT-0003");
        }
        other => panic!("unexpected body {other:?}"),
    }
    // Three entries still fit v1.
    assert!(encode_frame_with(ledger(3), &SEED, FLAG_FOUNTAIN, None).unwrap().frame_len <= MAX_FRAME_SIZE);
}

#[test]
fn malformed_round_ledgers_are_refused() {
    use ghostpacket_core::schema::MAX_LEDGER_ENTRIES;
    assert_eq!(encode_frame_v2_with(ledger(0), &SEED, 0, None).unwrap_err(), GhostError::LedgerBatchInvalid { reason: "no entry" });
    assert_eq!(
        encode_frame_v2_with(ledger(MAX_LEDGER_ENTRIES + 1), &SEED, 0, None).unwrap_err(),
        GhostError::TooManyItems { len: MAX_LEDGER_ENTRIES + 1, max: MAX_LEDGER_ENTRIES }
    );
    let mut dup = ledger(4);
    if let DocumentBody::LedgerBatchDelta { entries, .. } = &mut dup.body {
        entries[2].receipt_id = entries[0].receipt_id;
    }
    assert_eq!(encode_frame_v2_with(dup, &SEED, 0, None).unwrap_err(), GhostError::LedgerBatchInvalid { reason: "duplicate receipt id" });
    // Any payload byte changed (CRC re-computed by the attacker) is rejected.
    let enc = encode_frame_v2_with(ledger(20), &SEED, 0, None).unwrap();
    let crc_at = enc.bytes.len() - 68;
    for at in (10..crc_at).step_by(37) {
        let mut forged = enc.bytes.clone();
        forged[at] ^= 0x04;
        let crc = crc32fast::hash(&forged[..crc_at]);
        forged[crc_at..crc_at + 4].copy_from_slice(&crc.to_be_bytes());
        assert!(decode_and_verify_frame(&forged, &[]).is_err(), "byte {at} accepted");
    }
}

#[test]
fn hostile_ledgers_are_refused_while_decoding() {
    use ghostpacket_core::schema::{GhostDocument, MAX_LEDGER_AMOUNT, MAX_LEDGER_ENTRIES};
    // Serialized without validation, as an attacker would.
    let raw = |draft: DocumentDraft| postcard::to_allocvec(&GhostDocument::from_draft(draft, [0x22; 32])).unwrap();
    assert_eq!(GhostDocument::from_bytes(&raw(ledger(MAX_LEDGER_ENTRIES + 1))).unwrap_err(), GhostError::SchemaDecodeFailed);
    let mut dup = ledger(5);
    if let DocumentBody::LedgerBatchDelta { entries, .. } = &mut dup.body {
        entries[4].receipt_id = entries[1].receipt_id;
    }
    assert_eq!(GhostDocument::from_bytes(&raw(dup)).unwrap_err(), GhostError::LedgerBatchInvalid { reason: "duplicate receipt id" });
    let mut rich = ledger(2);
    if let DocumentBody::LedgerBatchDelta { entries, .. } = &mut rich.body {
        entries[0].amount_minor = MAX_LEDGER_AMOUNT + 1;
    }
    assert_eq!(GhostDocument::from_bytes(&raw(rich)).unwrap_err(), GhostError::LedgerBatchInvalid { reason: "amount too large" });
    assert!(GhostDocument::from_bytes(&raw(ledger(MAX_LEDGER_ENTRIES))).is_ok());
}
