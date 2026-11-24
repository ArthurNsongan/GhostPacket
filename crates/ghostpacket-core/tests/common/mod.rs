//! Shared fixtures: the three field presets (mirrored in web/src/lib/presets.ts).
#![allow(dead_code)]

use ghostpacket_core::protocol::{self, EncodedFrame, FLAG_DEMO, FLAG_FOUNTAIN, FLAG_FSK};
use ghostpacket_core::schema::{DocumentBody, DocumentDraft, PrescriptionItem, VoucherItem};

pub const SEED_A: [u8; 32] = [0x11; 32];
pub const SEED_B: [u8; 32] = [0x22; 32];
pub const TIMESTAMP: u64 = 1_793_448_000; // 2026-10-31T12:00:00Z

pub fn tontine() -> DocumentDraft {
    DocumentDraft {
        doc_id: *b"TNT-0042",
        timestamp: TIMESTAMP,
        body: DocumentBody::TontineReceipt {
            group: "Médina Women’s Tontine, Dakar".into(),
            member: "Aminata Diop (member #17)".into(),
            collector: "Fatou Ndiaye, treasurer".into(),
            amount_minor: 25_000,
            currency: "XOF".into(),
            cycle: 9,
            note: "Weekly contribution received in cash at Tilène Market. Next collection: Saturday.".into(),
        },
    }
}

pub fn prescription() -> DocumentDraft {
    DocumentDraft {
        doc_id: *b"RX-77310",
        timestamp: TIMESTAMP + 3_600,
        body: DocumentBody::MedicalPrescription {
            clinic: "Ndiob Rural Health Post, Fatick".into(),
            practitioner: "Nurse Moussa Sarr".into(),
            patient_ref: "PAT-2026-0815 (F, 34 y)".into(),
            items: vec![
                PrescriptionItem {
                    drug: "Artemether-lumefantrine 20/120".into(),
                    dosage: "4 tablets morning and evening".into(),
                    days: 3,
                },
                PrescriptionItem {
                    drug: "Paracetamol 500 mg".into(),
                    dosage: "1 tablet if fever, max 3/day".into(),
                    days: 5,
                },
            ],
            note: "Malaria RDT positive. Return if vomiting.".into(),
        },
    }
}

pub fn voucher() -> DocumentDraft {
    DocumentDraft {
        doc_id: *b"AID-5531",
        timestamp: TIMESTAMP + 7_200,
        body: DocumentBody::EmergencyVoucher {
            program: "Kaolack Flood Relief 2026".into(),
            distributor: "Red Cross, distribution point 4".into(),
            beneficiary_ref: "HH-0931 (household of 5)".into(),
            items: vec![
                VoucherItem {
                    label: "Broken rice".into(),
                    quantity: 25,
                    unit: "kg".into(),
                },
                VoucherItem {
                    label: "Vegetable oil".into(),
                    quantity: 5,
                    unit: "L".into(),
                },
                VoucherItem {
                    label: "Water purification tablets".into(),
                    quantity: 60,
                    unit: "u".into(),
                },
            ],
            valid_until: TIMESTAMP + 14 * 86_400,
            note: "Single use. Show the household card.".into(),
        },
    }
}

pub fn presets() -> Vec<(&'static str, DocumentDraft)> {
    vec![
        ("tontine", tontine()),
        ("prescription", prescription()),
        ("voucher", voucher()),
    ]
}

pub const DEMO_FLAGS: u8 = FLAG_FSK | FLAG_FOUNTAIN | FLAG_DEMO;

pub fn encode(draft: DocumentDraft) -> EncodedFrame {
    protocol::encode_frame(draft, &SEED_A, DEMO_FLAGS).expect("preset encodes")
}
