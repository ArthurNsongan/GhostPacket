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
import GhostCrew from "./GhostCrew";
import { GhostProvider, useShell } from "./GhostContext";
import HauntedFun from "./HauntedFun";
import SpectralEmblem from "./SpectralEmblem";
import ThemeControls from "./ThemeControls";

const BADGE: Record<AirGapState, { text: string; dot: string; tone: string }> = {
  ready: { text: "Air-gap ready", dot: "bg-phosphor", tone: "text-mist" },
  "offline-active": { text: "Offline · air-gap active", dot: "bg-phosphor pulse", tone: "text-phosphor" },
  online: { text: "Online · caching", dot: "bg-mute", tone: "text-mute" },
  "offline-uncached": { text: "Offline", dot: "bg-amber", tone: "text-amber" },
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
      <GhostCrew />
      <HauntedFun />
      <header className="glass sticky top-0 z-40 border-b border-grid">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-8 gap-y-2 px-4 py-2.5 sm:px-8">
          {homeLink(
            <span className="flex items-center gap-2.5">
              <SpectralEmblem app={app} />
              <span className="display-gothic text-[1.65rem] leading-none text-ink">
                {brand[0]}
                <em className="text-accent">{brand[1]}</em>
              </span>
            </span>,
          )}
          {nav && (
            <nav className="order-3 -mx-1 flex w-full gap-0.5 overflow-x-auto sm:order-none sm:w-auto" aria-label="Main">
              {nav}
            </nav>
          )}
          <div className="ml-auto flex items-center gap-4">
            <span className={`flex items-center gap-2 whitespace-nowrap text-[12px] ${BADGE[air].tone}`} title="Offline service worker status">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${BADGE[air].dot}`} />
              {BADGE[air].text}
            </span>
            <ThemeControls />
            {actions}
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-[1500px] flex-col gap-5 px-4 py-6 sm:px-8">
        {banner && (
          <div className="rounded-xl bg-amber/10 px-4 py-2.5 text-sm text-amber" role="status">
            {banner}
          </div>
        )}
        {loadError && (
          <div className="rounded-xl bg-alarm/12 px-4 py-3 text-sm text-alarm" role="alert">
            The WebAssembly module failed to load: {loadError}
          </div>
        )}
        {children}
      </main>

      <footer className="mx-auto mt-6 flex max-w-[1500px] flex-wrap justify-between gap-2 border-t border-grid px-4 py-5 text-[11px] text-mute sm:px-8">
        <span>
          ghostpacket-core {ghost?.core.version ?? "…"} · WASM loaded {loadMs === null ? "…" : `in ${loadMs.toFixed(0)} ms`} · 0 network calls · signing key{" "}
          {ghost ? <span className="font-mono text-ion">{ghost.keyInfo.fingerprint}</span> : "…"} generated in this tab
        </span>
        <span>{footerNote ?? "Frame ≤ 512 B · Ed25519 · CRC32 · ChaCha20-Poly1305 · Reed-Solomon · Luby Transform · MIT"}</span>
      </footer>
    </>
  );
}

/** Navigation link style shared by every app: the active page gets a tonal fill and weight, never an outline. */
export function navPillClass(active: boolean): string {
  return `whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors ${active ? "bg-ink/[0.08] font-medium text-ink" : "text-mist hover:bg-ink/[0.04] hover:text-ink"}`;
}
