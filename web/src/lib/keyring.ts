// Trusted keyring ("identity ceremony"). An emitter shows an identity QR
// `GPKT-KEY:<label>:<public key hex>`; the receiver pins it. In strict mode the
// receiver passes the pinned keys to `decode_frame`, so any other issuer is
// rejected with UNTRUSTED_ISSUER. Public keys only: nothing secret is stored.
import type { Core } from "./wasm-bridge";

export interface TrustedKey {
  label: string;
  publicKeyHex: string;
  fingerprint: string;
  addedAt: number;
}

export const IDENTITY_PREFIX = "GPKT-KEY:";
export const MAX_LABEL = 32;
const STORAGE = "ghostpacket.keyring.v1";
const MAX_KEYS = 64;
const listeners = new Set<() => void>();

export function identityText(label: string, publicKeyHex: string): string {
  return `${IDENTITY_PREFIX}${sanitizeLabel(label)}:${publicKeyHex.toUpperCase()}`;
}

export function sanitizeLabel(label: string): string {
  return label.replace(/[:\r\n\t]/g, " ").trim().slice(0, MAX_LABEL) || "Unnamed issuer";
}

export type ParsedIdentity = { ok: true; key: Omit<TrustedKey, "addedAt"> } | { ok: false; reason: string };

/** Parses and validates an identity QR. The key must be a valid Ed25519 point (checked in WASM). */
export function parseIdentity(core: Core, text: string): ParsedIdentity {
  if (text.length > 200 || !text.startsWith(IDENTITY_PREFIX)) return { ok: false, reason: "Not a GhostPacket identity QR" };
  const body = text.slice(IDENTITY_PREFIX.length);
  const sep = body.lastIndexOf(":");
  if (sep < 0) return { ok: false, reason: "Malformed identity QR" };
  const label = sanitizeLabel(body.slice(0, sep));
  const publicKeyHex = body.slice(sep + 1).trim().toUpperCase();
  if (!/^[0-9A-F]{64}$/.test(publicKeyHex)) return { ok: false, reason: "Public key must be 64 hex characters" };
  const fp = core.fingerprintOf(publicKeyHex);
  if (!fp.ok) return { ok: false, reason: fp.error.message };
  return { ok: true, key: { label, publicKeyHex, fingerprint: fp.value } };
}

export function readKeyring(): TrustedKey[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? "[]");
    return Array.isArray(parsed) ? (parsed as TrustedKey[]).slice(0, MAX_KEYS) : [];
  } catch {
    return [];
  }
}

function write(keys: TrustedKey[]): void {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(keys.slice(0, MAX_KEYS)));
  } catch {
    /* storage disabled: keyring lasts for this page view */
  }
  listeners.forEach((l) => l());
}

export function trustKey(key: Omit<TrustedKey, "addedAt">): void {
  const rest = readKeyring().filter((k) => k.publicKeyHex !== key.publicKeyHex);
  write([{ ...key, addedAt: Date.now() }, ...rest]);
}

export function forgetKey(publicKeyHex: string): void {
  write(readKeyring().filter((k) => k.publicKeyHex !== publicKeyHex));
}

export function onKeyringChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function labelFor(fingerprint: string): string | null {
  return readKeyring().find((k) => k.fingerprint === fingerprint)?.label ?? null;
}
