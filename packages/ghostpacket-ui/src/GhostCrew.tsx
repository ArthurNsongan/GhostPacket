"use client";

// Ghostlings (V5): a few friendly Kiro-style ghosts that haunt the page margins.
// GSAP drives everything: idle bobbing, wandering between the gutters, eyes that
// follow the pointer, and a "Boo!" with a giggle when clicked (then poof, and
// they come back elsewhere). They also react to protocol moments:
// transmit → they race along, verified → happy hop, rejected / replay → scared.
// Haunted Mode only; nothing runs under prefers-reduced-motion.
import { gsap } from "gsap";
import { useEffect, useRef, useState } from "react";

import { onSpectral } from "ghostpacket-sdk/effects";
import { hauntedMotion, onThemeChange } from "ghostpacket-sdk/theme";
import { funSfx } from "ghostpacket-sdk/ui-sfx";

/** Original ghost drawing: dome, wavy hem, big oval eyes, blush. viewBox 100 × 110. */
export function Ghostling({ size = 56 }: { size?: number }) {
  return (
    <svg viewBox="0 0 100 110" width={size} height={size * 1.1} aria-hidden>
      <path
        className="g-body"
        d="M50 6C26 6 13 25 13 49v42c0 6 6 10 11 5 5-5 9-5 13 1 4 6 9 7 13 1 4-6 9-6 13 0 4 6 9 5 13-1 4-5 9-3 11 2V49C87 25 74 6 50 6z"
      />
      <g className="g-pupils">
        <ellipse className="g-eye" cx="37" cy="46" rx="6.5" ry="9.5" />
        <ellipse className="g-eye" cx="63" cy="46" rx="6.5" ry="9.5" />
        <circle className="g-shine" cx="39" cy="42" r="2.2" />
        <circle className="g-shine" cx="65" cy="42" r="2.2" />
      </g>
      <ellipse className="g-cheek" cx="27" cy="60" rx="6" ry="3.5" />
      <ellipse className="g-cheek" cx="73" cy="60" rx="6" ry="3.5" />
      <ellipse className="g-mouth g-eye" cx="50" cy="64" rx="4" ry="3.2" />
      <path className="g-smile" d="M42 61q8 9 16 0" fill="none" stroke="oklch(0.16 0.03 300)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const BOOS = ["Boo!", "Boo?", "Hehe", "Wooo", "Peek!"];

interface Spec {
  size: number;
  side: "left" | "right";
}

const CREW: Spec[] = [
  { size: 58, side: "left" },
  { size: 66, side: "right" },
  { size: 44, side: "right" },
];

export default function GhostCrew() {
  const [on, setOn] = useState(false);

  useEffect(() => {
    const sync = () => setOn(hauntedMotion());
    sync();
    const off = onThemeChange(sync);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    motion.addEventListener("change", sync);
    return () => {
      off();
      motion.removeEventListener("change", sync);
    };
  }, []);

  return on ? <Crew /> : null;
}

function Crew() {
  const root = useRef<HTMLDivElement>(null);
  const [count] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 1 : CREW.length));

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ghosts = [...el.querySelectorAll<HTMLElement>(".ghostling")];
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const rand = gsap.utils.random;

    const ctx = gsap.context(() => {
      ghosts.forEach((g, i) => {
        const spec = CREW[i] ?? CREW[0]!;
        const svg = g.querySelector("svg")!;
        const pupils = g.querySelector<SVGGElement>(".g-pupils")!;
        const bubble = g.querySelector<HTMLElement>(".boo-bubble")!;
        let side = spec.side;
        let busy = false;

        // Wandering stays in the gutters on wide screens, low corners on phones.
        const target = () => {
          const w = W();
          const h = H();
          const narrow = w < 768;
          const xs = narrow ? [0.04 * w, 0.22 * w] : side === "left" ? [0.015 * w, 0.12 * w] : [0.86 * w, 0.95 * w - spec.size];
          const ys = narrow ? [0.7 * h, 0.86 * h] : [0.2 * h, 0.85 * h];
          return { x: rand(xs[0]!, xs[1]!), y: rand(ys[0]!, ys[1]!) };
        };
        const start = target();
        gsap.set(g, { x: start.x, y: start.y, opacity: 0, scale: 0.4 });
        gsap.to(g, { opacity: 0.94, scale: 1, duration: 1.1, delay: 0.6 + i * 0.5, ease: "back.out(2)" });

        // Idle: bob and sway on the inner SVG so wandering and bobbing combine.
        gsap.to(svg, { y: -12, duration: rand(1.5, 2.2), ease: "sine.inOut", yoyo: true, repeat: -1 });
        gsap.to(svg, { rotation: rand(-7, -4), duration: rand(2.4, 3.2), ease: "sine.inOut", yoyo: true, repeat: -1, transformOrigin: "50% 80%" });
        gsap.to(svg, { scaleY: 0.95, scaleX: 1.04, duration: 0.9, ease: "sine.inOut", yoyo: true, repeat: -1, transformOrigin: "50% 100%" });

        const wander = () => {
          if (!busy) {
            const t = target();
            gsap.to(g, { x: t.x, y: t.y, duration: rand(5, 8), ease: "sine.inOut" });
          }
          gsap.delayedCall(rand(6, 10), wander);
        };
        gsap.delayedCall(rand(2, 5), wander);

        // Eyes follow the pointer.
        const px = gsap.quickTo(pupils, "x", { duration: 0.4, ease: "power3.out" });
        const py = gsap.quickTo(pupils, "y", { duration: 0.4, ease: "power3.out" });
        // Shy: when the pointer comes close, it usually slips away (so it never
        // sits on what you want to read or click), but now and then it lets you catch it.
        let shyUntil = 0;
        (g as HTMLElement & { look?: (x: number, y: number) => void }).look = (x, y) => {
          const r = g.getBoundingClientRect();
          const dx = x - (r.left + r.width / 2);
          const dy = y - (r.top + r.height / 2);
          const d = Math.hypot(dx, dy) || 1;
          px((dx / d) * 3.2);
          py((dy / d) * 2.6);
          const now = performance.now();
          if (busy || d > spec.size + 70 || now < shyUntil) return;
          shyUntil = now + 1600;
          if (Math.random() < 0.3) return; // caught off guard: click it!
          const cur = { x: Number(gsap.getProperty(g, "x")), y: Number(gsap.getProperty(g, "y")) };
          const away = 150 + Math.random() * 90;
          const nx = gsap.utils.clamp(8, W() - spec.size - 8, cur.x - (dx / d) * away);
          const ny = gsap.utils.clamp(80, H() - spec.size * 1.2 - 8, cur.y - (dy / d) * away);
          gsap.to(g, { x: nx, y: ny, duration: 0.7, ease: "power3.out", overwrite: "auto" });
          gsap.fromTo(svg, { scaleX: 0.8, scaleY: 1.15 }, { scaleX: 1, scaleY: 1, duration: 0.6, ease: "elastic.out(1, 0.4)" });
          if (Math.random() < 0.35) void funSfx("giggle");
        };

        const mood = (m: string, ms: number) => {
          g.dataset.mood = m;
          gsap.delayedCall(ms / 1000, () => {
            if (g.dataset.mood === m) delete g.dataset.mood;
          });
        };

        const boo = () => {
          if (busy) return;
          busy = true;
          void funSfx("boo");
          gsap.delayedCall(0.35, () => void funSfx("giggle"));
          mood("boo", 900);
          bubble.textContent = BOOS[Math.floor(Math.random() * BOOS.length)] ?? "Boo!";
          gsap
            .timeline({
              onComplete: () => {
                // Reappear somewhere else.
                side = Math.random() < 0.5 ? "left" : "right";
                const t = target();
                gsap.set(g, { x: t.x, y: t.y });
                gsap.to(g, { opacity: 0.94, scale: 1, rotation: 0, duration: 0.9, ease: "back.out(2.2)", onComplete: () => void (busy = false) });
              },
            })
            .to(g, { scaleX: 1.3, scaleY: 0.75, duration: 0.09, ease: "power2.out" })
            .to(g, { scaleX: 0.85, scaleY: 1.25, y: "-=26", duration: 0.16, ease: "power2.out" })
            .fromTo(bubble, { opacity: 0, y: 8, scale: 0.6 }, { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: "back.out(3)" }, "<")
            .to(g, { scaleX: 1, scaleY: 1, rotation: 360, duration: 0.55, ease: "back.out(1.6)" })
            .to(bubble, { opacity: 0, y: -10, duration: 0.3 }, "+=0.35")
            .to(g, { scale: 0, opacity: 0, duration: 0.3, ease: "back.in(2)" }, "<")
            .set(g, {}, "+=2.2");
        };
        g.addEventListener("click", boo);
        g.addEventListener("pointerenter", () => {
          if (busy) return;
          mood("happy", 1200);
          gsap.fromTo(svg, { rotation: -10 }, { rotation: 0, duration: 0.6, ease: "elastic.out(1.2, 0.35)", overwrite: "auto" });
        });

        // Protocol moments.
        (g as HTMLElement & { react?: (e: string) => void }).react = (e) => {
          if (busy) return;
          if (e === "transmit") {
            gsap.to(g, { x: W() * 0.9, duration: 1.4, ease: "power2.inOut", yoyo: true, repeat: 1, delay: i * 0.15 });
            void funSfx("whoosh");
          } else if (e === "verified") {
            mood("happy", 1800);
            gsap.fromTo(g, { y: "-=0" }, { y: "-=40", duration: 0.28, ease: "power2.out", yoyo: true, repeat: 1, delay: i * 0.08 });
          } else if (e === "rejected" || e === "replay") {
            mood("scared", 1700);
            gsap.to(g, { opacity: 0.35, scale: 0.8, duration: 0.2, yoyo: true, repeat: 1, repeatDelay: 1.2 });
            gsap.fromTo(svg, { x: -3 }, { x: 3, duration: 0.05, repeat: 15, yoyo: true, clearProps: "x" });
          }
        };
      });
    }, el);

    const look = (e: PointerEvent) => ghosts.forEach((g) => (g as HTMLElement & { look?: (x: number, y: number) => void }).look?.(e.clientX, e.clientY));
    window.addEventListener("pointermove", look, { passive: true });
    const offSpectral = onSpectral((e) => ghosts.forEach((g) => (g as HTMLElement & { react?: (e: string) => void }).react?.(e)));
    return () => {
      window.removeEventListener("pointermove", look);
      offSpectral();
      ctx.revert();
    };
  }, []);

  return (
    <div ref={root} className="ghost-crew haunt-only" aria-hidden>
      {CREW.slice(0, count).map((s, i) => (
        <div key={i} className="ghostling" title="Boo?">
          <span className="boo-bubble" />
          <Ghostling size={s.size} />
        </div>
      ))}
    </div>
  );
}
