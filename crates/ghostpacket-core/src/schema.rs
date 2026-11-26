//! Structured field documents and their compact binary encoding (`postcard`).
//!
//! `postcard` writes no field names and uses varints, so a document holding a
//! 32-byte public key and ~200 bytes of text stays well under the 436-byte
//! payload limit.

use serde::{Deserialize, Serialize};
use sha2::Digest;

use crate::error::GhostError;

pub const MAX_FIELD_BYTES: usize = 64;
pub const MAX_NOTE_BYTES: usize = 120;
pub const MAX_ITEMS: usize = 8;

pub const DOC_TYPE_TONTINE: u8 = 0x01;
pub const DOC_TYPE_PRESCRIPTION: u8 = 0x02;
pub const DOC_TYPE_VOUCHER: u8 = 0x03;
pub const DOC_TYPE_MESSAGE: u8 = 0x04;
pub const DOC_TYPE_IMAGE: u8 = 0x05;
pub const DOC_TYPE_LEDGER_BATCH: u8 = 0x06;

/// A round ledger carries 1..=64 contributions: up to ~5.3 KB, so it needs GPKT
/// v2 above ~4 entries and still fits one OFDM burst (≤ 16 KB).
pub const MAX_LEDGER_ENTRIES: usize = 64;
/// Largest amount per entry: 64 entries still sum below 2^53, so JavaScript
/// numbers hold every amount and every total exactly.
pub const MAX_LEDGER_AMOUNT: u64 = (1u64 << 53) / MAX_LEDGER_ENTRIES as u64;

/// Image documents travel in GPKT v2 frames only (payload ≤ 128 KB).
pub const MAX_IMAGE_BYTES: usize = 64 * 1024;
pub const MAX_IMAGE_SIDE: u16 = 4096;
pub const IMAGE_MIME_WEBP: u8 = 1;
pub const IMAGE_MIME_JPEG: u8 = 2;
pub const IMAGE_MIME_PNG: u8 = 3;

/// Bounds of a free-form message. Worst case (incompressible text at every
/// bound, 10-byte timestamp varint) serializes to 403 bytes: with the 32 bytes
/// of encryption overhead that is 435 ≤ 436, so any valid message ships.
/// (A 64-byte title would overshoot by 3 bytes, hence 60.)
pub const MAX_SENDER_BYTES: usize = 48;
pub const MAX_TITLE_BYTES: usize = 60;
pub const MAX_MESSAGE_BYTES: usize = 240;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrescriptionItem {
    pub drug: String,
    pub dosage: String,
    pub days: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoucherItem {
    pub label: String,
    pub quantity: u32,
    pub unit: String,
}

/// One contribution inside a round ledger. `receipt_id` is the doc id of the
/// individual receipt handed to the member, so a phone can match its receipts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LedgerEntry {
    pub member: String,
    pub amount_minor: u64,
    pub receipt_id: [u8; 8],
}

/// Document body. The enum discriminant is the wire `doc_type`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentBody {
    #[serde(rename_all = "camelCase")]
    TontineReceipt {
        group: String,
        member: String,
        collector: String,
        amount_minor: u64,
        currency: String,
        cycle: u16,
        note: String,
    },
    #[serde(rename_all = "camelCase")]
    MedicalPrescription {
        clinic: String,
        practitioner: String,
        patient_ref: String,
        items: Vec<PrescriptionItem>,
        note: String,
    },
    #[serde(rename_all = "camelCase")]
    EmergencyVoucher {
        program: String,
        distributor: String,
        beneficiary_ref: String,
        items: Vec<VoucherItem>,
        valid_until: u64,
        note: String,
    },
    /// Free-form signed message typed by the user. postcard encodes the variant
    /// index: variants are only ever appended, never reordered.
    #[serde(rename_all = "camelCase")]
    CustomMessage {
        sender: String,
        title: String,
        message: String,
    },
    /// A compressed image (WebP, JPEG or PNG made by the sender's browser) with
    /// its context, e.g. a malaria rapid-test photo linked to a prescription.
    /// The bytes are inside the signed document. GPKT v2 only.
    #[serde(rename_all = "camelCase")]
    ImageDocument {
        title: String,
        subject_ref: String,
        caption: String,
        /// Id of a related document (e.g. the prescription); all zeros = none.
        related_doc_id: [u8; 8],
        mime: u8,
        width: u16,
        height: u16,
        #[serde(with = "bytes")]
        image: Vec<u8>,
    },
    /// A whole round of a savings group in one signed frame (V3): broadcast to
    /// every member phone at once over the OFDM chord.
    #[serde(rename_all = "camelCase")]
    LedgerBatchDelta {
        group: String,
        collector: String,
        currency: String,
        cycle: u16,
        #[serde(deserialize_with = "bounded_entries")]
        entries: Vec<LedgerEntry>,
        note: String,
    },
}

/// Deserializes at most `MAX_LEDGER_ENTRIES` entries: a hostile length cannot
/// make the decoder build a larger list before `validate` runs.
fn bounded_entries<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<LedgerEntry>, D::Error> {
    struct Entries;

    impl<'de> serde::de::Visitor<'de> for Entries {
        type Value = Vec<LedgerEntry>;

        fn expecting(&self, f: &mut core::fmt::Formatter) -> core::fmt::Result {
            f.write_str("at most 64 ledger entries")
        }

        fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<LedgerEntry>, A::Error> {
            let mut out = Vec::with_capacity(seq.size_hint().unwrap_or(0).min(MAX_LEDGER_ENTRIES));
            while let Some(e) = seq.next_element::<LedgerEntry>()? {
                if out.len() >= MAX_LEDGER_ENTRIES {
                    return Err(serde::de::Error::custom("too many ledger entries"));
                }
                out.push(e);
            }
            Ok(out)
        }
    }

    d.deserialize_seq(Entries)
}

/// (De)serializes `Vec<u8>` as a byte string: a `Uint8Array` in JavaScript, a
/// length-prefixed byte run in postcard (same wire bytes as a `Vec<u8>` sequence).
mod bytes {
    use serde::de::{SeqAccess, Visitor};
    use serde::{Deserializer, Serializer};

    pub fn serialize<S: Serializer>(v: &[u8], s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bytes(v)
    }

    struct BytesVisitor;

    impl<'de> Visitor<'de> for BytesVisitor {
        type Value = Vec<u8>;

        fn expecting(&self, f: &mut core::fmt::Formatter) -> core::fmt::Result {
            f.write_str("a byte string")
        }

        fn visit_bytes<E: serde::de::Error>(self, v: &[u8]) -> Result<Vec<u8>, E> {
            if v.len() > super::MAX_IMAGE_BYTES {
                return Err(E::custom("image too large"));
            }
            Ok(v.to_vec())
        }

        fn visit_byte_buf<E: serde::de::Error>(self, v: Vec<u8>) -> Result<Vec<u8>, E> {
            if v.len() > super::MAX_IMAGE_BYTES {
                return Err(E::custom("image too large"));
            }
            Ok(v)
        }

        fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Vec<u8>, A::Error> {
            // Bounded before growing: a hostile length cannot allocate more than the cap.
            let mut out = Vec::with_capacity(seq.size_hint().unwrap_or(0).min(super::MAX_IMAGE_BYTES));
            while let Some(b) = seq.next_element::<u8>()? {
                if out.len() >= super::MAX_IMAGE_BYTES {
                    return Err(serde::de::Error::custom("image too large"));
                }
                out.push(b);
            }
            Ok(out)
        }
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<u8>, D::Error> {
        d.deserialize_bytes(BytesVisitor)
    }
}

/// Container check by magic bytes: only formats the browser can decode safely.
pub fn image_format_ok(mime: u8, image: &[u8]) -> bool {
    match mime {
        IMAGE_MIME_WEBP => image.get(0..4) == Some(b"RIFF") && image.get(8..12) == Some(b"WEBP"),
        IMAGE_MIME_JPEG => image.get(0..3) == Some(&[0xFF, 0xD8, 0xFF]),
        IMAGE_MIME_PNG => image.get(0..8) == Some(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]),
        _ => false,
    }
}

impl DocumentBody {
    pub fn doc_type(&self) -> u8 {
        match self {
            DocumentBody::TontineReceipt { .. } => DOC_TYPE_TONTINE,
            DocumentBody::MedicalPrescription { .. } => DOC_TYPE_PRESCRIPTION,
            DocumentBody::EmergencyVoucher { .. } => DOC_TYPE_VOUCHER,
            DocumentBody::CustomMessage { .. } => DOC_TYPE_MESSAGE,
            DocumentBody::ImageDocument { .. } => DOC_TYPE_IMAGE,
            DocumentBody::LedgerBatchDelta { .. } => DOC_TYPE_LEDGER_BATCH,
        }
    }
}

/// What the issuer provides. The public key is filled in by the encoder from
/// the signing seed, so a caller can never sign with one key and claim another.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentDraft {
    pub doc_id: [u8; 8],
    pub timestamp: u64,
    pub body: DocumentBody,
}

/// Signed envelope carried inside the frame payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GhostDocument {
    pub doc_id: [u8; 8],
    pub timestamp: u64,
    pub issuer_pubkey: [u8; 32],
    pub body: DocumentBody,
}

impl GhostDocument {
    pub fn from_draft(draft: DocumentDraft, issuer_pubkey: [u8; 32]) -> Self {
        GhostDocument {
            doc_id: draft.doc_id,
            timestamp: draft.timestamp,
            issuer_pubkey,
            body: draft.body,
        }
    }

    pub fn doc_type(&self) -> u8 {
        self.body.doc_type()
    }

    /// Checks every bounded field. Called before encoding and after decoding.
    pub fn validate(&self) -> Result<(), GhostError> {
        match &self.body {
            DocumentBody::TontineReceipt {
                group,
                member,
                collector,
                currency,
                note,
                ..
            } => {
                check_field("group", group, MAX_FIELD_BYTES)?;
                check_field("member", member, MAX_FIELD_BYTES)?;
                check_field("collector", collector, MAX_FIELD_BYTES)?;
                check_field("currency", currency, 8)?;
                check_field("note", note, MAX_NOTE_BYTES)?;
            }
            DocumentBody::MedicalPrescription {
                clinic,
                practitioner,
                patient_ref,
                items,
                note,
            } => {
                check_field("clinic", clinic, MAX_FIELD_BYTES)?;
                check_field("practitioner", practitioner, MAX_FIELD_BYTES)?;
                check_field("patientRef", patient_ref, MAX_FIELD_BYTES)?;
                check_items(items.len())?;
                for item in items {
                    check_field("drug", &item.drug, MAX_FIELD_BYTES)?;
                    check_field("dosage", &item.dosage, MAX_FIELD_BYTES)?;
                }
                check_field("note", note, MAX_NOTE_BYTES)?;
            }
            DocumentBody::EmergencyVoucher {
                program,
                distributor,
                beneficiary_ref,
                items,
                note,
                ..
            } => {
                check_field("program", program, MAX_FIELD_BYTES)?;
                check_field("distributor", distributor, MAX_FIELD_BYTES)?;
                check_field("beneficiaryRef", beneficiary_ref, MAX_FIELD_BYTES)?;
                check_items(items.len())?;
                for item in items {
                    check_field("label", &item.label, MAX_FIELD_BYTES)?;
                    check_field("unit", &item.unit, 16)?;
                }
                check_field("note", note, MAX_NOTE_BYTES)?;
            }
            DocumentBody::CustomMessage {
                sender,
                title,
                message,
            } => {
                check_field("sender", sender, MAX_SENDER_BYTES)?;
                check_field("title", title, MAX_TITLE_BYTES)?;
                check_field("message", message, MAX_MESSAGE_BYTES)?;
            }
            DocumentBody::ImageDocument {
                title,
                subject_ref,
                caption,
                mime,
                width,
                height,
                image,
                ..
            } => {
                check_field("title", title, MAX_TITLE_BYTES)?;
                check_field("subjectRef", subject_ref, MAX_FIELD_BYTES)?;
                check_field("caption", caption, MAX_NOTE_BYTES)?;
                if image.len() > MAX_IMAGE_BYTES {
                    return Err(GhostError::ImageTooLarge {
                        len: image.len(),
                        max: MAX_IMAGE_BYTES,
                    });
                }
                if *width == 0 || *height == 0 || *width > MAX_IMAGE_SIDE || *height > MAX_IMAGE_SIDE || !image_format_ok(*mime, image) {
                    return Err(GhostError::ImageFormatInvalid);
                }
            }
            DocumentBody::LedgerBatchDelta {
                group,
                collector,
                currency,
                entries,
                note,
                ..
            } => {
                check_field("group", group, MAX_FIELD_BYTES)?;
                check_field("collector", collector, MAX_FIELD_BYTES)?;
                check_field("currency", currency, 8)?;
                check_field("note", note, MAX_NOTE_BYTES)?;
                if entries.is_empty() {
                    return Err(GhostError::LedgerBatchInvalid { reason: "no entry" });
                }
                if entries.len() > MAX_LEDGER_ENTRIES {
                    return Err(GhostError::TooManyItems {
                        len: entries.len(),
                        max: MAX_LEDGER_ENTRIES,
                    });
                }
                for (i, e) in entries.iter().enumerate() {
                    check_field("member", &e.member, MAX_FIELD_BYTES)?;
                    if e.amount_minor > MAX_LEDGER_AMOUNT {
                        return Err(GhostError::LedgerBatchInvalid { reason: "amount too large" });
                    }
                    // A receipt counted twice would inflate the pot.
                    if entries.iter().take(i).any(|p| p.receipt_id == e.receipt_id) {
                        return Err(GhostError::LedgerBatchInvalid { reason: "duplicate receipt id" });
                    }
                }
            }
        }
        Ok(())
    }

    /// SHA-256 (hex) of the attached image, if any: the key under which a
    /// verifier or a cloud store files the attachment.
    pub fn image_sha256(&self) -> Option<String> {
        match &self.body {
            DocumentBody::ImageDocument { image, .. } => Some(crate::crypto::to_hex(&sha2::Sha256::digest(image))),
            _ => None,
        }
    }

    pub fn to_bytes(&self) -> Result<Vec<u8>, GhostError> {
        self.validate()?;
        postcard::to_allocvec(self).map_err(|_| GhostError::SchemaEncodeFailed)
    }

    pub fn from_bytes(bytes: &[u8]) -> Result<Self, GhostError> {
        let (doc, rest): (GhostDocument, &[u8]) =
            postcard::take_from_bytes(bytes).map_err(|_| GhostError::SchemaDecodeFailed)?;
        if !rest.is_empty() {
            return Err(GhostError::SchemaDecodeFailed);
        }
        doc.validate()?;
        Ok(doc)
    }
}

fn check_field(field: &'static str, value: &str, max: usize) -> Result<(), GhostError> {
    let len = value.len();
    if len > max {
        return Err(GhostError::FieldTooLong { field, len, max });
    }
    Ok(())
}

fn check_items(len: usize) -> Result<(), GhostError> {
    if len > MAX_ITEMS {
        return Err(GhostError::TooManyItems {
            len,
            max: MAX_ITEMS,
        });
    }
    Ok(())
}
