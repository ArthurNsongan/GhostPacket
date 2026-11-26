"use client";

// Playful Haunted Mode layer (V5), all GSAP, no markup of its own:
// - every click on a control gets a jelly squish and a fun, never-scary sound
//   (links whoosh, buttons pop, toggles squeak like bats, the main CTA says boo);
// - the primary CTA (.cta-ember) leans magnetically toward the pointer;
// - page titles (main h1.display) rise word by word out of the mist on arrival.
// Clean Field Mode and prefers-reduced-motion turn all of it off; sounds also
// follow the SFX switch and stay silent while the modem runs (ui-sfx).
import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { useEffect } from "react";

import { currentTheme, hauntedMotion, onThemeChange } from "ghostpacket-sdk/theme";
import { funSfx, type FunCue } from "ghostpacket-sdk/ui-sfx";

gsap.registerPlugin(SplitText);

const CONTROL = "button, a[href], [role='tab'], summary, label:has(input[type='checkbox'])";

function cueFor(el: Element): FunCue {
  if (el.classList.contains("cta-ember")) return "boo";
  if (el.getAttribute("role") === "tab" || el.hasAttribute("aria-pressed") || el.matches("label, summary")) return "bat";
  if (el.matches("a[href]")) return "whoosh";
  return Math.random() < 0.18 ? "giggle" : "pop";
}

export default function HauntedFun() {
  useEffect(() => {
    // Sounds: Haunted Mode only (funSfx checks the theme and the SFX switch).
    const onClick = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.(CONTROL);
      if (!el || (el as HTMLButtonElement).disabled) return;
      void funSfx(cueFor(el));
      if (!hauntedMotion()) return;
      gsap.fromTo(el, { scaleX: 1.08, scaleY: 0.9 }, { scaleX: 1, scaleY: 1, duration: 0.55, ease: "elastic.out(1.1, 0.35)", overwrite: "auto", clearProps: "transform" });
    };
    document.addEventListener("click", onClick, true);

    // Magnetic primary CTA.
    const onMove = (e: PointerEvent) => {
      if (!hauntedMotion()) return;
      document.querySelectorAll<HTMLElement>(".cta-ember").forEach((b) => {
        const r = b.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const near = Math.hypot(dx, dy) < Math.max(r.width, 120);
        gsap.to(b, { x: near ? dx * 0.18 : 0, y: near ? dy * 0.28 : 0, duration: 0.5, ease: "power3.out", overwrite: "auto" });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    // Title intro, once per page load. The split is reverted at the end so React
    // always finds its own text nodes again.
    let split: SplitText | null = null;
    const titles = [...document.querySelectorAll<HTMLElement>("main h1.display")];
    if (titles.length && hauntedMotion()) {
      split = new SplitText(titles, { type: "words", wordsClass: "split-word" });
      gsap.from(split.words, {
        yPercent: 70,
        opacity: 0,
        rotationX: -60,
        filter: "blur(10px)",
        duration: 1,
        ease: "power3.out",
        stagger: 0.06,
        transformOrigin: "50% 100% -20px",
        onComplete: () => {
          split?.revert();
          split = null;
        },
      });
    }

    const offTheme = onThemeChange(() => {
      if (currentTheme() !== "haunted") document.querySelectorAll<HTMLElement>(".cta-ember").forEach((b) => gsap.set(b, { clearProps: "transform" }));
    });
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("pointermove", onMove);
      offTheme();
      split?.revert();
    };
  }, []);

  return null;
}
