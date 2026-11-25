"use client";

import type { AttackKind, AttackOutcome } from "@/lib/tamper-lab";

const ATTACKS: { kind: Exclude<AttackKind, "byte">; label: string; expect: string; encryptedOnly?: boolean }[] = [
  { kind: "payload", label: "Curse payload", expect: "CRC32_MISMATCH" },
  { kind: "signature", label: "Curse signature", expect: "INVALID_SIGNATURE" },
  { kind: "rogue", label: "Forge rogue key", expect: "UNTRUSTED_ISSUER" },
  { kind: "passphrase", label: "Wrong passphrase", expect: "DECRYPTION_FAILED", encryptedOnly: true },
];

/** Three-layer tamper lab: 1-click attacks plus "click any byte" in the inspector. */
export default function TamperLab({
  onAttack,
  onRestore,
  last,
  encrypted,
  disabled,
}: {
  onAttack: (kind: Exclude<AttackKind, "byte">) => void;
  onRestore: () => void;
  last: AttackOutcome | null;
  encrypted: boolean;
  disabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-alarm/40 bg-alarm/5 p-3">
      <span className="text-[11px] uppercase tracking-widest text-alarm/80">Tamper lab (US-03)</span>
      <p className="mt-1 text-[12px] text-mist">Attack the frame, or click any byte in the inspector below to curse it. Each layer shows whether it held.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {ATTACKS.filter((a) => !a.encryptedOnly || encrypted).map((a) => (
          <button
            key={a.kind}
            type="button"
            onClick={() => onAttack(a.kind)}
            disabled={disabled}
            title={`Expected: ${a.expect}`}
            className="rounded-md bg-alarm/85 px-2 py-2 text-[12px] font-semibold text-void hover:bg-alarm disabled:opacity-40"
          >
            {a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onRestore}
          disabled={disabled || !last}
          className="rounded-md border border-phosphor/40 px-2 py-2 text-[12px] text-phosphor hover:bg-phosphor/10 disabled:opacity-40"
        >
          Restore intact frame
        </button>
      </div>
      {last && (
        <div className="mt-3">
          <p className="font-mono text-[11px] text-ink">
            {last.title} → {last.caughtBy ? <span className="text-alarm">caught by {last.caughtBy}</span> : <span className="text-phosphor">accepted</span>}
          </p>
          <ol className="mt-1 flex flex-wrap gap-1" aria-label="Defense layers">
            {last.layers.map((l) => (
              <li
                key={l.id}
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${
                  l.state === "pass" ? "bg-phosphor/15 text-phosphor" : l.state === "fail" ? "bg-alarm text-void" : "bg-void/70 text-mute"
                }`}
              >
                {l.state === "pass" ? "✓" : l.state === "fail" ? "✗" : "·"} {l.label}
              </li>
            ))}
          </ol>
          {last.note && <p className="mt-1 text-[11px] text-mist">{last.note}</p>}
        </div>
      )}
    </div>
  );
}
