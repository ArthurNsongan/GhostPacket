"use client";

import { useEffect, useRef } from "react";

export type DropletFate = "ok" | "drop" | "unreadable" | "duplicate" | "error";

export interface FountainView {
  k: number;
  decoded: boolean[];
  /** Blocks resolved by the latest droplet (flash). */
  flash: number[];
  cascadeDepth: number;
  byElimination: boolean;
  shown: number;
  received: number;
  pending: number;
  complete: boolean;
}

export const EMPTY_FOUNTAIN: FountainView = {
  k: 0,
  decoded: [],
  flash: [],
  cascadeDepth: 0,
  byElimination: false,
  shown: 0,
  received: 0,
  pending: 0,
  complete: false,
};

const COLS = 8;
const CELL = 34;
const GAP = 6;

/** Matrix of the K source blocks of the LT code, resolving in cascade. */
export default function FountainGridCanvas({ view }: { view: FountainView }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const k = Math.max(view.k, 16);
  const rows = Math.ceil(k / COLS);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    for (let i = 0; i < k; i++) {
      const x = (i % COLS) * (CELL + GAP) + GAP / 2;
      const y = Math.floor(i / COLS) * (CELL + GAP) + GAP / 2;
      const exists = i < view.k;
      const done = view.decoded[i] ?? false;
      const flash = view.flash.includes(i);
      ctx.shadowBlur = 0;
      if (!exists) {
        ctx.strokeStyle = "rgba(243,239,230,0.08)";
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
        ctx.setLineDash([]);
        continue;
      }
      if (done) {
        ctx.fillStyle = flash ? "#F3EFE6" : "#5EF2C6";
        ctx.shadowColor = "#5EF2C6";
        ctx.shadowBlur = flash ? 18 : 6;
      } else {
        ctx.fillStyle = "#141720";
      }
      ctx.fillRect(x, y, CELL, CELL);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = done ? "#5EF2C6" : "rgba(243,239,230,0.10)";
      ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
      ctx.fillStyle = done ? "#07080B" : "#5C6475";
      ctx.font = "10px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`B${i}`, x + CELL / 2, y + CELL / 2);
    }
  }, [view, k]);

  const resolved = view.decoded.filter(Boolean).length;
  return (
    <div>
      <canvas
        ref={canvas}
        width={COLS * (CELL + GAP)}
        height={rows * (CELL + GAP)}
        className="mx-auto block w-full max-w-[320px]"
        aria-label={`Fountain blocks resolved: ${resolved} of ${view.k}`}
      />
      <div className="mt-2 grid grid-cols-4 gap-2 font-mono text-[11px]">
        <Stat label="Blocks" value={`${resolved}/${view.k || "–"}`} good={view.complete} />
        <Stat label="QR shown" value={String(view.shown)} />
        <Stat label="Received" value={String(view.received)} />
        <Stat
          label={view.byElimination ? "Gauss" : "Cascade"}
          value={view.byElimination ? "✓" : String(view.cascadeDepth)}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="rounded-md border border-grid bg-void/60 px-2 py-1">
      <div className="text-[9px] uppercase tracking-widest text-mute">{label}</div>
      <div className={good ? "text-phosphor glow" : "text-ink"}>{value}</div>
    </div>
  );
}

/** Strip of the last QR frames: received, lost, unreadable. */
export function DropletStrip({ fates }: { fates: DropletFate[] }) {
  const last = fates.slice(-48);
  const lost = fates.filter((f) => f === "drop").length;
  return (
    <div>
      <div className="flex flex-wrap gap-[3px]" aria-label="QR frame history">
        {last.map((f, i) => (
          <span
            key={i}
            title={f}
            className={`h-3 w-2 rounded-[2px] ${
              f === "ok"
                ? "bg-phosphor"
                : f === "drop"
                  ? "bg-alarm/80"
                  : f === "duplicate"
                    ? "bg-ion/50"
                    : f === "unreadable"
                      ? "bg-amber/70"
                      : "bg-alarm"
            }`}
          />
        ))}
        {last.length === 0 && <span className="text-[11px] text-mute">No QR frame sent yet.</span>}
      </div>
      {fates.length > 0 && (
        <p className="mt-1 font-mono text-[10px] text-mute">
          {fates.length} frames · {lost} lost ({Math.round((lost / fates.length) * 100)} %)
        </p>
      )}
    </div>
  );
}
