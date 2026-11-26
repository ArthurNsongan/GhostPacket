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
    }
  | {
      customMessage: {
        sender: string;
        title: string;
        message: string;
      };
    }
  | {
      /** GPKT v2 only. `image` is a WebP / JPEG / PNG made in the sender's browser. */
      imageDocument: {
        title: string;
        subjectRef: string;
        caption: string;
        /** 8 bytes; all zeros = none. */
        relatedDocId: number[];
        /** 1 = WebP, 2 = JPEG, 3 = PNG. */
        mime: number;
        width: number;
        height: number;
        image: Uint8Array;
      };
    }
  | {
      /** A whole savings-group round (1..=64 contributions) in one frame; GPKT v2 above ~4 entries. */
      ledgerBatchDelta: {
        group: string;
        collector: string;
        currency: string;
        cycle: number;
        entries: LedgerBatchEntry[];
        note: string;
      };
    };

export interface LedgerBatchEntry {
  member: string;
  amountMinor: number;
  /** 8 bytes: doc id of the member's individual receipt. */
  receiptId: number[];
}

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
  /** 1 = GPKT v1 (≤ 512 B), 2 = GPKT v2 (≤ 128 KB payload). */
  version: number;
  frameLen: number;
  serializedLen: number;
  payloadLen: number;
  compressed: boolean;
  encrypted: boolean;
  flags: number;
  crc32: number;
  issuerPubkeyHex: string;
  fingerprint: string;
}

export interface VerifiedFrame {
  document: GhostDocument;
  version: number;
  /** SHA-256 hex of the attached image, if any. */
  imageSha256?: string | null;
  docType: number;
  frameLen: number;
  payloadLen: number;
  decompressedLen: number;
  compressed: boolean;
  encrypted: boolean;
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
  maxSenderBytes: number;
  maxTitleBytes: number;
  maxMessageBytes: number;
  encryptionOverhead: number;
  saltLen: number;
  pbkdf2Iterations: number;
  maxPassphraseBytes: number;
  maxFrameSizeV2: number;
  maxImageBytes: number;
  chromaGrid: number;
  chromaCapacity: number;
  ofdmMaxFrame: number;
  vaultLen: number;
  minVaultPassphraseBytes: number;
  ultrasonicMaxFrame: number;
  ultrasonicMinSampleRate: number;
  maxLedgerEntries: number;
  chimeraSoundSeedBase: number;
}

export interface WideStep {
  seed: number;
  degree: number;
  duplicate: boolean;
  newlyResolved: number[];
  cascadeDepth: number;
  solvedByElimination: boolean;
  resolvedCount: number;
  totalK: number;
  pending: number;
  dropletsReceived: number;
  totalLen: number;
  complete: boolean;
}

/** Chimera Turbo: droplets of one OFDM bundle fed to the wide fountain. */
export interface BundleStep {
  accepted: number;
  rejected: number;
  step?: WideStep | null;
}

export interface ChromaScan {
  found: boolean;
  errorCode?: string | null;
  /** Matrix corners in image pixels: TL, TR, BR, BL. */
  corners: [number, number][];
  correctedBytes: number;
  step?: WideStep | null;
}

export interface OfdmDecodeResult {
  frame: Uint8Array;
  frameLen: number;
  syncOffset: number;
  preambleScore: number;
  meanSymbolSnrDb: number;
  correctedBytes: number;
  symbols: number;
  timingDriftSamples: number;
  endOffset: number;
}

export const IMAGE_MIME = { webp: 1, jpeg: 2, png: 3 } as const;

/** Error object thrown by every WASM function. */
export interface GhostError {
  code: string;
  message: string;
}

export function isGhostError(e: unknown): e is GhostError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

/** "ultrasonic" = Ultrasonic Whisper: 17.6–19.6 kHz, 400 bit/s, frames ≤ 256 B, ≥ 44.1 kHz. */
export type FskMode = "robust" | "fast" | "ultrasonic";
export const FSK_MODE_CODE: Record<FskMode, number> = { robust: 0, fast: 1, ultrasonic: 2 };
/** Acoustic modems: 4-FSK (robust / fast, frames ≤ 512 B) or OFDM (≈ 4 kbit/s, frames ≤ 16 KB). */
export type AcousticMode = FskMode | "ofdm";

export const FLAG_LZ4 = 0b0001;
export const FLAG_FSK = 0b0010;
export const FLAG_FOUNTAIN = 0b0100;
export const FLAG_DEMO = 0b1000;
export const FLAG_ENCRYPTED = 0b1_0000;

/** "chroma" = ChromaCrypt color matrix (light), "ofdm" = acoustic OFDM (sound). */
export type Channel = "sound" | "light" | "file" | "tamper" | "chroma" | "ofdm" | "ultrasonic" | "chimera" | "lan";
