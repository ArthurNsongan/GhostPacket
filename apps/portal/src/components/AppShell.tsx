"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import AppFrame, { navPillClass } from "ghostpacket-ui/AppFrame";
import { useShell } from "ghostpacket-ui/GhostContext";

import KiroTelemetry from "./KiroTelemetry";

export { useShell, WithGhost, type GhostState } from "ghostpacket-ui/GhostContext";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/how-it-works/", label: "How It Works" },
  { href: "/simulation/", label: "Simulation" },
  { href: "/test/", label: "Test (PC ↔ Phone)" },
] as const;

/** The two apps built from the same skeleton, deployed next to the portal. */
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const APPS = [
  { href: `${BASE}/clinic/`, label: "GhostClinic" },
  { href: `${BASE}/tontine/`, label: "GhostTontine" },
] as const;

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [telemetry, setTelemetry] = useState(false);
  const active = (href: string) => (href === "/" ? pathname === "/" : pathname?.startsWith(href.replace(/\/$/, "")));

  return (
    <AppFrame
      app="portal"
      brand={["Ghost", "Packet"]}
      homeLink={(c) => (
        <Link href="/" aria-label="GhostPacket home">
          {c}
        </Link>
      )}
      nav={
        <>
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? "page" : undefined} className={navPillClass(!!active(n.href))}>
              {n.label}
            </Link>
          ))}
          {APPS.map((a) => (
            // Separate static apps: a full page load, not a client-side route.
            <a key={a.href} href={a.href} className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-accent hover:text-ink">
              {a.label} ↗
            </a>
          ))}
        </>
      }
      actions={
        <button type="button" onClick={() => setTelemetry(true)} className="rounded-full px-2.5 py-1 font-mono text-[10px] text-mist ring-1 ring-grid hover:text-ink">
          Kiro Telemetry
        </button>
      }
    >
      <ResetBannerOnNavigate pathname={pathname} />
      {children}
      <TelemetryDrawer open={telemetry} onClose={() => setTelemetry(false)} />
    </AppFrame>
  );
}

function ResetBannerOnNavigate({ pathname }: { pathname: string | null }) {
  const { setBanner } = useShell();
  useEffect(() => setBanner(null), [pathname, setBanner]);
  return null;
}

function TelemetryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { ghost } = useShell();
  return open ? <KiroTelemetry ghost={ghost} onClose={onClose} /> : null;
}
