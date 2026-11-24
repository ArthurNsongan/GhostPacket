// Shapes exchanged with the WASM core (serde camelCase, externally tagged enum).

export interface PrescriptionItem {
  drug: string;
  dosage: string;
  days: number;
}

export interface VoucherItem {
  label: string;
  quantity: number;
  unit: string;
}

export type DocumentBody =
  | {
      tontineReceipt: {
        group: string;
        member: string;
        collector: string;
        amountMinor: number;
        currency: string;
        cycle: number;
        note: string;
      };
    }
  | {
      medicalPrescription: {
        clinic: string;
        practitioner: string;
        patientRef: string;
        items: PrescriptionItem[];
        note: string;
      };
    }
  | {
      emergencyVoucher: {
        program: string;
        distributor: string;
        beneficiaryRef: string;
        items: VoucherItem[];
        validUntil: number;
        note: string;
      };
    };

export interface DocumentDraft {
  /** 8 bytes. */
  docId: number[];
  /** Unix epoch seconds. */
  timestamp: number;
  body: DocumentBody;
}

export interface GhostDocument extends DocumentDraft {
  issuerPubkey: number[];
}

export interface EncodedFrame {
  frame: Uint8Array;
  frameLen: number;
  serializedLen: number;
  payloadLen: number;
  compressed: boolean;
  flags: number;
  crc32: number;
  issuerPubkeyHex: string;
  fingerprint: string;
}

export interface VerifiedFrame {
  document: GhostDocument;
  docType: number;
  frameLen: number;
  payloadLen: number;
  decompressedLen: number;
  compressed: boolean;
  flags: number;
  crc32: number;
  issuerPubkeyHex: string;
  fingerprint: string;
  trustedIssuer: boolean;
}

export interface FieldSpan {
  name: "sync" | "version" | "flags" | "length" | "payload" | "crc32" | "signature";
  offset: number;
  len: number;
  valid?: boolean;
  detail: string;
}

export interface FrameInspection {
  frameLen: number;
  fields: FieldSpan[];
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
}

export interface FskDecodeResult {
  frame: Uint8Array;
  frameLen: number;
  syncOffset: number;
  preambleScore: number;
  meanSymbolSnrDb: number;
  minSymbolSnrDb: number;
  correctedBytes: number;
  symbols: number;
  endOffset: number;
}

export interface DropletStep {
  seed: number;
  degree: number;
  duplicate: boolean;
  newlyResolved: number[];
  cascadeDepth: number;
  solvedByElimination: boolean;
  decoded: boolean[];
  resolvedCount: number;
  totalK: number;
  pending: number;
  dropletsReceived: number;
  complete: boolean;
}

export interface KeyInfo {
  publicKeyHex: string;
  fingerprint: string;
}

export interface Limits {
  maxFrameSize: number;
  maxPayloadLen: number;
  minFrameSize: number;
  overhead: number;
  maxDecompressedBytes: number;
  dropletBlockSize: number;
  maxSamples: number;
}

/** Error object thrown by every WASM function. */
export interface GhostError {
  code: string;
  message: string;
}

export function isGhostError(e: unknown): e is GhostError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

export type FskMode = "robust" | "fast";
export const FSK_MODE_CODE: Record<FskMode, number> = { robust: 0, fast: 1 };

export const FLAG_LZ4 = 0b0001;
export const FLAG_FSK = 0b0010;
export const FLAG_FOUNTAIN = 0b0100;
export const FLAG_DEMO = 0b1000;
