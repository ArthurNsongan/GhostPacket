//! Structured field documents and their compact binary encoding (`postcard`).
//!
//! `postcard` writes no field names and uses varints, so a document holding a
//! 32-byte public key and ~200 bytes of text stays well under the 436-byte
//! payload limit.

use serde::{Deserialize, Serialize};

use crate::error::GhostError;

pub const MAX_FIELD_BYTES: usize = 64;
pub const MAX_NOTE_BYTES: usize = 120;
pub const MAX_ITEMS: usize = 8;

pub const DOC_TYPE_TONTINE: u8 = 0x01;
pub const DOC_TYPE_PRESCRIPTION: u8 = 0x02;
pub const DOC_TYPE_VOUCHER: u8 = 0x03;
pub const DOC_TYPE_MESSAGE: u8 = 0x04;

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
    /// Free-form signed message typed by the user. Must stay the last variant:
    /// postcard encodes the variant index, so reordering would break old frames.
    #[serde(rename_all = "camelCase")]
    CustomMessage {
        sender: String,
        title: String,
        message: String,
    },
}

impl DocumentBody {
    pub fn doc_type(&self) -> u8 {
        match self {
            DocumentBody::TontineReceipt { .. } => DOC_TYPE_TONTINE,
            DocumentBody::MedicalPrescription { .. } => DOC_TYPE_PRESCRIPTION,
            DocumentBody::EmergencyVoucher { .. } => DOC_TYPE_VOUCHER,
            DocumentBody::CustomMessage { .. } => DOC_TYPE_MESSAGE,
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
        }
        Ok(())
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
