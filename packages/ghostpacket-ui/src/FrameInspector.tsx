"use client";

import { useMemo, useState } from "react";
import type { FieldSpan, FrameInspection } from "ghostpacket-sdk/types";

const FIELD_STYLE: Record<FieldSpan["name"], { label: string; text: string; bg: string }> = {
  sync: { label: "Sync 4B", text: "text-ion", bg: "bg-ion/10" },
  version: { label: "Ver 1B", text: "text-amber", bg: "bg-amber/10" },
  flags: { label: "Flags 1B", text: "text-amber", bg: "bg-amber/10" },
  length: { label: "Len 2B", text: "text-amber", bg: "bg-amber/10" },
  payload: { label: "Payload", text: "text-ink", bg: "bg-white/[0.03]" },
  crc32: { label: "CRC32 4B", text: "text-phosphor", bg: "bg-phosphor/10" },
  signature: { label: "Ed25519 64B", text: "text-fuchsia-300", bg: "bg-fuchsia-400/10" },
};

/** Colour-coded hex dissection of a GPKT frame. */
export default function FrameInspector({
  frame,
  inspection,
  flipped,
  title,
  onCurseByte,
}: {
  frame: Uint8Array | null;
  inspection: FrameInspection | null;
  flipped?: { byte: number; bit: number } | null;
  title: string;
  /** "Curse any byte": flips one bit of the clicked byte. */
  onCurseByte?: (byte: number) => void;
}) {
  const [hover, setHover] = useState<FieldSpan["name"] | null>(null);

  const owner = useMemo(() => {
    const map: (FieldSpan | undefined)[] = [];
    for (const f of inspection?.fields ?? []) for (let i = f.offset; i < f.offset + f.len; i++) map[i] = f;
    return map;
  }, [inspection]);

  if (!frame || !inspection) {
    return (
      <section className="panel p-4">
        <h2 className="panel-title">Frame inspector</h2>
        <p className="mt-3 text-sm text-mute">Encode a document to dissect its binary frame.</p>
      </section>
    );
  }

  return (
    <section className="panel p-4" aria-labelledby="inspector-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="inspector-title" className="panel-title">
          Frame inspector · {title}
        </h2>
        <span className={`font-mono text-xs ${inspection.ok ? "text-phosphor" : "text-alarm glow-alarm"}`}>
          {frame.length} bytes · {inspection.ok ? "VALID" : inspection.errorCode}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {inspection.fields.map((f) => {
          const s = FIELD_STYLE[f.name];
          return (
            <button
              key={f.name}
              type="button"
              onMouseEnter={() => setHover(f.name)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(f.name)}
              onBlur={() => setHover(null)}
              className={`rounded-md border px-2 py-1 text-left font-mono text-[11px] ${s.bg} ${
                f.valid === false ? "border-alarm" : "border-grid"
              }`}
            >
              <span className={s.text}>{f.name === "payload" ? `Payload ${f.len}B` : s.label}</span>
              <span className="ml-2">{f.valid === true ? "✓" : f.valid === false ? <span className="text-alarm">✗</span> : "·"}</span>
              <span className="ml-2 text-mute">{f.detail}</span>
            </button>
          );
        })}
      </div>

      {inspection.errorMessage && (
        <p className="mt-2 rounded-md bg-alarm/10 px-3 py-2 font-mono text-xs text-alarm">
          {inspection.errorCode} — {inspection.errorMessage}
        </p>
      )}

      <div className="mt-3 max-h-56 overflow-auto rounded-xl bg-ink/[0.035] p-3">
        <div className="grid grid-cols-[repeat(16,minmax(0,1fr))] gap-x-1 gap-y-0.5 font-mono text-[11px] leading-5 sm:grid-cols-[repeat(32,minmax(0,1fr))]">
          {Array.from(frame, (b, i) => {
            const f = owner[i];
            const s = f ? FIELD_STYLE[f.name] : FIELD_STYLE.payload;
            const isFlip = flipped?.byte === i;
            const dim = hover && f?.name !== hover;
            const cls = `rounded-sm text-center ${
              isFlip ? "bg-alarm font-bold text-void" : `${s.text} ${s.bg} ${dim ? "opacity-25" : ""}`
            } ${f?.valid === false && !isFlip ? "underline decoration-alarm" : ""}`;
            const label = `#${i} · ${f?.name ?? "?"} · 0x${b.toString(16).padStart(2, "0")}`;
            const hex = b.toString(16).padStart(2, "0").toUpperCase();
            return onCurseByte ? (
              <button key={i} type="button" title={`${label} · click to curse`} onClick={() => onCurseByte(i)} className={`${cls} cursor-crosshair hover:bg-alarm/30`}>
                {hex}
              </button>
            ) : (
              <span key={i} title={label} className={cls}>
                {hex}
              </span>
            );
          })}
        </div>
      </div>
      <p className="mt-2 font-mono text-[11px] text-mute">
        {flipped ? `Byte #${flipped.byte}, bit ${flipped.bit} flipped (in red). ` : ""}
        {onCurseByte ? "Click any byte to flip one of its bits and see which defense catches it." : ""}
      </p>
    </section>
  );
}
