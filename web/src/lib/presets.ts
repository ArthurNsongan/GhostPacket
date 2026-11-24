// Three field presets, mirrored in crates/ghostpacket-core/tests/common/mod.rs.
// Only `import type` here: the MCP server loads this file with Node type stripping.
import type { DocumentDraft } from "./types";

export interface Preset {
  id: "tontine" | "prescription" | "voucher";
  label: string;
  persona: string;
  draft: DocumentDraft;
}

const TIMESTAMP = 1_793_448_000; // 2026-10-31T12:00:00Z

function ascii(id: string): number[] {
  return Array.from(id.slice(0, 8).padEnd(8, " "), (c) => c.charCodeAt(0) & 0x7f);
}

export const PRESETS: Preset[] = [
  {
    id: "tontine",
    label: "Dakar Tontine Receipt",
    persona: "Tontine treasurer, Tilène Market",
    draft: {
      docId: ascii("TNT-0042"),
      timestamp: TIMESTAMP,
      body: {
        tontineReceipt: {
          group: "Médina Women’s Tontine, Dakar",
          member: "Aminata Diop (member #17)",
          collector: "Fatou Ndiaye, treasurer",
          amountMinor: 25_000,
          currency: "XOF",
          cycle: 9,
          note: "Weekly contribution received in cash at Tilène Market. Next collection: Saturday.",
        },
      },
    },
  },
  {
    id: "prescription",
    label: "Ndiob Rural Clinic Prescription",
    persona: "Nurse, Ndiob health post",
    draft: {
      docId: ascii("RX-77310"),
      timestamp: TIMESTAMP + 3_600,
      body: {
        medicalPrescription: {
          clinic: "Ndiob Rural Health Post, Fatick",
          practitioner: "Nurse Moussa Sarr",
          patientRef: "PAT-2026-0815 (F, 34 y)",
          items: [
            { drug: "Artemether-lumefantrine 20/120", dosage: "4 tablets morning and evening", days: 3 },
            { drug: "Paracetamol 500 mg", dosage: "1 tablet if fever, max 3/day", days: 5 },
          ],
          note: "Malaria RDT positive. Return if vomiting.",
        },
      },
    },
  },
  {
    id: "voucher",
    label: "Kaolack Flood Relief Voucher",
    persona: "Aid distributor, Kaolack",
    draft: {
      docId: ascii("AID-5531"),
      timestamp: TIMESTAMP + 7_200,
      body: {
        emergencyVoucher: {
          program: "Kaolack Flood Relief 2026",
          distributor: "Red Cross, distribution point 4",
          beneficiaryRef: "HH-0931 (household of 5)",
          items: [
            { label: "Broken rice", quantity: 25, unit: "kg" },
            { label: "Vegetable oil", quantity: 5, unit: "L" },
            { label: "Water purification tablets", quantity: 60, unit: "u" },
          ],
          validUntil: TIMESTAMP + 14 * 86_400,
          note: "Single use. Show the household card.",
        },
      },
    },
  },
];

export function presetById(id: Preset["id"]): Preset {
  return PRESETS.find((p) => p.id === id) ?? (PRESETS[0] as Preset);
}
