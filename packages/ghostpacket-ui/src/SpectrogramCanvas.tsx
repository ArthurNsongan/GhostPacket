"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import type { Core, SpectrumAnalyzer } from "ghostpacket-sdk/wasm-bridge";

export interface SignalSink {
  push(window: Float32Array, sampleRate: number): void;
  clear(): void;
}

const F_MIN = 900;
const F_MAX = 3500;
const MARKERS = [
  { hz: 1200, label: "1200 sync−", sync: true },
  { hz: 1600, label: "1600 · 00", sync: false },
  { hz: 2000, label: "2000 · 01", sync: false },
  { hz: 2400, label: "2400 · 11", sync: false },
  { hz: 2800, label: "2800 · 10", sync: false },
  { hz: 3200, label: "3200 sync+", sync: true },
];

/**
 * dB (−62..0) → phosphor palette RGB. A modem tone peaks near −3 dB; white
 * noise at 10 dB SNR sits near −38 dB per bin, so it stays dim green and the
 * FSK carriers stand out.
 */
function palette(db: number): [number, number, number] {
  // Gradient from UI_DESIGN_GUIDELINES.md §3.2: #07080B → #0D4A3E → #5EF2C6 → #F3EFE6.
  const t = Math.max(0, Math.min(1, (db + 62) / 62));
  const stops: [number, [number, number, number]][] = [
    [0, [7, 8, 11]],
    [0.45, [13, 74, 62]],
    [0.85, [94, 242, 198]],
    [1, [243, 239, 230]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i] as [number, [number, number, number]];
    const [t0, c0] = stops[i - 1] as [number, [number, number, number]];
    if (t <= t1) {
      const u = (t - t0) / (t1 - t0);
      return [Math.round(c0[0] + (c1[0] - c0[0]) * u), Math.round(c0[1] + (c1[1] - c0[1]) * u), Math.round(c0[2] + (c1[2] - c0[2]) * u)];
    }
  }
  return [243, 239, 230];
}

const SCREEN = "#07080B";

/** Scrolling FFT waterfall (FFT computed in WASM) with FSK carrier markers. */
export default function SpectrogramCanvas({
  core,
  ref,
  syncLocked,
  caption,
}: {
  core: Core | null;
  ref?: Ref<SignalSink>;
  syncLocked: boolean;
  caption?: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const analyzer = useRef<SpectrumAnalyzer | null>(null);

  useEffect(() => {
    if (!core) return;
    analyzer.current = core.spectrum(1024);
    return () => {
      analyzer.current?.free();
      analyzer.current = null;
    };
  }, [core]);

  useImperativeHandle(ref, () => ({
    push(window, sampleRate) {
      const c = canvas.current;
      const a = analyzer.current;
      if (!c || !a || window.length === 0) return;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      const mags = a.compute(window);
      const col = 2;
      ctx.drawImage(c, -col, 0);
      const h = c.height;
      const img = ctx.createImageData(col, h);
      const binHz = sampleRate / 1024;
      for (let y = 0; y < h; y++) {
        const f = F_MIN + (1 - y / (h - 1)) * (F_MAX - F_MIN);
        const bin = Math.round(f / binHz);
        const [r, g, b] = palette(mags[bin] ?? -120);
        for (let x = 0; x < col; x++) {
          const i = (y * col + x) * 4;
          img.data[i] = r;
          img.data[i + 1] = g;
          img.data[i + 2] = b;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, c.width - col, 0);
    },
    clear() {
      const c = canvas.current;
      const ctx = c?.getContext("2d");
      if (c && ctx) {
        ctx.fillStyle = SCREEN;
        ctx.fillRect(0, 0, c.width, c.height);
      }
    },
  }));

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.fillStyle = SCREEN;
      ctx.fillRect(0, 0, c.width, c.height);
    }
  }, []);

  return (
    <div className="crt relative overflow-hidden rounded-lg border border-grid bg-void">
      <canvas ref={canvas} width={560} height={200} className="block h-[200px] w-full" aria-label="FFT spectrogram of the received signal" />
      <div className="pointer-events-none absolute inset-0">
        {MARKERS.map((m) => {
          const top = (1 - (m.hz - F_MIN) / (F_MAX - F_MIN)) * 100;
          return (
            <div key={m.hz} className="absolute left-0 right-0" style={{ top: `${top}%` }}>
              <div className={`border-t border-dashed ${m.sync ? "border-ion/25" : "border-phosphor/20"}`} />
              <span className={`absolute right-1 -translate-y-1/2 font-mono text-[9px] ${m.sync ? "text-ion/70" : "text-phosphor/60"}`}>
                {m.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="absolute left-2 top-2 flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-widest ${
            syncLocked ? "bg-phosphor text-void pulse" : "bg-void/80 text-mute ring-1 ring-grid"
          }`}
        >
          {syncLocked ? "SYNC LOCK" : "NO SYNC"}
        </span>
        {caption && <span className="font-mono text-[10px] text-mute">{caption}</span>}
      </div>
    </div>
  );
}

/** Time-domain trace of the channel (what the microphone hears). */
export function Oscilloscope({ ref }: { ref?: Ref<SignalSink> }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  const draw = (window: Float32Array | null) => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    ctx.fillStyle = SCREEN;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.strokeStyle = "rgba(243,239,230,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= c.width; x += c.width / 10) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, c.height);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(0, c.height / 2);
    ctx.lineTo(c.width, c.height / 2);
    ctx.stroke();
    if (!window || window.length === 0) return;
    ctx.strokeStyle = "#5EF2C6";
    ctx.shadowColor = "#5EF2C6";
    ctx.shadowBlur = 6;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = Math.min(window.length, 480);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * c.width;
      const y = c.height / 2 - (window[window.length - n + i] ?? 0) * c.height * 0.45;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  };

  useImperativeHandle(ref, () => ({
    push(window) {
      draw(window);
    },
    clear() {
      draw(null);
    },
  }));

  useEffect(() => draw(null), []);

  return (
    <div className="crt overflow-hidden rounded-lg border border-grid">
      <canvas ref={canvas} width={480} height={90} className="block h-[90px] w-full" aria-label="Acoustic channel oscilloscope" />
    </div>
  );
}
