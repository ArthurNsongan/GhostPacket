"use client";

import { useEffect, useRef, useState } from "react";

import { forgetKey, identityText, onKeyringChange, parseIdentity, readKeyring, trustKey, type TrustedKey } from "ghostpacket-sdk/keyring";
import { drawQr } from "ghostpacket-sdk/optical-engine";
import type { KeyInfo } from "ghostpacket-sdk/types";
import type { Core } from "ghostpacket-sdk/wasm-bridge";

/** Emitter side: identity QR that a receiver scans to pin this tab's public key. */
export function IdentityQr({ keyInfo }: { keyInfo: KeyInfo }) {
  const [label, setLabel] = useState("Médina tontine treasurer");
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = identityText(label, keyInfo.publicKeyHex);
  useEffect(() => {
    if (canvas.current) drawQr(canvas.current, text, 4, 3);
  }, [text]);
  return (
    <div className="rounded-lg border border-grid bg-void/40 p-3">
      <span className="text-[11px] uppercase tracking-widest text-mute">Identity QR · keyring ceremony</span>
      <p className="mt-1 text-[12px] text-mist">Show this once to the receiver, who pins your key. Afterwards, frames signed by any other key are rejected (UNTRUSTED_ISSUER).</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <canvas ref={canvas} className="pixelated aspect-square w-36 rounded-sm bg-[#e9fff3]" aria-label="Identity QR code" />
        <div className="min-w-0 flex-1 space-y-1">
          <label className="block text-[11px] text-mist">
            Label
            <input value={label} maxLength={32} onChange={(e) => setLabel(e.target.value)} className="mt-1 w-full rounded-md border border-grid bg-void px-2 py-1 text-sm text-ink outline-none focus:border-phosphor/60" />
          </label>
          <p className="font-mono text-[11px] text-ion">{keyInfo.fingerprint}</p>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(text)} className="font-mono text-[10px] text-mist hover:text-ink">
            copy identity text
          </button>
        </div>
      </div>
    </div>
  );
}

/** Receiver side: pinned issuers, strict mode, and manual pinning by pasted identity text. */
export function KeyringPanel({ core, strict, onStrict, onScan, scanning }: { core: Core; strict: boolean; onStrict: (v: boolean) => void; onScan: () => void; scanning: boolean }) {
  const [keys, setKeys] = useState<TrustedKey[]>([]);
  const [paste, setPaste] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setKeys(readKeyring());
    return onKeyringChange(() => setKeys(readKeyring()));
  }, []);

  const pin = () => {
    const p = parseIdentity(core, paste.trim());
    if (!p.ok) return setError(p.reason);
    trustKey(p.key);
    setPaste("");
    setError(null);
  };

  return (
    <div className="rounded-lg border border-grid bg-void/40 p-3">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] uppercase tracking-widest text-mute">Trusted keyring</span>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" checked={strict} onChange={(e) => onStrict(e.target.checked)} disabled={keys.length === 0} />
          Strict mode
        </label>
      </div>
      <p className="mt-1 text-[12px] text-mist">{strict ? "Only pinned issuers are accepted." : "Trust on first use: any valid signature is accepted and its fingerprint shown."}</p>
      {keys.length > 0 && (
        <ul className="mt-2 space-y-1">
          {keys.map((k) => (
            <li key={k.publicKeyHex} className="flex items-center justify-between rounded-md border border-grid px-2 py-1 font-mono text-[11px]">
              <span className="text-ink">
                {k.label} · <span className="text-ion">{k.fingerprint}</span>
              </span>
              <button type="button" onClick={() => forgetKey(k.publicKeyHex)} className="text-mute hover:text-alarm">
                forget
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={onScan} className="rounded-md border border-ion/50 px-2 py-1.5 text-[12px] text-ion hover:bg-ion/10">
          {scanning ? "Scanning identity QR…" : "Scan identity QR"}
        </button>
        <input
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder="or paste GPKT-KEY:…"
          className="min-w-0 flex-1 rounded-md border border-grid bg-void px-2 py-1 font-mono text-[11px] text-ink outline-none"
        />
        <button type="button" onClick={pin} disabled={!paste.trim()} className="rounded-md border border-grid px-2 py-1 text-[12px] text-mist hover:text-ink disabled:opacity-40">
          Pin
        </button>
      </div>
      {error && <p className="mt-1 font-mono text-[11px] text-alarm">{error}</p>}
    </div>
  );
}
