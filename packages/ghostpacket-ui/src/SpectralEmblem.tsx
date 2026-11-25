"use client";

// Audio-reactive app emblem (HALLOWEEN_REDESIGN_PLAN.md §3.1):
// portal = carved Jack-o'-Lantern, clinic = plague-doctor mask, tontine = wax seal + skeleton key.
// The inner light follows the live audio level (60 FPS, direct style writes, no React
// state per sample), turns ectoplasm on ED25519 VERIFIED and crimson with a tremor on rejection.
import { useEffect, useRef, useState } from "react";

import { onLevel, onSpectral } from "ghostpacket-sdk/effects";
import { currentTheme, onThemeChange, type AppId } from "ghostpacket-sdk/theme";

type Mood = "idle" | "verified" | "rejected";
const LIGHT: Record<Mood, string> = { idle: "#ff9a3c", verified: "#5ef2c6", rejected: "#e11d48" };

function Lantern() {
  return (
    <>
      <path d="M32 13c-2-4 0-8 4-9" className="emblem-line" strokeWidth="2" />
      <path d="M32 15c-14 0-24 8-24 22s10 22 24 22 24-8 24-22-10-22-24-22z" className="emblem-body" />
      <path d="M32 15c-6 0-10 9-10 22s4 22 10 22M32 15c6 0 10 9 10 22s-4 22-10 22" className="emblem-line" />
      <path d="M17 31l7-5 4 8zM47 31l-7-5-4 8z" className="emblem-light" />
      <path d="M30 37l2-4 2 4z" className="emblem-light" />
      <path d="M16 42c5 7 27 7 32 0l-4 1-2 3-3-2-3 3-2-3-3 3-3-3-3 2-2-3z" className="emblem-light" />
    </>
  );
}

function PlagueMask() {
  return (
    <>
      <path d="M14 22c2-10 10-16 20-16s16 6 17 15" className="emblem-line" />
      <path d="M12 26c0 14 8 26 20 26 3 0 6-1 8-3l16 9c2 1 3-1 2-2L44 41c3-4 5-9 5-15 0-6-7-10-17-10S12 20 12 26z" className="emblem-body" />
      <circle cx="23" cy="27" r="5.5" className="emblem-light" />
      <circle cx="38" cy="27" r="5.5" className="emblem-light" />
      <path d="M17.5 27h-5M43.5 27h5M28.5 27h4" className="emblem-line" />
      <path d="M40 43l13 9" className="emblem-line" />
    </>
  );
}

function WaxSeal() {
  return (
    <>
      <path
        d="M32 8l5 3 6-1 3 5 6 2v6l4 4-3 5 2 6-5 4-1 6-6 1-3 5-6-2-6 2-3-5-6-1-1-6-5-4 2-6-3-5 4-4v-6l6-2 3-5 6 1z"
        className="emblem-body"
      />
      <circle cx="32" cy="32" r="14" className="emblem-line" />
      <circle cx="32" cy="29" r="4" className="emblem-light" />
      <path d="M30 32h4l1.5 8h-7z" className="emblem-light" />
      <path d="M6 54l16-16M10 50l3 3M13 47l3 3" className="emblem-line" strokeWidth="2" />
      <circle cx="25" cy="35" r="3" className="emblem-line" strokeWidth="2" />
    </>
  );
}

const SHAPES: Record<AppId, () => React.ReactElement> = { portal: Lantern, clinic: PlagueMask, tontine: WaxSeal };

export default function SpectralEmblem({ app, size = 40 }: { app: AppId; size?: number }) {
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
  const light = mood === "idle" && !haunted ? "var(--color-accent)" : LIGHT[mood];
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
        .emblem-body{fill:#0b0910;stroke:#c9a45c;stroke-width:1.6;stroke-linejoin:round}
        .emblem-line{fill:none;stroke:#c9a45c;stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round;opacity:.85}
        .emblem-light{fill:var(--emblem-light);stroke:none;transition:fill .25s ease}
      `}</style>
      <Shape />
    </svg>
  );
}
