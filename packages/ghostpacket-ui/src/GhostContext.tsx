"use client";

// Shared session state for every GhostPacket app: the WASM core, the session
// signing key and the SDK facade. Apps wrap their layout in <GhostProvider>;
// components read it with useShell() or <WithGhost>.
import { createContext, useContext, useEffect, useState } from "react";

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

  useEffect(() => {
    const seed = newSigningSeed();
    loadCore()
      .then((core) => {
        const k = core.keyInfo(seed);
        if (!k.ok) return setLoadError(k.error.message);
        setGhost({ core, seed, keyInfo: k.value, sdk: GhostPacketSDK.fromCore(core, seed) });
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  return <Ctx.Provider value={{ ghost, loadError, banner, setBanner }}>{children}</Ctx.Provider>;
}

/** Shows a loading panel until the WASM core is ready. */
export function WithGhost({ children }: { children: (g: GhostState) => React.ReactNode }) {
  const { ghost, loadError } = useShell();
  if (ghost) return <>{children(ghost)}</>;
  if (loadError) return null;
  return <div className="panel p-10 text-center"><p className="display text-2xl italic text-mist">Waking the Rust/WASM core…</p></div>;
}
