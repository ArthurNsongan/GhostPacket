// Helpers for free-form messages (doc type 0x04) and document titles.
import type { DocumentBody, DocumentDraft, Limits } from "./types";

export interface MessageInput {
  sender: string;
  title: string;
  message: string;
}

const encoder = new TextEncoder();

export function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** Random readable id `MSG-XXXX` (8 ASCII bytes). */
export function newDocId(prefix = "MSG-"): number[] {
  const rnd = new Uint8Array(2);
  crypto.getRandomValues(rnd);
  const tail = Array.from(rnd, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return Array.from((prefix + tail).slice(0, 8).padEnd(8, " "), (c) => c.charCodeAt(0) & 0x7f);
}

export function messageDraft(input: MessageInput, docId = newDocId()): DocumentDraft {
  return {
    docId,
    timestamp: Math.floor(Date.now() / 1000),
    body: { customMessage: { sender: input.sender.trim(), title: input.title.trim(), message: input.message } },
  };
}

/** Field-level byte budget, so the UI can block an over-long message before WASM does. */
export function messageBudget(input: MessageInput, limits: Limits) {
  const fields = [
    { name: "sender", used: byteLength(input.sender.trim()), max: limits.maxSenderBytes },
    { name: "title", used: byteLength(input.title.trim()), max: limits.maxTitleBytes },
    { name: "message", used: byteLength(input.message), max: limits.maxMessageBytes },
  ];
  return { fields, ok: fields.every((f) => f.used <= f.max) && byteLength(input.message.trim()) > 0 };
}

export function docTitle(body: DocumentBody): string {
  if ("tontineReceipt" in body) return "Tontine receipt";
  if ("medicalPrescription" in body) return "Prescription";
  if ("emergencyVoucher" in body) return "Aid voucher";
  if ("imageDocument" in body) return body.imageDocument.title || "Image";
  if ("ledgerBatchDelta" in body) return `Round ${body.ledgerBatchDelta.cycle} ledger`;
  return body.customMessage.title || "Message";
}

// --- Identity card (Ultrasonic Whisper) -----------------------------------------

/** Longest prefix of `text` (whole code points) that fits in `max` UTF-8 bytes. */
export function fitBytes(text: string, max: number): string {
  let out = "";
  for (const ch of text) {
    if (byteLength(out + ch) > max) break;
    out += ch;
  }
  return out;
}

/** Title that marks a signed message as a key-exchange card. */
export const IDENTITY_CARD_TITLE = "Identity card";

/**
 * A signed message carrying only a label: the signature proves the sender holds
 * the key, and the receiver pins it after comparing the fingerprint aloud.
 * About 170 bytes, ≈ 4 s as an ultrasonic whisper.
 */
export function identityCardDraft(label: string): DocumentDraft {
  return {
    docId: newDocId("KEY-"),
    timestamp: Math.floor(Date.now() / 1000),
    body: { customMessage: { sender: fitBytes(label.trim(), 32), title: IDENTITY_CARD_TITLE, message: "" } },
  };
}

/** Label of an identity card, or null if the body is something else. */
export function identityCardLabel(body: DocumentBody): string | null {
  return "customMessage" in body && body.customMessage.title === IDENTITY_CARD_TITLE ? body.customMessage.sender : null;
}

export function docIdText(docId: number[]): string {
  return String.fromCharCode(...docId).trim();
}
