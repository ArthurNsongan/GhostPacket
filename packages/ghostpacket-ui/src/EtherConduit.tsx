"use client";

import { useEffect, useImperativeHandle, useRef, type Ref } from "react";

import type { DropletFate } from "./FountainGridCanvas";
import { PAL, rgba, watchPalette } from "./palette";

export interface ConduitSink {
  /** Latest audio window: drawn as the ectoplasm waveform. */
  wave(window: Float32Array): void;
  /** One QR frame in flight: an orb that reaches the receiver or shatters. */
  orb(fate: DropletFate): void;
  clear(): void;
}

interface Orb {
  born: number;
  lost: boolean;
  shattered: boolean;
  y: number;
}
interface Ember {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
}

const FLIGHT_MS = 900;
const EMBER_MS = 650;

/**
 * "The Ether Conduit": animated bridge between emitter and receiver. The FSK
 * waveform is the real received signal (noise included); each QR droplet is an
 * orb, crimson embers mark the ones lost on the way.
 */
export default function EtherConduit({ ref }: { ref?: Ref<ConduitSink> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wave = useRef<Float32Array | null>(null);
  const waveAt = useRef(0);
  const orbs = useRef<Orb[]>([]);
  const embers = useRef<Ember[]>([]);
  const raf = useRef<number | null>(null);
  const reduced = useRef(false);

  const draw = () => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const now = performance.now();
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);

    // Conduit rails.
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, rgba(PAL.phosphor, 0.3));
    g.addColorStop(0.5, rgba(PAL.ion, 0.22));
    g.addColorStop(1, rgba(PAL.phosphor, 0.3));
    ctx.strokeStyle = g;
    ctx.lineWidth = 1;
    for (const y of [6, h - 6]) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // FSK waveform (fades if no new audio for 400 ms).
    const fresh = now - waveAt.current < 400;
    const win = wave.current;
    if (win && fresh) {
      ctx.strokeStyle = rgba(PAL.phosphor);
      ctx.shadowColor = rgba(PAL.phosphor);
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      const n = Math.min(win.length, 420);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * w;
        const y = h * 0.35 - (win[win.length - n + i] ?? 0) * h * 0.28;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    // Fountain orbs.
    orbs.current = orbs.current.filter((o) => now - o.born < FLIGHT_MS);
    for (const o of orbs.current) {
      const t = (now - o.born) / FLIGHT_MS;
      const x = t * w;
      if (o.lost && t >= 0.5) {
        // Lost QR frame: the orb dies mid-flight in crimson embers.
        if (!o.shattered) {
          o.shattered = true;
          if (!reduced.current) {
            for (let k = 0; k < 7; k++) {
              const a = (k / 7) * Math.PI * 2 + Math.random() * 0.4;
              embers.current.push({ x, y: o.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 20, born: now });
            }
          }
        }
        continue;
      }
      ctx.fillStyle = rgba(o.lost && t > 0.3 ? PAL.alarm : t < 0.5 ? PAL.ion : PAL.phosphor);
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, o.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    embers.current = embers.current.filter((e) => now - e.born < EMBER_MS);
    for (const e of embers.current) {
      const t = (now - e.born) / 1000;
      ctx.fillStyle = rgba(PAL.alarm, 1 - (now - e.born) / EMBER_MS);
      ctx.fillRect(e.x + e.vx * t, e.y + e.vy * t + 40 * t * t, 2, 2);
    }

    const busy = fresh || orbs.current.length > 0 || embers.current.length > 0;
    raf.current = busy ? requestAnimationFrame(draw) : null;
  };

  const kick = () => {
    if (raf.current === null) raf.current = requestAnimationFrame(draw);
  };

  useImperativeHandle(ref, () => ({
    wave(window) {
      wave.current = window;
      waveAt.current = performance.now();
      kick();
    },
    orb(fate) {
      if (fate === "duplicate") return;
      orbs.current.push({ born: performance.now(), lost: fate === "drop" || fate === "unreadable" || fate === "error", shattered: false, y: 56 + Math.random() * 18 });
      kick();
    },
    clear() {
      wave.current = null;
      orbs.current = [];
      embers.current = [];
      kick();
    },
  }));

  useEffect(() => {
    watchPalette();
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    kick();
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="crt overflow-hidden rounded-lg border border-grid bg-void">
      <canvas ref={canvas} width={480} height={96} className="block h-[96px] w-full" aria-label="Ether Conduit: live acoustic waveform and QR droplets in flight" />
    </div>
  );
}
