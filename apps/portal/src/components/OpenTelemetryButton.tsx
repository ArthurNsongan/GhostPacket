"use client";

/** Opens the Kiro Telemetry drawer of the AppShell from anywhere on the page. */
export const OPEN_TELEMETRY = "gp:open-telemetry";

export default function OpenTelemetryButton({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_TELEMETRY))} className={className}>
      {children}
    </button>
  );
}
