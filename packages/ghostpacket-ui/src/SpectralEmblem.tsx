"use client";

// Audio-reactive app emblem (HALLOWEEN_REDESIGN_PLAN.md, V4):
// portal = carved Jack-o'-Lantern, clinic = plague-doctor mask, tontine = wax seal + skeleton key.
// The inner light follows the live audio level (60 FPS, direct style writes, no React
// state per sample), turns ectoplasm on ED25519 VERIFIED and crimson with a tremor on rejection.
import { useEffect, useRef, useState } from "react";

import { onLevel, onSpectral } from "ghostpacket-sdk/effects";
import { currentTheme, onThemeChange, type AppId } from "ghostpacket-sdk/theme";

type Mood = "idle" | "verified" | "rejected";
// Light follows the theme tokens: candlelight at rest, mist green when verified, garnet on rejection.
const LIGHT: Record<Mood, string> = { idle: "var(--color-accent)", verified: "var(--color-phosphor)", rejected: "var(--color-alarm)" };

// Fine-line drawings (V4): a single ivory stroke, no filled body; only the "light" glows.
function Lantern() {
  return (
    <>
      <path d="M32 15c0-4 1.5-7 5-9" className="emblem-line" />
      <path d="M32 15c-13 0-23 8-23 21s10 21 23 21 23-8 23-21-10-21-23-21z" className="emblem-line" />
      <path d="M32 15c-6 0-9.5 9-9.5 21s3.5 21 9.5 21M32 15c6 0 9.5 9 9.5 21s-3.5 21-9.5 21" className="emblem-line emblem-soft" />
      <path d="M19 31l6-4.5 3 7zM45 31l-6-4.5-3 7z" className="emblem-light" />
      <path d="M18 41.5c5 6.5 23 6.5 28 0l-3.5 1-2.5 2.5-2.5-2-2.5 2.5-2.5-2-2.5 2-2.5-2.5-2.5 2-2.5-2.5z" className="emblem-light" />
    </>
  );
}

function PlagueMask() {
  return (
    <>
      <path d="M14 23c2-10 10-16 19-16s16 6 17 15" className="emblem-line emblem-soft" />
      <path d="M12 27c0 14 8 25 20 25 3 0 6-1 8-3l15 8.5c1.6.9 2.6-.8 1.6-1.8L44 41.5c3-4 5-9 5-14.5 0-6-7-10-17-10S12 21 12 27z" className="emblem-line" />
      <circle cx="23" cy="28" r="4.5" className="emblem-light" />
      <circle cx="38" cy="28" r="4.5" className="emblem-light" />
      <path d="M40.5 43.5l12 8.5" className="emblem-line emblem-soft" />
    </>
  );
}

function WaxSeal() {
  return (
    <>
      <path
        d="M32 7l5 3 6-1 3 5 6 2v6l4 4-3 5 2 6-5 4-1 6-6 1-3 5-6-2-6 2-3-5-6-1-1-6-5-4 2-6-3-5 4-4v-6l6-2 3-5 6 1z"
        className="emblem-line"
      />
      <circle cx="32" cy="32" r="14" className="emblem-line emblem-soft" />
      <circle cx="32" cy="29" r="3.6" className="emblem-light" />
      <path d="M30.2 31.5h3.6l1.4 7.5h-6.4z" className="emblem-light" />
    </>
  );
}

const SHAPES: Record<AppId, () => React.ReactElement> = { portal: Lantern, clinic: PlagueMask, tontine: WaxSeal };

export default function SpectralEmblem({ app, size = 36 }: { app: AppId; size?: number }) {
  const svg = useRef<SVGSVGElement>(null);
  const [mood, setMood] = useState<Mood>("idle");
  const [haunted, setHaunted] = useState(true);

  useEffect(() => {
    setHaunted(currentTheme() === "haunted");
    return onThemeChange((t) => setHaunted(t === "haunted"));
  }, []);

  useEffect(
    () =>
      onLevel((rms) => {
        const el = svg.current;
        if (!el) return;
        const k = Math.min(1, rms * 3);
        el.style.transform = `scale(${1 + k * 0.14})`;
        el.style.filter = `drop-shadow(0 0 ${3 + k * 16}px color-mix(in srgb, var(--emblem-light) ${30 + k * 60}%, transparent))`;
      }),
    [],
  );

  useEffect(() => {
    let timer: number | undefined;
    const off = onSpectral((e) => {
      if (e === "verified" || e === "synced") setMood("verified");
      else if (e === "rejected" || e === "replay") setMood("rejected");
      else return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMood("idle"), 1800);
    });
    return () => {
      off();
      window.clearTimeout(timer);
    };
  }, []);

  const Shape = SHAPES[app];
  const light = LIGHT[mood];
  return (
    <svg
      ref={svg}
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden
      data-mood={mood}
      className={`shrink-0 transition-transform duration-75 ${haunted && mood === "idle" ? "lantern-flicker" : ""} ${mood === "rejected" ? "lantern-tremor" : ""}`}
      style={{ "--emblem-light": light } as React.CSSProperties}
    >
      <style>{`
        .emblem-line{fill:none;stroke:var(--color-ink);stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;opacity:.82}
        .emblem-soft{opacity:.38}
        .emblem-light{fill:var(--emblem-light);stroke:none;transition:fill .25s ease}
      `}</style>
      <Shape />
    </svg>
  );
}
