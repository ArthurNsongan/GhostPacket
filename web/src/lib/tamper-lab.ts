// Interactive tamper lab ("Curse any byte"): attacks on a valid frame and the
// defense layer that catches each one. The checks themselves run in WASM;
// this module only picks the bytes to alter and labels the outcome.
import type { Core, Result } from "./wasm-bridge";
import { newSigningSeed } from "./wasm-bridge";
import type { DocumentDraft, FrameInspection, VerifiedFrame } from "./types";

export type AttackKind = "byte" | "payload" | "signature" | "rogue" | "passphrase";

export type LayerId = "structure" | "crc32" | "aead" | "decode" | "keyring" | "ed25519";
export interface Layer {
  id: LayerId;
  label: string;
  state: "pass" | "fail" | "skip";
}

export interface AttackOutcome {
  kind: AttackKind;
  title: string;
  frame: Uint8Array;
  flipped: { byte: number; bit: number } | null;
  inspection: FrameInspection;
  verification: Result<VerifiedFrame>;
  layers: Layer[];
  caughtBy: string | null;
  note?: string;
}

const LAYER_OF: Record<string, LayerId> = {
  FRAME_TOO_SHORT: "structure",
  FRAME_TOO_LARGE: "structure",
  INVALID_PREAMBLE: "structure",
  UNSUPPORTED_VERSION: "structure",
  INVALID_FLAGS: "structure",
  LENGTH_MISMATCH: "structure",
  PAYLOAD_EMPTY: "structure",
  CRC32_MISMATCH: "crc32",
  PASSPHRASE_REQUIRED: "aead",
  DECRYPTION_FAILED: "aead",
  LZ4_DECOMPRESSION_FAILED: "decode",
  DECOMPRESSED_TOO_LARGE: "decode",
  SCHEMA_DECODE_FAILED: "decode",
  FIELD_TOO_LONG: "decode",
  TOO_MANY_ITEMS: "decode",
  UNTRUSTED_ISSUER: "keyring",
  INVALID_PUBLIC_KEY: "ed25519",
  INVALID_SIGNATURE: "ed25519",
};

const LABEL: Record<LayerId, string> = {
  structure: "Structure",
  crc32: "CRC32",
  aead: "ChaCha20-Poly1305",
  decode: "LZ4 + schema",
  keyring: "Keyring",
  ed25519: "Ed25519",
};

/** Defense layers in verification order, with the one that stopped the frame. */
export function layersFor(v: Result<VerifiedFrame>, encrypted: boolean, strictKeyring: boolean): Layer[] {
  const order: LayerId[] = ["structure", "crc32", ...(encrypted ? (["aead"] as LayerId[]) : []), "decode", ...(strictKeyring ? (["keyring"] as LayerId[]) : []), "ed25519"];
  if (v.ok) return order.map((id) => ({ id, label: LABEL[id], state: "pass" }));
  const failed = LAYER_OF[v.error.code] ?? "structure";
  const at = order.indexOf(failed);
  return order.map((id, i) => ({ id, label: LABEL[id], state: i < at ? "pass" : i === at ? "fail" : "skip" }));
}

export interface LabContext {
  core: Core;
  frame: Uint8Array;
  draft: DocumentDraft;
  trusted: string[];
  passphrase?: string;
  flags: number;
}

function outcome(ctx: LabContext, kind: AttackKind, title: string, frame: Uint8Array, flipped: AttackOutcome["flipped"], trusted: string[], passphrase: string | undefined, note?: string): AttackOutcome {
  const verification = ctx.core.verify(frame, trusted, passphrase);
  const encrypted = ((frame[5] ?? 0) & 0x10) !== 0;
  const layers = layersFor(verification, encrypted, trusted.length > 0);
  const failed = layers.find((l) => l.state === "fail");
  return {
    kind,
    title,
    frame,
    flipped,
    inspection: ctx.core.inspect(frame, passphrase),
    verification,
    layers,
    caughtBy: failed?.label ?? null,
    note,
  };
}

function flip(ctx: LabContext, byte: number, bit: number): Uint8Array | null {
  const r = ctx.core.flipBit(ctx.frame, byte, bit);
  return r.ok ? r.value : null;
}

/** Flips one bit of any byte the judge clicks on. */
export function curseByte(ctx: LabContext, byte: number, bit = 0): AttackOutcome | null {
  const f = flip(ctx, byte, bit);
  return f ? outcome(ctx, "byte", `Cursed byte #${byte}`, f, { byte, bit }, ctx.trusted, ctx.passphrase) : null;
}

export function attack(ctx: LabContext, kind: Exclude<AttackKind, "byte">): AttackOutcome | null {
  const n = ctx.frame.length - 76;
  switch (kind) {
    case "payload": {
      const byte = 8 + Math.floor(n / 2);
      const f = flip(ctx, byte, 3);
      return f ? outcome(ctx, kind, "Curse payload", f, { byte, bit: 3 }, ctx.trusted, ctx.passphrase) : null;
    }
    case "signature": {
      const byte = ctx.frame.length - 1;
      const f = flip(ctx, byte, 0);
      return f ? outcome(ctx, kind, "Curse signature", f, { byte, bit: 0 }, ctx.trusted, ctx.passphrase, "CRC32 still matches: only the signature can catch this.") : null;
    }
    case "rogue": {
      // Same document, valid CRC32 and valid signature, but by a key nobody pinned.
      const rogue = ctx.core.encode(ctx.draft, newSigningSeed(), ctx.flags, ctx.passphrase);
      if (!rogue.ok) return null;
      const strict = ctx.trusted.length > 0 ? ctx.trusted : [];
      return outcome(
        ctx,
        kind,
        "Forge with a rogue key",
        rogue.value.frame,
        null,
        strict,
        ctx.passphrase,
        `The forgery is internally valid (issuer ${rogue.value.fingerprint}). Only the pinned keyring rejects it.`,
      );
    }
    case "passphrase":
      return outcome(ctx, kind, "Open with a wrong passphrase", ctx.frame, null, ctx.trusted, "wrong-passphrase", "The ciphertext is intact; the key derived from the wrong passphrase cannot open it.");
  }
}
