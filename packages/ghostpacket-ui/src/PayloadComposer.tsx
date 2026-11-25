"use client";

import { useState, type Ref } from "react";

import type { MessageInput } from "ghostpacket-sdk/messages";
import { PRESETS, type Preset } from "ghostpacket-sdk/presets";
import type { EncodedFrame, Limits } from "ghostpacket-sdk/types";
import type { Result } from "ghostpacket-sdk/wasm-bridge";

import MessageComposer, { EncryptionToggle, type EncryptionSetting } from "./MessageComposer";
import { DocumentView } from "./ResultCard";

export type Source = Preset["id"] | "message";

function Gauge({ label, bytes, max, tone }: { label: string; bytes: number; max: number; tone: string }) {
  const pct = Math.min(100, (bytes / max) * 100);
  return (
    <div>
      <div className="flex justify-between font-mono text-[11px]">
        <span className="text-mute">{label}</span>
        <span className="text-ink">{bytes} B</span>
      </div>
      <div className="mt-0.5 h-1.5 overflow-hidden rounded bg-void">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Emitter column: document source, encryption, byte budget, QR emitter screen. */
export default function PayloadComposer({
  source,
  onSource,
  draftText,
  onDraftText,
  message,
  onMessage,
  encryption,
  onEncryption,
  limits,
  draftError,
  encoded,
  jsonBytes,
  qrCanvasRef,
  qrCaption,
  onSendFsk,
  onSendQr,
  onExport,
  busy,
  demoPassphrase,
}: {
  source: Source;
  onSource: (s: Source) => void;
  draftText: string;
  onDraftText: (t: string) => void;
  message: MessageInput;
  onMessage: (m: MessageInput) => void;
  encryption: EncryptionSetting;
  onEncryption: (e: EncryptionSetting) => void;
  limits: Limits;
  draftError: string | null;
  encoded: Result<EncodedFrame> | null;
  jsonBytes: number;
  qrCanvasRef: Ref<HTMLCanvasElement>;
  qrCaption: string;
  onSendFsk: () => void;
  onSendQr: () => void;
  onExport: () => void;
  busy: boolean;
  demoPassphrase?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const preset = PRESETS.find((p) => p.id === source);
  let parsed: Preset["draft"] | null = null;
  try {
    parsed = JSON.parse(draftText) as Preset["draft"];
  } catch {
    parsed = null;
  }
  const max = Math.max(jsonBytes, 512);

  return (
    <section className="panel flex flex-col gap-4 p-4" aria-labelledby="emitter-title">
      <div className="flex items-baseline justify-between">
        <h2 id="emitter-title" className="panel-title">
          ① Emitter
        </h2>
        <span className="font-mono text-[10px] text-mute">{preset?.persona ?? "Your own words, signed"}</span>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-void/60 p-1 sm:grid-cols-4" role="tablist" aria-label="Document source">
        {[...PRESETS.map((p) => ({ id: p.id as Source, label: p.label })), { id: "message" as Source, label: "✎ Write a message" }].map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === source}
            disabled={busy}
            onClick={() => onSource(p.id)}
            className={`rounded-md px-2 py-1.5 text-[12px] leading-tight transition ${
              p.id === source ? "bg-ink/[0.08] text-ink font-medium" : "text-mute hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-ink/[0.035] p-3">
        {source === "message" ? (
          <MessageComposer value={message} onChange={onMessage} limits={limits} disabled={busy} />
        ) : (
          <>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest text-mute">Document</span>
              <button type="button" className="text-[11px] text-ion hover:underline" onClick={() => setEditing((e) => !e)} disabled={busy}>
                {editing ? "Preview" : "Edit (JSON)"}
              </button>
            </div>
            {editing ? (
              <textarea
                value={draftText}
                onChange={(e) => onDraftText(e.target.value)}
                spellCheck={false}
                className="h-56 w-full resize-y rounded-md bg-ink/[0.045] p-2 font-mono text-[11px] text-ink outline-none focus:bg-ink/[0.08]"
                aria-label="Document as JSON"
              />
            ) : parsed ? (
              <DocumentView body={parsed.body} docId={parsed.docId} timestamp={parsed.timestamp} />
            ) : (
              <p className="text-sm text-alarm">Invalid JSON.</p>
            )}
          </>
        )}
        {draftError && <p className="mt-2 font-mono text-[11px] text-alarm">{draftError}</p>}
      </div>

      <EncryptionToggle value={encryption} onChange={onEncryption} disabled={busy} limits={limits} demo={demoPassphrase} />

      <div className="space-y-2 rounded-xl bg-ink/[0.035] p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-widest text-mute">Byte budget (US-02)</span>
          {encoded?.ok && <span className="font-mono text-[11px] text-phosphor">÷{(jsonBytes / encoded.value.frameLen).toFixed(1)} vs JSON</span>}
        </div>
        <Gauge label="JSON text" bytes={jsonBytes} max={max} tone="bg-mute/60" />
        {encoded?.ok && (
          <>
            <Gauge label="postcard binary" bytes={encoded.value.serializedLen} max={max} tone="bg-ion/70" />
            <Gauge
              label={`Payload ${encoded.value.encrypted ? "· ENC" : ""} ${encoded.value.compressed ? "LZ4" : "raw"} / ${limits.maxPayloadLen}`}
              bytes={encoded.value.payloadLen}
              max={max}
              tone={encoded.value.encrypted ? "bg-ion" : "bg-amber/80"}
            />
            <Gauge label="Signed frame / 512 limit" bytes={encoded.value.frameLen} max={max} tone="bg-phosphor" />
          </>
        )}
      </div>

      <div className="rounded-xl bg-ink/[0.035] p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-widest text-mute">Emitter screen · fountain QR</span>
          <span className="font-mono text-[10px] text-mute">{qrCaption}</span>
        </div>
        <div className="flex justify-center rounded-md bg-void p-2">
          <canvas ref={qrCanvasRef} width={148} height={148} className="pixelated aspect-square w-40 rounded-sm bg-[#e9fff3]" aria-label="QR code of the current droplet" />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={onSendFsk}
            disabled={busy || !encoded?.ok}
            className="rounded-md bg-phosphor/10 px-2 py-2 text-[12px] text-phosphor hover:bg-phosphor/20 disabled:opacity-40"
          >
            Send over sound
          </button>
          <button
            type="button"
            onClick={onSendQr}
            disabled={busy || !encoded?.ok}
            className="rounded-md bg-ion/10 px-2 py-2 text-[12px] text-ion hover:bg-ion/20 disabled:opacity-40"
          >
            Send over QR
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={busy || !encoded?.ok}
            title="Download the signed frame as a .gpkt file"
            className="rounded-md bg-ink/[0.06] transition-colors hover:bg-ink/[0.1] px-2 py-2 text-[12px] text-mist hover:text-ink disabled:opacity-40"
          >
            Export .gpkt
          </button>
        </div>
      </div>
    </section>
  );
}
