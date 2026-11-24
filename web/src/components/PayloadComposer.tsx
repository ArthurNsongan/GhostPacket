"use client";

import { useState, type Ref } from "react";
import { PRESETS, type Preset } from "@/lib/presets";
import type { Result } from "@/lib/wasm-bridge";
import type { EncodedFrame } from "@/lib/types";
import { DocumentView } from "./ResultCard";

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

/** Emitter column: preset, document, size budget, QR emitter screen. */
export default function PayloadComposer({
  presetId,
  onPreset,
  draftText,
  onDraftText,
  draftError,
  encoded,
  jsonBytes,
  qrCanvasRef,
  qrCaption,
  onSendFsk,
  onSendQr,
  busy,
}: {
  presetId: Preset["id"];
  onPreset: (id: Preset["id"]) => void;
  draftText: string;
  onDraftText: (t: string) => void;
  draftError: string | null;
  encoded: Result<EncodedFrame> | null;
  jsonBytes: number;
  qrCanvasRef: Ref<HTMLCanvasElement>;
  qrCaption: string;
  onSendFsk: () => void;
  onSendQr: () => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  let parsed: Preset["draft"] | null = null;
  try {
    parsed = JSON.parse(draftText) as Preset["draft"];
  } catch {
    parsed = null;
  }

  return (
    <section className="panel flex flex-col gap-4 p-4" aria-labelledby="emitter-title">
      <div className="flex items-baseline justify-between">
        <h2 id="emitter-title" className="panel-title">
          ① Emitter
        </h2>
        <span className="font-mono text-[10px] text-mute">{preset?.persona}</span>
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-void/60 p-1" role="tablist" aria-label="Field document">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            role="tab"
            aria-selected={p.id === presetId}
            disabled={busy}
            onClick={() => onPreset(p.id)}
            className={`rounded-md px-2 py-1.5 text-[12px] leading-tight transition ${
              p.id === presetId ? "bg-phosphor/15 text-phosphor ring-1 ring-phosphor/40" : "text-mute hover:text-ink"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-grid bg-void/40 p-3">
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
            className="h-56 w-full resize-y rounded-md border border-grid bg-void p-2 font-mono text-[11px] text-ink outline-none focus:border-phosphor/60"
            aria-label="Document as JSON"
          />
        ) : parsed ? (
          <DocumentView body={parsed.body} docId={parsed.docId} timestamp={parsed.timestamp} />
        ) : (
          <p className="text-sm text-alarm">Invalid JSON.</p>
        )}
        {draftError && <p className="mt-2 font-mono text-[11px] text-alarm">{draftError}</p>}
      </div>

      <div className="space-y-2 rounded-lg border border-grid bg-void/40 p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-widest text-mute">Byte budget (US-02)</span>
          {encoded?.ok && (
            <span className="font-mono text-[11px] text-phosphor">
              ÷{(jsonBytes / encoded.value.frameLen).toFixed(1)} vs JSON
            </span>
          )}
        </div>
        <Gauge label="JSON text" bytes={jsonBytes} max={Math.max(jsonBytes, 512)} tone="bg-mute/60" />
        {encoded?.ok && (
          <>
            <Gauge label="postcard binary" bytes={encoded.value.serializedLen} max={Math.max(jsonBytes, 512)} tone="bg-ion/70" />
            <Gauge
              label={`Payload ${encoded.value.compressed ? "LZ4" : "raw (LZ4 not worth it)"}`}
              bytes={encoded.value.payloadLen}
              max={Math.max(jsonBytes, 512)}
              tone="bg-amber/80"
            />
            <Gauge label="Signed frame / 512 limit" bytes={encoded.value.frameLen} max={Math.max(jsonBytes, 512)} tone="bg-phosphor" />
          </>
        )}
      </div>

      <div className="rounded-lg border border-grid bg-void/40 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-widest text-mute">Emitter screen · fountain QR</span>
          <span className="font-mono text-[10px] text-mute">{qrCaption}</span>
        </div>
        <div className="flex justify-center rounded-md bg-void p-2">
          <canvas
            ref={qrCanvasRef}
            width={148}
            height={148}
            className="pixelated aspect-square w-40 rounded-sm bg-[#e9fff3]"
            aria-label="QR code of the current droplet"
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onSendFsk}
            disabled={busy || !encoded?.ok}
            className="rounded-md border border-phosphor/40 px-2 py-2 text-[12px] text-phosphor hover:bg-phosphor/10 disabled:opacity-40"
          >
            Send over sound
          </button>
          <button
            type="button"
            onClick={onSendQr}
            disabled={busy || !encoded?.ok}
            className="rounded-md border border-ion/40 px-2 py-2 text-[12px] text-ion hover:bg-ion/10 disabled:opacity-40"
          >
            Send over QR
          </button>
        </div>
      </div>
    </section>
  );
}
