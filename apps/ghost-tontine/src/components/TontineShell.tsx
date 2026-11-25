"use client";

// Sets the tontine storage namespace before anything else reads storage.
import "./tontine-store";

import AppFrame from "ghostpacket-ui/AppFrame";

// Separate static app under /tontine/: links back to the portal are full page loads.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const PORTAL = BASE.replace(/\/tontine$/, "") || "";

export default function TontineShell({ children }: { children: React.ReactNode }) {
  return (
    <AppFrame
      app="tontine"
      brand={["Ghost", "Tontine"]}
      homeLink={(c) => (
        <a href={`${BASE}/`} aria-label="GhostTontine home">
          {c}
        </a>
      )}
      nav={
        <>
          <a href={`${PORTAL}/`} className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-mist hover:text-ink">
            ← GhostPacket portal
          </a>
          <a href={`${PORTAL}/clinic/`} className="whitespace-nowrap rounded-full px-3 py-1.5 text-sm text-mist hover:text-ink">
            GhostClinic ↗
          </a>
        </>
      }
      footerNote="GhostTontine · built on ghostpacket-core + ghostpacket-sdk + ghostpacket-ui · the treasury stays on this device"
    >
      {children}
    </AppFrame>
  );
}
