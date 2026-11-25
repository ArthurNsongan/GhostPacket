"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState } from "react";

import { onLevel } from "@/lib/effects";
import { onAirGapChange, registerServiceWorker, type AirGapState } from "@/lib/offline";
import { GhostPacketSDK } from "@/lib/sdk";
import type { KeyInfo } from "@/lib/types";
import { onSfxChange, setSfx, sfx, sfxEnabled } from "@/lib/ui-sfx";
import { loadCore, medianMs, newSigningSeed, type Core } from "@/lib/wasm-bridge";

import KiroTelemetry from "./KiroTelemetry";

export interface GhostState {
  core: Core;
  seed: Uint8Array;
  keyInfo: KeyInfo;
  sdk: GhostPacketSDK;
}

interface ShellContext {
  ghost: GhostState | null;
  loadError: string | null;
  banner: string | null;
  setBanner: (b: string | null) => void;
}

const Ctx = createContext<ShellContext | null>(null);

export function useShell(): ShellContext {
  const c = useContext(Ctx);
  if (!c) throw new Error("useShell outside AppShell");
  return c;
}

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const NAV = [
  { href: "/", label: "Home" },
  { href: "/how-it-works/", label: "How It Works" },
  { href: "/simulation/", label: "Simulation" },
  { href: "/test/", label: "Test (PC ↔ Phone)" },
] as const;

const BADGE: Record<AirGapState, { text: string; tone: string }> = {
  ready: { text: "AIR-GAP READY", tone: "text-phosphor ring-phosphor/40" },
  "offline-active": { text: "OFFLINE · AIR-GAP ACTIVE", tone: "text-phosphor ring-phosphor/60 pulse" },
  online: { text: "ONLINE · CACHING", tone: "text-mist ring-grid" },
  "offline-uncached": { text: "OFFLINE", tone: "text-amber ring-amber/50" },
};

/** Header sigil whose glow follows the live audio level. */
function Sigil() {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(
    () =>
      onLevel((rms) => {
        const el = ref.current;
        if (!el) return;
        const k = Math.min(1, rms * 3);
        el.style.transform = `scale(${1 + k * 0.18})`;
        el.style.filter = `drop-shadow(0 0 ${2 + k * 14}px rgba(94,242,198,${0.25 + k * 0.6}))`;
      }),
    [],
  );
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} src={`${BASE}/icon.svg`} alt="" className="h-10 w-10 transition-transform duration-75" />;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [ghost, setGhost] = useState<GhostState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [air, setAir] = useState<AirGapState>("online");
  const [sfxOn, setSfxOn] = useState(false);
  const [telemetry, setTelemetry] = useState(false);

  useEffect(() => {
    const seed = newSigningSeed();
    loadCore()
      .then((core) => {
        const k = core.keyInfo(seed);
        if (!k.ok) return setLoadError(k.error.message);
        setGhost({ core, seed, keyInfo: k.value, sdk: GhostPacketSDK.fromCore(core, seed) });
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)));
    void registerServiceWorker();
    setSfxOn(sfxEnabled());
    const offSfx = onSfxChange(setSfxOn);
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
      offSfx();
      offAir();
      window.removeEventListener("pointermove", move);
    };
  }, []);

  useEffect(() => setBanner(null), [pathname]);

  const loadMs = medianMs("wasm_load");
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname?.startsWith(href.replace(/\/$/, "")));

  return (
    <Ctx.Provider value={{ ghost, loadError, banner, setBanner }}>
      <div className="mist" aria-hidden />
      <div className="grain" aria-hidden />
      <header className="glass sticky top-0 z-40 border-b border-grid">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2 sm:px-6">
          <Link href="/" className="flex items-center gap-2" aria-label="GhostPacket home">
            <Sigil />
            <span className="display text-2xl leading-none text-ink">
              Ghost<em className="text-phosphor glow">Packet</em>
            </span>
          </Link>
          <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition ${
                  active(n.href) ? "bg-phosphor/15 text-phosphor ring-1 ring-phosphor/40" : "text-mist hover:text-ink"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest ring-1 ${BADGE[air].tone}`} title="Offline service worker status">
              ● {BADGE[air].text}
            </span>
            <button
              type="button"
              onClick={() => {
                setSfx(!sfxOn);
                if (!sfxOn) setTimeout(() => void sfx("tap"), 0);
              }}
              aria-pressed={sfxOn}
              className={`rounded-full px-2.5 py-1 font-mono text-[10px] ring-1 ${sfxOn ? "text-ion ring-ion/50" : "text-mute ring-grid"}`}
            >
              UI SFX {sfxOn ? "ON" : "OFF"}
            </button>
            <button type="button" onClick={() => setTelemetry(true)} className="rounded-full px-2.5 py-1 font-mono text-[10px] text-mist ring-1 ring-grid hover:text-ink">
              Kiro Telemetry
            </button>
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
        <span>Frame ≤ 512 B · Ed25519 · CRC32 · ChaCha20-Poly1305 · Reed-Solomon · Luby Transform · MIT</span>
      </footer>

      {telemetry && <KiroTelemetry ghost={ghost} onClose={() => setTelemetry(false)} />}
    </Ctx.Provider>
  );
}

/** Shows a loading panel until the WASM core is ready. */
export function WithGhost({ children }: { children: (g: GhostState) => React.ReactNode }) {
  const { ghost, loadError } = useShell();
  if (ghost) return <>{children(ghost)}</>;
  if (loadError) return null;
  return <div className="panel p-8 text-center font-mono text-sm text-mute">Loading the Rust/WASM core…</div>;
}
