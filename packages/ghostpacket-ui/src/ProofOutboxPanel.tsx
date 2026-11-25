"use client";

import { useEffect, useState } from "react";

import { autoSync, normalizeEndpoint, onOutboxChange, saveEndpoint, savedEndpoint, type OutboxItem, type SyncReport } from "ghostpacket-sdk/outbox";
import { downloadFile } from "ghostpacket-sdk/sdk";
import { frameOf } from "ghostpacket-sdk/outbox";

import type { GhostState } from "./GhostContext";

const STATE_STYLE: Record<OutboxItem["state"], string> = {
  pending: "bg-amber/15 text-amber",
  synced: "bg-phosphor/15 text-phosphor",
  replay: "bg-alarm text-void",
  rejected: "bg-alarm/20 text-alarm",
};

const STATE_LABEL: Record<OutboxItem["state"], string> = {
  pending: "PENDING",
  synced: "SYNCED · 201",
  replay: "DOUBLE SPEND · 409",
  rejected: "REJECTED · 422",
};

/** Offline-to-cloud sync: verified proofs queued here, uploaded to a ghostpacket-verifier when online. */
export default function ProofOutboxPanel({ ghost }: { ghost: GhostState }) {
  const { sdk } = ghost;
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [endpoint, setEndpoint] = useState("");
  const [auto, setAuto] = useState(false);
  const [report, setReport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Session only: the bearer token is never written to storage.
  const [token, setToken] = useState("");
  const opts = token.trim() ? { token: token.trim() } : undefined;

  useEffect(() => {
    setItems(sdk.outbox.list());
    setEndpoint(savedEndpoint());
    return onOutboxChange(() => setItems(sdk.outbox.list()));
  }, [sdk]);

  const norm = endpoint.trim() ? normalizeEndpoint(endpoint) : null;
  const describe = (r: SyncReport) =>
    r.networkError && r.sent === 0
      ? `Not sent: ${r.networkError}. Proofs stay queued.`
      : `${r.synced} synced, ${r.replays} double spend(s) caught by the server, ${r.rejected} rejected${r.networkError ? ` · stopped: ${r.networkError}` : ""}.`;

  useEffect(() => {
    if (!auto || !norm?.ok) return;
    return autoSync(sdk.outbox, () => (norm.ok ? norm.url : ""), (r) => setReport(describe(r)), opts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, norm?.ok && norm.url, sdk, token]);

  const syncNow = async () => {
    if (!norm?.ok) return;
    saveEndpoint(endpoint.trim());
    setBusy(true);
    try {
      setReport(describe(await sdk.syncProofs(norm.url, opts)));
    } finally {
      setBusy(false);
    }
  };

  const pending = items.filter((i) => i.state === "pending").length;

  return (
    <section className="panel p-4" aria-labelledby="outbox-title">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="outbox-title" className="panel-title">
          Proof outbox · offline-to-cloud sync
        </h2>
        <button type="button" onClick={() => sdk.outbox.clear()} disabled={items.length === 0} className="font-mono text-[10px] text-mute hover:text-alarm">
          clear
        </button>
      </div>
      <p className="mt-1 text-[12px] text-mist">
        Every frame verified on this device waits here. When the network returns, it is uploaded to a <span className="font-mono text-ink">ghostpacket-verifier</span>, which re-checks it with the same Rust code and
        catches a voucher already redeemed on another device. <span className="text-ink">Nothing leaves this device until you enter a verifier URL.</span>
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://verifier.example.org  or  http://127.0.0.1:8787"
          aria-label="Verifier URL"
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-grid bg-void px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-phosphor/60"
        />
        <input
          value={token}
          onChange={(e) => setToken(e.target.value)}
          type="password"
          placeholder="token (optional)"
          aria-label="Verifier token"
          autoComplete="off"
          className="w-36 rounded-md border border-grid bg-void px-2 py-1.5 font-mono text-[12px] text-ink outline-none focus:border-phosphor/60"
        />
        <button type="button" onClick={syncNow} disabled={busy || !norm?.ok || pending === 0} className="rounded-md bg-phosphor/90 px-3 py-1.5 text-[12px] font-semibold text-void hover:bg-phosphor disabled:opacity-40">
          {busy ? "Syncing…" : `Sync now (${pending})`}
        </button>
        <label className="flex items-center gap-1 text-[12px] text-mist">
          <input type="checkbox" checked={auto} disabled={!norm?.ok} onChange={(e) => setAuto(e.target.checked)} />
          auto when online
        </label>
      </div>
      {norm && !norm.ok && <p className="mt-1 font-mono text-[11px] text-alarm">{norm.reason}</p>}
      {norm?.ok && <p className="mt-1 font-mono text-[10px] text-mute">POST {norm.url}</p>}
      {report && (
        <p className="mt-2 font-mono text-[11px] text-ink" role="status">
          {report}
        </p>
      )}
      {items.length === 0 ? (
        <p className="mt-3 font-mono text-[11px] text-mute">No proof queued yet. Verify a frame over sound or light.</p>
      ) : (
        <ul className="mt-3 max-h-56 space-y-1 overflow-y-auto">
          {items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-grid bg-void/50 px-2 py-1 font-mono text-[11px]">
              <span className="text-ink">
                {i.docId} · <span className="text-ion">{i.fingerprint}</span> · via {i.channel}
                {i.encrypted ? " · E2EE" : ""}
              </span>
              <span className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATE_STYLE[i.state]}`}>
                  {STATE_LABEL[i.state]}
                  {i.serverCode && i.state === "rejected" ? ` ${i.serverCode}` : ""}
                </span>
                <button type="button" title="Download as .gpkt" onClick={() => downloadFile(sdk.exportGpktFile(frameOf(i), `${i.docId || "proof"}.gpkt`))} className="text-mute hover:text-ink">
                  .gpkt
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 font-mono text-[10px] text-mute">
        Run a verifier: <span className="text-mist">cargo run --release --manifest-path crates/ghostpacket-verifier/Cargo.toml -- serve --tofu --allow-origin {"<this site's origin>"}</span>
      </p>
    </section>
  );
}
