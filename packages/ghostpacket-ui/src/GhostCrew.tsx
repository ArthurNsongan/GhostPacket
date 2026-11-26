"use client";

// Ghosts (V6): a few spectres that lurk in the page margins. Tall, tattered,
// see-through, with hollow eye sockets, glowing pupils and a wailing mouth.
// GSAP drives everything: slow floating, wandering, apparition flicker, pupils
// that follow the pointer. When the pointer comes close they usually dissolve
// and reappear elsewhere (so they never sit on what you read or click);
// sometimes one stays and stares. Clicking it: it lunges at you with a "Boo."
// and a moan, then vanishes. Protocol moments: transmit → they follow the
// signal, verified → they retreat, rejected / replay → red eyes, they close in.
// Haunted Mode only; nothing runs under prefers-reduced-motion.
import { gsap } from "gsap";
import { useEffect, useId, useRef, useState } from "react";

import { onSpectral } from "ghostpacket-sdk/effects";
import { hauntedMotion, onThemeChange } from "ghostpacket-sdk/theme";
import { funSfx } from "ghostpacket-sdk/ui-sfx";

/** Original spectre drawing: tattered hem, hollow slanted eyes, glowing pupils, wailing mouth. viewBox 100 × 150. */
export function Ghostling({ size = 56 }: { size?: number }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 150" width={size} height={size * 1.5} aria-hidden>
      <defs>
        <linearGradient id={`gb${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="oklch(0.96 0.012 300)" stopOpacity="0.95" />
          <stop offset="0.55" stopColor="oklch(0.88 0.03 300)" stopOpacity="0.7" />
          <stop offset="1" stopColor="oklch(0.8 0.05 300)" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={`gm${id}`} cx="0.5" cy="0.35" r="0.7">
          <stop offset="0" stopColor="oklch(0.05 0.02 300)" />
          <stop offset="1" stopColor="oklch(0.2 0.05 300)" />
        </radialGradient>
      </defs>
      <path
        className="g-body"
        fill={`url(#gb${id})`}
        d="M50 4C25 4 13 26 13 54v40l-4 22 10-12 1 30 9-24 6 34 8-30 7 30 7-30 8 34 6-34 9 24 1-30 10 12-4-22V54C87 26 75 4 50 4z"
      />
      <path className="g-eye" d="M27 49q9-9 19 2-3 12-12 11-8-2-7-13z" />
      <path className="g-eye" d="M73 49q-9-9-19 2 3 12 12 11 8-2 7-13z" />
      <g className="g-pupils">
        <circle className="g-pupil" cx="37" cy="54" r="2.6" />
        <circle className="g-pupil" cx="63" cy="54" r="2.6" />
      </g>
      <ellipse className="g-mouth" fill={`url(#gm${id})`} cx="50" cy="84" rx="7" ry="12" />
    </svg>
  );
}

const WHISPERS = ["Boo.", "Leave…", "I see you", "Shhh…", "Not alone", "BOO!"];

interface Spec {
  size: number;
  side: "left" | "right";
}

const CREW: Spec[] = [
  { size: 60, side: "left" },
  { size: 72, side: "right" },
  { size: 48, side: "right" },
];
const REST = 0.78;

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

type GhostEl = HTMLElement & { look?: (x: number, y: number) => void; react?: (e: string) => void };

function Crew() {
  const root = useRef<HTMLDivElement>(null);
  const [count] = useState(() => (typeof window !== "undefined" && window.innerWidth < 768 ? 1 : CREW.length));

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ghosts = [...el.querySelectorAll<GhostEl>(".ghostling")];
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const rand = gsap.utils.random;

    const ctx = gsap.context(() => {
      ghosts.forEach((g, i) => {
        const spec = CREW[i] ?? CREW[0]!;
        const svg = g.querySelector("svg")!;
        const pupils = g.querySelector<SVGGElement>(".g-pupils")!;
        const whisper = g.querySelector<HTMLElement>(".boo-whisper")!;
        let side = spec.side;
        let busy = false;

        // Wandering stays in the gutters on wide screens, low corners on phones.
        const target = () => {
          const w = W();
          const h = H();
          const narrow = w < 768;
          const xs = narrow ? [0.04 * w, 0.22 * w] : side === "left" ? [0.01 * w, 0.1 * w] : [0.88 * w, 0.97 * w - spec.size];
          const ys = narrow ? [0.62 * h, 0.8 * h] : [0.18 * h, 0.78 * h];
          // Prefer a spot that does not cover a control.
          let p = { x: 0, y: 0 };
          for (let k = 0; k < 8; k++) {
            p = { x: rand(xs[0]!, xs[1]!), y: rand(ys[0]!, ys[1]!) };
            const hit = document
              .elementsFromPoint(p.x + spec.size / 2, p.y + spec.size * 0.75)
              .some((n) => !g.contains(n) && n.closest?.("a[href], button, input, select, textarea, [role='tab'], label"));
            if (!hit) break;
          }
          return p;
        };
        const appear = (delay = 0) => {
          const t = target();
          gsap.set(g, { x: t.x, y: t.y, scale: 0.9, rotation: 0 });
          return gsap.fromTo(g, { opacity: 0, filter: "blur(8px)" }, { opacity: REST, filter: "blur(0px)", scale: 1, duration: 1.6, delay, ease: "power2.out" });
        };
        appear(0.8 + i * 0.9);

        // Slow, heavy floating; the hem flutters.
        gsap.to(svg, { y: -14, duration: rand(2.4, 3.4), ease: "sine.inOut", yoyo: true, repeat: -1 });
        gsap.to(svg, { rotation: rand(-5, -2), duration: rand(3, 4.2), ease: "sine.inOut", yoyo: true, repeat: -1, transformOrigin: "50% 30%" });
        gsap.to(svg, { scaleY: 1.04, scaleX: 0.97, duration: 1.3, ease: "sine.inOut", yoyo: true, repeat: -1, transformOrigin: "50% 0%" });

        const wander = () => {
          if (!busy) {
            const t = target();
            gsap.to(g, { x: t.x, y: t.y, duration: rand(7, 11), ease: "sine.inOut" });
          }
          gsap.delayedCall(rand(8, 13), wander);
        };
        gsap.delayedCall(rand(3, 6), wander);

        // Apparition flicker.
        const flicker = () => {
          if (!busy) {
            gsap
              .timeline()
              .to(g, { opacity: 0.15, duration: 0.05 })
              .to(g, { opacity: REST, x: "+=3", duration: 0.05 })
              .to(g, { opacity: 0.05, duration: 0.07 })
              .to(g, { opacity: REST, x: "-=3", duration: 0.12 });
          }
          gsap.delayedCall(rand(4, 9), flicker);
        };
        gsap.delayedCall(rand(3, 7), flicker);

        const mood = (m: string, ms: number) => {
          g.dataset.mood = m;
          gsap.delayedCall(ms / 1000, () => {
            if (g.dataset.mood === m) delete g.dataset.mood;
          });
        };

        const vanish = (then = 1.4) => {
          busy = true;
          gsap.to(g, {
            opacity: 0,
            scale: 1.15,
            y: "-=24",
            filter: "blur(8px)",
            duration: 0.45,
            ease: "power2.in",
            overwrite: "auto",
            onComplete: () => {
              side = Math.random() < 0.5 ? "left" : "right";
              appear(then).eventCallback("onComplete", () => void (busy = false));
            },
          });
        };

        // Pupils follow the pointer; up close it dissolves, or stays and stares.
        const px = gsap.quickTo(pupils, "x", { duration: 0.5, ease: "power3.out" });
        const py = gsap.quickTo(pupils, "y", { duration: 0.5, ease: "power3.out" });
        let nearUntil = 0;
        g.look = (x, y) => {
          const r = g.getBoundingClientRect();
          const dx = x - (r.left + r.width / 2);
          const dy = y - (r.top + r.height * 0.35);
          const d = Math.hypot(dx, dy) || 1;
          px((dx / d) * 3);
          py((dy / d) * 2.4);
          const now = performance.now();
          if (busy || d > spec.size + 80 || now < nearUntil) return;
          nearUntil = now + 2000;
          // Over a control, it always gets out of the way; elsewhere it may stay and stare.
          const overControl = document
            .elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            .some((n) => !g.contains(n) && n.closest?.("a[href], button, input, select, textarea, [role='tab'], label"));
          if (!overControl && Math.random() < 0.3) {
            mood("stare", 1800);
            return;
          }
          void funSfx("whisper");
          vanish();
        };

        const boo = () => {
          if (busy) return;
          busy = true;
          void funSfx("boo");
          gsap.delayedCall(0.55, () => void funSfx("giggle"));
          mood("boo", 1200);
          whisper.textContent = WHISPERS[Math.floor(Math.random() * WHISPERS.length)] ?? "Boo.";
          gsap
            .timeline({
              onComplete: () => {
                delete g.dataset.mood;
                side = Math.random() < 0.5 ? "left" : "right";
                appear(2.2).eventCallback("onComplete", () => void (busy = false));
              },
            })
            .to(g, { scale: 0.85, y: "+=8", duration: 0.14, ease: "power2.out" })
            .to(g, { scale: 2.3, opacity: 1, duration: 0.32, ease: "power4.in" })
            .fromTo(whisper, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: "back.out(2)" }, "<")
            .to(g, { opacity: 0, filter: "blur(10px)", duration: 0.35, ease: "power1.out" })
            .to(whisper, { opacity: 0, y: -14, duration: 0.6 }, "<+0.2");
        };
        g.addEventListener("click", boo);

        // Protocol moments.
        g.react = (e) => {
          if (busy) return;
          if (e === "transmit") {
            gsap.to(g, { x: W() * 0.88, duration: 1.6, ease: "power2.inOut", yoyo: true, repeat: 1, delay: i * 0.2 });
          } else if (e === "verified") {
            gsap.to(g, { opacity: 0.22, duration: 0.5, yoyo: true, repeat: 1, repeatDelay: 1.2 });
          } else if (e === "rejected" || e === "replay") {
            mood("angry", 1800);
            const cx = W() / 2 - Number(gsap.getProperty(g, "x"));
            gsap.to(g, { x: `+=${Math.sign(cx) * 60}`, opacity: 0.95, duration: 0.5, yoyo: true, repeat: 1, repeatDelay: 1, ease: "power2.out" });
            gsap.fromTo(svg, { x: -2 }, { x: 2, duration: 0.04, repeat: 20, yoyo: true, clearProps: "x" });
          }
        };
      });
    }, el);

    const look = (e: PointerEvent) => ghosts.forEach((g) => g.look?.(e.clientX, e.clientY));
    window.addEventListener("pointermove", look, { passive: true });
    const offSpectral = onSpectral((e) => ghosts.forEach((g) => g.react?.(e)));
    return () => {
      window.removeEventListener("pointermove", look);
      offSpectral();
      ctx.revert();
    };
  }, []);

  return (
    <div ref={root} className="ghost-crew haunt-only" aria-hidden>
      {CREW.slice(0, count).map((s, i) => (
        <div key={i} className="ghostling">
          <span className="boo-whisper" />
          <Ghostling size={s.size} />
        </div>
      ))}
    </div>
  );
}
