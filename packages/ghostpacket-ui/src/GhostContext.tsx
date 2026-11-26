"use client";

// Shared session state for every GhostPacket app: the WASM core, the session
// signing key and the SDK facade. Apps wrap their layout in <GhostProvider>;
// components read it with useShell() or <WithGhost>.
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { GhostPacketSDK } from "ghostpacket-sdk/sdk";
import type { KeyInfo } from "ghostpacket-sdk/types";
import { loadCore, newSigningSeed, type Core } from "ghostpacket-sdk/wasm-bridge";

export interface GhostState {
  core: Core;
  seed: Uint8Array;
  keyInfo: KeyInfo;
  sdk: GhostPacketSDK;
}

export interface ShellContext {
  ghost: GhostState | null;
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

/** Loads the core once and creates an ephemeral signing key that never leaves this tab. */
export function GhostProvider({ children }: { children: React.ReactNode }) {
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    const seed = newSigningSeed();
    loadCore()
      .then((core) => {
        if (!live) return;
        const k = core.keyInfo(seed);
        if (!k.ok) return setLoadError(k.error.message);
        setGhost({ core, seed, keyInfo: k.value, sdk: GhostPacketSDK.fromCore(core, seed) });
      })
      .catch((e: unknown) => live && setLoadError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [attempt]);

  const retry = useCallback(() => {
    setLoadError(null);
    setAttempt((n) => n + 1);
  }, []);

  return <Ctx.Provider value={{ ghost, loadError, banner, setBanner, retry }}>{children}</Ctx.Provider>;
}

/** Shows a loading panel until the WASM core is ready, and a retry if it failed (the frame shows why). */
export function WithGhost({ children }: { children: (g: GhostState) => React.ReactNode }) {
  const { ghost, loadError, retry } = useShell();
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
  return <div className="panel p-10 text-center"><p className="display text-2xl italic text-mist">Waking the Rust/WASM core…</p></div>;
}
