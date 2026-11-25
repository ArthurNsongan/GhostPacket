"use client";

// Sets the clinic storage namespace before anything else reads storage.
import "./clinic-store";

import AppFrame from "ghostpacket-ui/AppFrame";

// Separate static app under /clinic/: links back to the portal are full page loads.
const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const PORTAL = BASE.replace(/\/clinic$/, "") || "";

export default function ClinicShell({ children }: { children: React.ReactNode }) {
  return (
    <AppFrame
      app="clinic"
      brand={["Ghost", "Clinic"]}
      homeLink={(c) => (
        <a href={`${BASE}/`} aria-label="GhostClinic home">
          {c}
        </a>
      )}
      nav={
        <>
          <a href={`${PORTAL}/`} className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13.5px] text-mist transition-colors hover:bg-ink/[0.04] hover:text-ink">
            ← GhostPacket portal
          </a>
          <a href={`${PORTAL}/tontine/`} className="whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13.5px] text-mist transition-colors hover:bg-ink/[0.04] hover:text-ink">
            GhostTontine ↗
          </a>
        </>
      }
      footerNote="GhostClinic · built on ghostpacket-core + ghostpacket-sdk + ghostpacket-ui · patient data stays on this device"
    >
      {children}
    </AppFrame>
  );
}
