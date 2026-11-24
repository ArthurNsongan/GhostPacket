"use client";

import { useEffect, useState } from "react";

import type { KeyInfo } from "@/lib/types";
import { loadCore, medianMs, newSigningSeed, type Core } from "@/lib/wasm-bridge";

import DualCanvasWorkbench from "./DualCanvasWorkbench";
import FieldModeView from "./FieldModeView";

type View = "lab" | "field";

export default function GhostPacketApp() {
  const [core, setCore] = useState<Core | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [seed] = useState<Uint8Array>(() => (typeof window === "undefined" ? new Uint8Array(32) : newSigningSeed()));
  const [keyInfo, setKeyInfo] = useState<KeyInfo | null>(null);
  const [view, setView] = useState<View>("lab");
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    loadCore()
      .then((c) => {
        setCore(c);
        const k = c.keyInfo(seed);
        if (k.ok) setKeyInfo(k.value);
        else setLoadError(k.error.message);
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [seed]);

  const loadMs = medianMs("wasm_load");

  return (
    <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-3 py-4 sm:px-6">
      <div className="mist" aria-hidden />
      <div className="grain" aria-hidden />
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/icon.svg`} alt="" className="h-11 w-11" />
          <div>
            <h1 className="display text-[clamp(2rem,3.5vw,3rem)] leading-none text-ink">
              Ghost<em className="text-phosphor glow">Packet</em>
            </h1>
            <p className="mt-1 text-xs text-mist">Air-gap cryptographic séance · signed documents over sound and light</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {keyInfo && (
            <span className="rounded-md border border-grid bg-void/60 px-2 py-1 font-mono text-[11px] text-ion" title={keyInfo.publicKeyHex}>
              session key {keyInfo.fingerprint}
            </span>
          )}
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-void/70 p-1" role="tablist" aria-label="Mode">
            {(
              [
                ["lab", "Virtual lab"],
                ["field", "Field mode PC ↔ phone"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => {
                  setBanner(null);
                  setView(v);
                }}
                className={`rounded-md px-3 py-1.5 text-xs ${view === v ? "bg-phosphor/15 text-phosphor ring-1 ring-phosphor/40" : "text-mute hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {banner && (
        <div className="rounded-lg border border-amber/50 bg-amber/10 px-4 py-2 text-sm text-amber" role="status">
          {banner}
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-alarm/60 bg-alarm/10 px-4 py-3 text-sm text-alarm" role="alert">
          The WebAssembly module failed to load: {loadError}
        </div>
      )}

      {!core || !keyInfo ? (
        !loadError && <div className="panel p-8 text-center font-mono text-sm text-mute">Loading the Rust/WASM core…</div>
      ) : view === "lab" ? (
        <DualCanvasWorkbench core={core} seed={seed} keyInfo={keyInfo} />
      ) : (
        <FieldModeView
          core={core}
          seed={seed}
          keyInfo={keyInfo}
          onFallback={(reason) => {
            setBanner(reason);
            setView("lab");
          }}
        />
      )}

      <footer className="mt-2 flex flex-wrap justify-between gap-2 border-t border-grid pt-3 font-mono text-[10px] text-mute">
        <span>
          ghostpacket-core {core?.version ?? "…"} · WASM loaded {loadMs === null ? "…" : `in ${loadMs.toFixed(0)} ms`} · 0 network calls · signing key generated
          in this tab
        </span>
        <span>
          Frame ≤ {core?.limits.maxFrameSize ?? 512} B · Ed25519 · CRC32 · Reed-Solomon · Luby Transform · MIT
        </span>
      </footer>
    </main>
  );
}
