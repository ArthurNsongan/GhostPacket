// Haunted / Clean Field theme state, framework-free.
// The theme is applied as `data-theme` on <html>; each app sets `data-app`.
// Apps add an inline script (themeBootScript) to apply it before first paint.
import { prefs } from "./storage";

export type Theme = "haunted" | "clean";
export type AppId = "portal" | "clinic" | "tontine";

// Haunted is the default. V6 starts everyone in Haunted once (new key); the
// choice is remembered again from there.
const KEY = "ghostpacket.theme.v6";
const listeners = new Set<(t: Theme) => void>();

export function currentTheme(): Theme {
  if (typeof document !== "undefined") {
    const t = document.documentElement.dataset.theme;
    if (t === "haunted" || t === "clean") return t;
  }
  try {
    return prefs().getItem(KEY) === "clean" ? "clean" : "haunted";
  } catch {
    return "haunted";
  }
}

export function setTheme(t: Theme): void {
  try {
    prefs().setItem(KEY, t);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") document.documentElement.dataset.theme = t;
  listeners.forEach((l) => l(t));
}

export function onThemeChange(fn: (t: Theme) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** True when decorative motion should run: Haunted Mode and no reduced-motion preference. */
export function hauntedMotion(): boolean {
  if (currentTheme() !== "haunted") return false;
  return typeof matchMedia === "undefined" || !matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Inline script for <head>: applies the stored theme before first paint (no flash). */
export function themeBootScript(app: AppId): string {
  return `(function(){try{var t=localStorage.getItem(${JSON.stringify(KEY)});var d=document.documentElement;d.dataset.app=${JSON.stringify(app)};d.dataset.theme=t==="clean"?"clean":"haunted";}catch(e){document.documentElement.dataset.theme="haunted";}})();`;
}
