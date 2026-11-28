"use client";

// Shared session state for every GhostPacket app: the WASM core, the signing
// key and the SDK facade. Apps wrap their layout in <GhostProvider>;
// components read it with useShell() or <WithGhost>.
// - Session mode (portal): a fresh key per tab, never stored.
// - Persistent mode (issuer apps): the key lives in an identity vault sealed by
//   the Rust core under a passphrase, so receivers can pin it across sessions.
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { createIdentity, storedIdentity, unlockIdentity, vaultStatus } from "ghostpacket-sdk/identity";
import { GhostPacketSDK } from "ghostpacket-sdk/sdk";
import type { KeyInfo } from "ghostpacket-sdk/types";
import { loadCore, newSigningSeed, type Core, type Result } from "ghostpacket-sdk/wasm-bridge";

export interface GhostState {
  core: Core;
  seed: Uint8Array;
  keyInfo: KeyInfo;
  sdk: GhostPacketSDK;
  /** "vault": persistent issuer key unlocked with a passphrase; "session": this tab only. */
  identity: "session" | "vault";
}

export interface IdentityControls {
  /** Fingerprint of the vault stored on this device, if any. */
  stored: KeyInfo | null;
  /** Something is stored but it is not a readable vault: creating a key replaces it. */
  damaged: boolean;
  unlock(passphrase: string): Result<KeyInfo>;
  /** `replace` must be set to overwrite a damaged vault. */
  create(passphrase: string, replace?: boolean): Result<KeyInfo>;
  useSessionKey(): void;
}

export interface ShellContext {
  ghost: GhostState | null;
  /** Set while a persistent app waits for its issuer identity. */
  identity: IdentityControls | null;
  loadError: string | null;
  banner: string | null;
  setBanner: (b: string | null) => void;
  /** Loads the core again after a failure. */
  retry: () => void;
}

const Ctx = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell outside GhostProvider");
  return c;
}

/** Loads the core once and sets up the signing key (session, or persistent vault). */
export function GhostProvider({ children, persistent = false }: { children: React.ReactNode; persistent?: boolean }) {
  const [core, setCore] = useState<Core | null>(null);
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [stored, setStored] = useState<KeyInfo | null>(null);
  const [damaged, setDamaged] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const start = useCallback((c: Core, seed: Uint8Array, identity: GhostState["identity"]): Result<KeyInfo> => {
    const k = c.keyInfo(seed);
    if (!k.ok) return k;
    setGhost({ core: c, seed, keyInfo: k.value, sdk: GhostPacketSDK.fromCore(c, seed), identity });
    return k;
  }, []);

  useEffect(() => {
    let live = true;
    loadCore()
      .then((c) => {
        if (!live) return;
        setCore(c);
        if (!persistent) {
          const k = start(c, newSigningSeed(), "session");
          if (!k.ok) setLoadError(k.error.message);
          return;
        }
        setStored(storedIdentity(c));
        setDamaged(vaultStatus(c) === "unreadable");
      })
      .catch((e: unknown) => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [attempt, persistent, start]);

  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((n) => n + 1);
  }, []);

  const identity: IdentityControls | null =
    persistent && core && !ghost
      ? {
          stored,
          damaged,
          unlock: (passphrase) => {
            const r = unlockIdentity(core, passphrase);
            return r.ok ? start(core, r.value.seed, "vault") : r;
          },
          create: (passphrase, replace = false) => {
            const r = createIdentity(core, passphrase, newSigningSeed(), { replace });
            return r.ok ? start(core, r.value.seed, "vault") : r;
          },
          useSessionKey: () => void start(core, newSigningSeed(), "session"),
        }
      : null;

  return <Ctx.Provider value={{ ghost, identity, loadError, banner, setBanner, retry }}>{children}</Ctx.Provider>;
}

/** Shows a loading panel, the identity gate, or a retry if loading failed (the frame shows why). */
export function WithGhost({ children }: { children: (g: GhostState) => React.ReactNode }) {
  const { ghost, loadError, retry, identity } = useShell();
  if (ghost) return <>{children(ghost)}</>;
  if (loadError)
    return (
      <div className="panel p-10 text-center">
        <p className="display text-2xl italic text-mist">The core did not wake up.</p>
        <button type="button" onClick={retry} className="btn-tonal mt-5 rounded-full px-5 py-2 text-sm">
          Try again
        </button>
      </div>
    );
  if (identity) return <IdentityGate controls={identity} />;
  return (
    <div className="panel p-10 text-center">
      <p className="display text-2xl italic text-mist">Waking the Rust/WASM core…</p>
    </div>
  );
}

const MIN_PASS = 10;
const field = "mt-1 w-full rounded-md bg-ink/[0.045] px-2 py-1.5 font-mono text-sm text-ink outline-none focus:bg-ink/[0.08]";

/** Unlock or create the issuer identity; or continue with a one-session key. */
export function IdentityGate({ controls }: { controls: IdentityControls }) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replace, setReplace] = useState(false);
  const creating = !controls.stored;
  const blockedByDamage = controls.damaged && !replace;
  const tooShort = new TextEncoder().encode(pass).length < MIN_PASS;

  const run = (fn: () => Result<KeyInfo>) => {
    setBusy(true);
    setError(null);
    // Let the "Unlocking…" state paint: PBKDF2 210k takes about half a second.
    setTimeout(() => {
      const r = fn();
      if (!r.ok) setError(r.error.code === "VAULT_INVALID" ? "Wrong passphrase (or altered identity file)." : `${r.error.code}: ${r.error.message}`);
      setBusy(false);
    }, 30);
  };

  return (
    <section className="panel mx-auto flex w-full max-w-xl flex-col gap-3 p-8" aria-labelledby="identity-title">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-accent/10 px-4 py-3">
        <p className="text-[13px] text-ink">
          Judging or just looking? <span className="text-mist">One click, nothing stored.</span>
        </p>
        <button type="button" disabled={busy} onClick={controls.useSessionKey} className="btn-accent px-5 py-2 text-sm font-medium">
          Continue with a session key (demo)
        </button>
        <p className="w-full font-mono text-[10px] text-mute">A session key changes on every reload: receivers would have to pin it again.</p>
      </div>
      <p className="panel-title">Issuer identity</p>
      <h2 id="identity-title" className="display text-3xl text-ink">
        {creating ? (
          <>
            Seal this device&apos;s <em>signing key</em>
          </>
        ) : (
          <>
            Unlock your <em>signing key</em>
          </>
        )}
      </h2>
      <p className="text-[13px] text-mist">
        {creating
          ? "Receivers pin your fingerprint once, so it must stay the same every day. The Rust core seals the key (PBKDF2 210k + ChaCha20-Poly1305) under your passphrase; only the sealed vault is stored on this device."
          : "The sealed vault on this device holds the key behind this fingerprint. The passphrase never leaves the page."}
      </p>
      {controls.stored && (
        <p className="font-mono text-sm text-ion" title={controls.stored.publicKeyHex}>
          {controls.stored.fingerprint}
        </p>
      )}
      <label className="block text-[12px] text-mist">
        Passphrase {creating && `(at least ${MIN_PASS} bytes, several words)`}
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoComplete={creating ? "new-password" : "current-password"}
          aria-label="Identity passphrase"
          className={field}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !creating && pass) run(() => controls.unlock(pass));
          }}
        />
      </label>
      {creating && (
        <label className="block text-[12px] text-mist">
          Repeat the passphrase
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-label="Repeat the identity passphrase" className={field} />
        </label>
      )}
      {controls.damaged && (
        <div className="rounded-md bg-alarm/10 px-3 py-2 text-[12px] text-alarm" role="alert">
          <p>The identity stored on this device is unreadable (damaged or truncated). A new key would replace it, and receivers would have to pin the new fingerprint.</p>
          <label className="mt-2 flex items-center gap-2 text-ink">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} aria-label="Replace the unreadable identity" />
            Replace the unreadable identity
          </label>
        </div>
      )}
      {error && (
        <p className="rounded-md bg-alarm/10 px-3 py-2 font-mono text-[12px] text-alarm" role="alert">
          {error}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {creating ? (
          <button type="button" disabled={busy || tooShort || pass !== confirm || blockedByDamage} onClick={() => run(() => controls.create(pass, controls.damaged && replace))} className="cta-ember px-6 py-2.5 text-sm font-semibold disabled:opacity-40">
            {busy ? "Sealing…" : "Create and seal the key"}
          </button>
        ) : (
          <button type="button" disabled={busy || !pass} onClick={() => run(() => controls.unlock(pass))} className="cta-ember px-6 py-2.5 text-sm font-semibold disabled:opacity-40">
            {busy ? "Unlocking…" : "Unlock"}
          </button>
        )}
      </div>
    </section>
  );
}
