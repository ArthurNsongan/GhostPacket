"use client";

import { messageBudget, type MessageInput } from "ghostpacket-sdk/messages";
import type { Limits } from "ghostpacket-sdk/types";

export interface EncryptionSetting {
  on: boolean;
  passphrase: string;
}

/** Plain-text message form with live per-field byte budgets (doc type 0x04). */
export default function MessageComposer({
  value,
  onChange,
  limits,
  disabled,
}: {
  value: MessageInput;
  onChange: (m: MessageInput) => void;
  limits: Limits;
  disabled?: boolean;
}) {
  const budget = messageBudget(value, limits);
  const used = (name: string) => budget.fields.find((f) => f.name === name);
  const counter = (name: string) => {
    const f = used(name);
    return f ? <span className={`font-mono text-[10px] ${f.used > f.max ? "text-alarm" : "text-mute"}`}>{f.used} / {f.max} B</span> : null;
  };
  const input = "w-full rounded-md bg-ink/[0.045] px-2 py-1.5 text-sm text-ink outline-none focus:bg-ink/[0.08] disabled:opacity-50";
  return (
    <div className="space-y-2">
      <label className="block">
        <span className="flex justify-between text-[11px] text-mist">
          Sender {counter("sender")}
        </span>
        <input className={input} value={value.sender} disabled={disabled} onChange={(e) => onChange({ ...value, sender: e.target.value })} placeholder="Fatou Ndiaye, treasurer" />
      </label>
      <label className="block">
        <span className="flex justify-between text-[11px] text-mist">
          Title {counter("title")}
        </span>
        <input className={input} value={value.title} disabled={disabled} onChange={(e) => onChange({ ...value, title: e.target.value })} placeholder="Meeting moved" />
      </label>
      <label className="block">
        <span className="flex justify-between text-[11px] text-mist">
          Message {counter("message")}
        </span>
        <textarea
          className={`${input} h-28 resize-y`}
          value={value.message}
          disabled={disabled}
          onChange={(e) => onChange({ ...value, message: e.target.value })}
          placeholder="Type anything. It is signed, optionally encrypted, and sent over sound or light."
        />
      </label>
    </div>
  );
}

/** Optional end-to-end encryption toggle with a shared passphrase. */
/** True when encryption is on but cannot be applied yet: the frame must not ship in clear. */
export function encryptionBlocked(e: EncryptionSetting): boolean {
  return e.on && !e.passphrase.trim();
}

export function EncryptionToggle({
  value,
  onChange,
  disabled,
  limits,
  demo,
}: {
  value: EncryptionSetting;
  onChange: (v: EncryptionSetting) => void;
  disabled?: boolean;
  limits: Limits;
  demo?: boolean;
}) {
  return (
    <div className={`rounded-lg p-3 ${value.on ? "bg-ion/10" : "bg-ink/[0.035]"}`}>
      <label className="flex items-center justify-between gap-2 text-[12px]">
        <span>
          <span className="font-semibold text-ink">End-to-end encryption</span>{" "}
          <span className="text-mist">ChaCha20-Poly1305 · PBKDF2 ×{limits.pbkdf2Iterations.toLocaleString("en-GB")}</span>
        </span>
        <input type="checkbox" checked={value.on} disabled={disabled} onChange={(e) => onChange({ ...value, on: e.target.checked })} aria-label="Encrypt the payload" />
      </label>
      {value.on && (
        <label className="mt-2 block">
          <span className="text-[11px] text-mist">Shared passphrase (never transmitted){demo ? " · public demo value: change it for real use" : ""}</span>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={value.passphrase}
            disabled={disabled}
            maxLength={limits.maxPassphraseBytes}
            aria-label="Encryption passphrase"
            onChange={(e) => onChange({ ...value, passphrase: e.target.value })}
            className="mt-1 w-full rounded-md bg-ink/[0.045] px-2 py-1.5 font-mono text-sm text-ink outline-none focus:bg-ink/[0.08]"
          />
          {!value.passphrase.trim() ? (
            <span className="mt-1 block font-mono text-[11px] text-alarm">Enter a passphrase, or turn encryption off. Nothing is sent until then.</span>
          ) : (
            value.passphrase.trim().split(/\s+|-/).length < 3 &&
            value.passphrase.length < 16 && (
              <span className="mt-1 block text-[11px] text-amber">Weak: anyone who records the burst can guess offline. Use three or more words.</span>
            )
          )}
        </label>
      )}
    </div>
  );
}
