"use client";

// Shared frame of every GhostPacket app: session core (GhostProvider), haunted
// atmosphere, glass header (emblem, title, navigation, offline badge, theme
// switches), banner / load error, footer. Apps pass their own navigation links,
// so this package stays independent of Next.js.
import { useEffect, useState } from "react";

import { onAirGapChange, registerServiceWorker, type AirGapState } from "ghostpacket-sdk/offline";
import { setStorageNamespace } from "ghostpacket-sdk/storage";
import type { AppId } from "ghostpacket-sdk/theme";
import { medianMs } from "ghostpacket-sdk/wasm-bridge";

import BatSwarmLayer from "./BatSwarmLayer";
import BloodMoonAtmosphere from "./BloodMoonAtmosphere";
import { GhostProvider, useShell } from "./GhostContext";
import SpectralEmblem from "./SpectralEmblem";
import ThemeControls from "./ThemeControls";

const BADGE: Record<AirGapState, { text: string; tone: string }> = {
  ready: { text: "AIR-GAP READY", tone: "text-phosphor ring-phosphor/40" },
  "offline-active": { text: "OFFLINE · AIR-GAP ACTIVE", tone: "text-phosphor ring-phosphor/60 pulse" },
  online: { text: "ONLINE · CACHING", tone: "text-mist ring-grid" },
  "offline-uncached": { text: "OFFLINE", tone: "text-amber ring-amber/50" },
};

export interface AppFrameProps {
  app: AppId;
  /** Brand: first part in ink, second part in the accent colour, e.g. ["Ghost", "Clinic"]. */
  brand: [string, string];
  /** Home link wrapping the emblem and brand (an app's router link). */
  homeLink: (content: React.ReactNode) => React.ReactNode;
  nav?: React.ReactNode;
  actions?: React.ReactNode;
  footerNote?: React.ReactNode;
  children: React.ReactNode;
}

export default function AppFrame(props: AppFrameProps) {
  // Same-origin apps keep separate data; the portal keeps the V2 (unprefixed) keys.
  // Synchronous and idempotent, before any child reads storage.
  setStorageNamespace(props.app === "portal" ? "" : props.app);
  return (
    <GhostProvider>
      <Frame {...props} />
    </GhostProvider>
  );
}

function Frame({ app, brand, homeLink, nav, actions, footerNote, children }: AppFrameProps) {
  const { ghost, loadError, banner } = useShell();
  const [air, setAir] = useState<AirGapState>("online");

  useEffect(() => {
    void registerServiceWorker();
    const offAir = onAirGapChange(setAir);
    // Border spotlight: one delegated listener feeds the hovered panel's CSS variables.
    const move = (e: PointerEvent) => {
      const panel = (e.target as Element | null)?.closest?.(".panel") as HTMLElement | null;
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      panel.style.setProperty("--mx", `${e.clientX - r.left}px`);
      panel.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      offAir();
      window.removeEventListener("pointermove", move);
    };
  }, []);

  const loadMs = medianMs("wasm_load");
  return (
    <>
      <div className="mist" aria-hidden />
      <div className="grain" aria-hidden />
      <BloodMoonAtmosphere />
      <BatSwarmLayer />
      <header className="glass sticky top-0 z-40 border-b border-grid">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2 sm:px-6">
          {homeLink(
            <span className="flex items-center gap-2">
              <SpectralEmblem app={app} />
              <span className="display-gothic text-2xl leading-none text-ink">
                {brand[0]}
                <em className="text-accent not-italic">{brand[1]}</em>
              </span>
            </span>,
          )}
          {nav && (
            <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Main">
              {nav}
            </nav>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest ring-1 ${BADGE[air].tone}`} title="Offline service worker status">
              ● {BADGE[air].text}
            </span>
            <ThemeControls />
            {actions}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-3 py-4 sm:px-6">
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
        {children}
      </main>

      <footer className="mx-auto mt-2 flex max-w-[1500px] flex-wrap justify-between gap-2 border-t border-grid px-3 py-3 font-mono text-[10px] text-mute sm:px-6">
        <span>
          ghostpacket-core {ghost?.core.version ?? "…"} · WASM loaded {loadMs === null ? "…" : `in ${loadMs.toFixed(0)} ms`} · 0 network calls · signing key{" "}
          {ghost ? <span className="text-ion">{ghost.keyInfo.fingerprint}</span> : "…"} generated in this tab
        </span>
        <span>{footerNote ?? "Frame ≤ 512 B · Ed25519 · CRC32 · ChaCha20-Poly1305 · Reed-Solomon · Luby Transform · MIT"}</span>
      </footer>
    </>
  );
}

/** Pill style for navigation links, shared by every app. */
export function navPillClass(active: boolean): string {
  return `whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${active ? "bg-phosphor/15 text-phosphor ring-1 ring-phosphor/40" : "text-mist hover:text-ink"}`;
}
