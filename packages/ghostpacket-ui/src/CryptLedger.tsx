"use client";

import { useEffect, useState } from "react";

import { clearLedger, onLedgerChange, readLedger, type LedgerEntry, type LedgerScope } from "ghostpacket-sdk/ledger";

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return new Date(ms).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

/** "The Crypt Ledger": verified documents seen on this device (anti-replay). */
export default function CryptLedger({ scope, note }: { scope: LedgerScope; note?: string }) {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  useEffect(() => {
    setEntries(readLedger(scope));
    return onLedgerChange(() => setEntries(readLedger(scope)));
  }, [scope]);

  return (
    <section className="panel p-4" aria-labelledby={`ledger-${scope}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id={`ledger-${scope}`} className="panel-title">
          The Crypt Ledger · anti-replay
        </h2>
        <button type="button" onClick={() => clearLedger(scope)} className="font-mono text-[10px] text-mute hover:text-alarm" disabled={entries.length === 0}>
          clear
        </button>
      </div>
      <p className="mt-1 text-[12px] text-mist">
        {note ?? "Each verified document is recorded by issuer and document id. Presenting it again raises REPLAY DETECTED, which blocks offline double-spending."}
      </p>
      {entries.length === 0 ? (
        <p className="mt-3 font-mono text-[11px] text-mute">No document redeemed yet.</p>
      ) : (
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
          {entries.map((e) => (
            <li key={e.key} className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-grid bg-void/50 px-2 py-1 font-mono text-[11px]">
              <span className="text-ink">
                {e.docId} · <span className="text-mist">{e.title}</span>
              </span>
              <span className="text-mute">
                {e.fingerprint} · via {e.channel} · {ago(e.firstSeen)}
                {e.timesSeen > 1 && <span className="ml-1 text-amber">· {e.timesSeen - 1} replay(s) blocked</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
