"use client";

// Spectral bats (HALLOWEEN_REDESIGN_PLAN.md, V5): a few resident bats drift in
// the night sky; every click releases a tiny flock from the pointer; a
// transmission sends a swarm from left to right; a lost droplet turns one bat
// into ember sparks; a rejection scatters the swarm.
// Canvas 2D, pointer-events: none, behind the panels. Haunted Mode only; stops
// under prefers-reduced-motion and while the tab is hidden.
import { useEffect, useRef } from "react";

import { onSpectral } from "ghostpacket-sdk/effects";
import { hauntedMotion, onThemeChange } from "ghostpacket-sdk/theme";

import { PAL, rgba, watchPalette } from "./palette";

interface Bat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  phase: number;
  flap: number;
  ttl: number; // frames left; Infinity for ambient bats
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

// A handful of resident bats; the rest appear when something happens.
const AMBIENT = 4;
const MAX_BATS = 48;

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function drawBat(ctx: CanvasRenderingContext2D, b: Bat) {
  const w = Math.sin(b.phase) * 0.8; // wing angle
  const s = b.size;
  ctx.save();
  ctx.translate(b.x, b.y);
  ctx.scale(Math.sign(b.vx) || 1, 1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  // left wing (scalloped)
  ctx.quadraticCurveTo(-s * 0.6, -s * (0.5 + w), -s * 1.4, -s * (0.2 + w * 0.9));
  ctx.quadraticCurveTo(-s * 1.1, s * 0.05, -s * 0.9, s * 0.1);
  ctx.quadraticCurveTo(-s * 0.6, -s * 0.05, -s * 0.45, s * 0.2);
  ctx.quadraticCurveTo(-s * 0.25, s * 0.05, 0, s * 0.25);
  // right wing
  ctx.quadraticCurveTo(s * 0.25, s * 0.05, s * 0.45, s * 0.2);
  ctx.quadraticCurveTo(s * 0.6, -s * 0.05, s * 0.9, s * 0.1);
  ctx.quadraticCurveTo(s * 1.1, s * 0.05, s * 1.4, -s * (0.2 + w * 0.9));
  ctx.quadraticCurveTo(s * 0.6, -s * (0.5 + w), 0, 0);
  ctx.fill();
  // ears
  ctx.beginPath();
  ctx.moveTo(-s * 0.12, -s * 0.05);
  ctx.lineTo(-s * 0.08, -s * 0.28);
  ctx.lineTo(0, -s * 0.08);
  ctx.lineTo(s * 0.08, -s * 0.28);
  ctx.lineTo(s * 0.12, -s * 0.05);
  ctx.fill();
  ctx.restore();
}

export default function BatSwarmLayer() {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    let raf: number | null = null;
    let w = 0;
    let h = 0;
    const bats: Bat[] = [];
    const sparks: Spark[] = [];

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const ambient = (): Bat => ({ x: rand(0, w), y: rand(h * 0.05, h * 0.55), vx: rand(0.25, 0.6) * (Math.random() < 0.5 ? -1 : 1), vy: rand(-0.1, 0.1), size: rand(7, 13), phase: rand(0, 6), flap: rand(0.18, 0.28), ttl: Infinity });
    const seed = () => {
      bats.length = 0;
      for (let i = 0; i < AMBIENT; i++) bats.push(ambient());
    };

    let dirty = true;
    const frame = () => {
      // Idle sky: nothing to draw, keep the canvas untouched until the next event.
      if (bats.length === 0 && sparks.length === 0 && !dirty) {
        raf = requestAnimationFrame(frame);
        return;
      }
      dirty = bats.length > 0 || sparks.length > 0;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = rgba(PAL.ion, 0.42);
      for (let i = bats.length - 1; i >= 0; i--) {
        const b = bats[i];
        if (!b) continue;
        b.phase += b.flap;
        b.x += b.vx;
        b.y += b.vy + Math.sin(b.phase * 0.25) * 0.15;
        b.ttl--;
        if (b.ttl === Infinity) {
          if (b.x < -40) b.x = w + 40;
          if (b.x > w + 40) b.x = -40;
          if (b.y < 0 || b.y > h * 0.7) b.vy = -b.vy;
        } else if (b.ttl <= 0 || b.x < -60 || b.x > w + 60 || b.y < -60 || b.y > h + 60) {
          bats.splice(i, 1);
          continue;
        }
        drawBat(ctx, b);
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        if (!s) continue;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.04;
        s.life -= 0.025;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.fillStyle = rgba(PAL.accent, s.life);
        ctx.fillRect(s.x, s.y, 2, 2);
      }
      raf = requestAnimationFrame(frame);
    };

    const running = () => raf !== null;
    const start = () => {
      if (running() || !hauntedMotion() || document.hidden) return;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      ctx.clearRect(0, 0, w, h);
    };
    const sync = () => (hauntedMotion() && !document.hidden ? start() : stop());

    watchPalette();
    resize();
    seed();
    sync();

    const offTheme = onThemeChange(() => sync());
    const offSpectral = onSpectral((e) => {
      if (!running()) return;
      if (e === "transmit") {
        for (let i = 0; i < 9 && bats.length < MAX_BATS; i++) {
          bats.push({ x: rand(-80, -10), y: h * 0.45 + rand(-90, 90), vx: rand(3.5, 6), vy: rand(-0.6, 0.6), size: rand(6, 11), phase: rand(0, 6), flap: rand(0.4, 0.55), ttl: 600 });
        }
      } else if (e === "drop") {
        const b = bats.find((x) => x.ttl !== Infinity) ?? bats[Math.floor(Math.random() * bats.length)];
        if (!b) return;
        for (let i = 0; i < 14; i++) sparks.push({ x: b.x, y: b.y, vx: rand(-1.6, 1.6), vy: rand(-2, 0.5), life: 1 });
        if (b.ttl !== Infinity) b.ttl = 0;
      } else if (e === "rejected" || e === "replay") {
        const cx = w / 2;
        const cy = h * 0.35;
        for (let i = 0; i < 10 && bats.length < MAX_BATS; i++) {
          const a = rand(0, Math.PI * 2);
          bats.push({ x: cx, y: cy, vx: Math.cos(a) * rand(3, 5), vy: Math.sin(a) * rand(2, 4), size: rand(7, 12), phase: rand(0, 6), flap: 0.6, ttl: 240 });
        }
      }
    });
    // Every click (outside text fields) lets a tiny flock out of the pointer.
    const onPointer = (e: PointerEvent) => {
      if (!running() || e.button !== 0) return;
      const t = e.target as Element | null;
      if (t?.closest?.("input, textarea, select, [contenteditable]")) return;
      for (let i = 0; i < 4 && bats.length < MAX_BATS; i++) {
        const a = rand(-Math.PI * 0.95, -Math.PI * 0.05);
        bats.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * rand(2.2, 4), vy: Math.sin(a) * rand(1.6, 3.2), size: rand(4.5, 7.5), phase: rand(0, 6), flap: rand(0.55, 0.7), ttl: 150 });
      }
    };
    window.addEventListener("pointerdown", onPointer, { passive: true });
    const onVis = () => sync();
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVis);
    motion.addEventListener("change", sync);
    return () => {
      stop();
      offTheme();
      offSpectral();
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("visibilitychange", onVis);
      motion.removeEventListener("change", sync);
    };
  }, []);

  return <canvas ref={canvas} aria-hidden className="haunt-only pointer-events-none fixed inset-0 z-[25] h-full w-full" />;
}
