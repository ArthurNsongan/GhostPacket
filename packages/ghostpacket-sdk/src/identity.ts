// Persistent issuer identity. The 32-byte signing seed is sealed by the Rust core
// (vault.rs: PBKDF2-HMAC-SHA256 210k + ChaCha20-Poly1305) and only the sealed
// vault is stored, in this app's storage namespace. The seed itself lives in
// memory for the session, exactly like a session key.
import { kv } from "./storage";
import type { KeyInfo } from "./types";
import type { Core, Result } from "./wasm-bridge";

const KEY = "ghostpacket.identity.vault.v1";

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(text: string): Uint8Array | null {
  try {
    const s = atob(text);
    return Uint8Array.from(s, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The sealed vault stored by this app, if any. */
export function storedVault(): Uint8Array | null {
  try {
    const raw = kv().getItem(KEY);
    return raw ? unb64(raw) : null;
  } catch {
    return null;
  }
}

/** Public identity of the stored vault, readable without the passphrase. */
export function storedIdentity(core: Core): KeyInfo | null {
  const v = storedVault();
  if (!v) return null;
  const info = core.vaultIdentity(v);
  return info.ok ? info.value : null;
}

/**
 * "none": no vault; "ok": a readable vault; "unreadable": something is stored but
 * it is not a valid vault (damaged, truncated, other version). The UI must not
 * treat "unreadable" as "none": creating a key would silently replace it.
 */
export function vaultStatus(core: Core): "none" | "ok" | "unreadable" {
  let raw: string | null;
  try {
    raw = kv().getItem(KEY);
  } catch {
    return "none";
  }
  if (raw === null) return "none";
  return storedIdentity(core) ? "ok" : "unreadable";
}

/**
 * Creates a new issuer key, seals it and stores the vault. Refuses to replace
 * an existing entry (readable or not) unless `replace` is set.
 */
export function createIdentity(
  core: Core,
  passphrase: string,
  seed: Uint8Array,
  opts: { replace?: boolean } = {},
): Result<{ seed: Uint8Array; keyInfo: KeyInfo; vault: Uint8Array }> {
  if (!opts.replace && vaultStatus(core) !== "none") {
    return { ok: false, error: { code: "IDENTITY_EXISTS", message: "An identity is already stored on this device: unlock it, or confirm its replacement" } };
  }
  const sealed = core.vaultSeal(seed, passphrase);
  if (!sealed.ok) return sealed;
  const keyInfo = core.keyInfo(seed);
  if (!keyInfo.ok) return keyInfo;
  try {
    kv().setItem(KEY, b64(sealed.value));
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "Storage full or unavailable: the identity cannot be saved" } };
  }
  // Read back: an identity that is not on disk would be lost at the next reload.
  const back = storedVault();
  if (!back || back.length !== sealed.value.length) {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "The identity could not be confirmed on disk" } };
  }
  return { ok: true, value: { seed, keyInfo: keyInfo.value, vault: sealed.value } };
}

/** Opens the stored vault. `VAULT_INVALID` on a wrong passphrase. */
export function unlockIdentity(core: Core, passphrase: string): Result<{ seed: Uint8Array; keyInfo: KeyInfo }> {
  const v = storedVault();
  if (!v) return { ok: false, error: { code: "NO_IDENTITY", message: "No issuer identity on this device" } };
  const seed = core.vaultOpen(v, passphrase);
  if (!seed.ok) return seed;
  const keyInfo = core.keyInfo(seed.value);
  if (!keyInfo.ok) return keyInfo;
  return { ok: true, value: { seed: seed.value, keyInfo: keyInfo.value } };
}

/** Removes the vault from this device (the key is gone unless exported). */
export function forgetIdentity(): void {
  try {
    kv().removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Backup file of the sealed vault (still needs the passphrase to be used). */
export function exportVaultFile(name = "issuer-identity.gpkv"): File | null {
  const v = storedVault();
  return v ? new File([v.slice().buffer], name, { type: "application/octet-stream" }) : null;
}

/** Restores a vault file (validated by the core before it is stored). */
export async function importVaultFile(core: Core, file: Blob): Promise<Result<KeyInfo>> {
  if (file.size !== core.limits.vaultLen) return { ok: false, error: { code: "VAULT_INVALID", message: `Not a GhostPacket identity file (${file.size} bytes)` } };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = core.vaultIdentity(bytes);
  if (!info.ok) return info;
  try {
    kv().setItem(KEY, b64(bytes));
  } catch {
    return { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: "Storage full or unavailable" } };
  }
  return info;
}
