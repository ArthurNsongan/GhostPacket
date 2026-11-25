// Live theme palette for Canvas 2D drawings (spectrogram, fountain grid, Ether Conduit…).
// Canvas cannot read CSS variables, so the theme tokens (--color-*) are resolved to RGB once
// and again after every theme switch. Draw loops read `PAL` each frame: no React state involved.
import { onThemeChange } from "ghostpacket-sdk/theme";

export type RGB = [number, number, number];

const KEYS = ["void", "panel-2", "ink", "mute", "phosphor", "ion", "alarm", "accent"] as const;
type Key = (typeof KEYS)[number];

/** Haunted palette, used before the first read (and during server rendering). */
export const PAL: Record<Key, RGB> = {
  void: [18, 14, 22],
  "panel-2": [33, 27, 39],
  ink: [241, 235, 225],
  mute: [134, 127, 142],
  phosphor: [122, 224, 196],
  ion: [200, 195, 214],
  alarm: [212, 66, 94],
  accent: [240, 162, 74],
};

let probe: CanvasRenderingContext2D | null = null;

/** Any CSS colour (oklch, hex, rgb…) → sRGB bytes, through a 1×1 canvas. */
function resolve(css: string, fallback: RGB): RGB {
  if (!css) return fallback;
  if (!probe) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    probe = c.getContext("2d", { willReadFrequently: true });
  }
  if (!probe) return fallback;
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = "#000";
  probe.fillStyle = css;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [d[0] ?? fallback[0], d[1] ?? fallback[1], d[2] ?? fallback[2]];
}

export function refreshPalette(): void {
  if (typeof document === "undefined") return;
  const cs = getComputedStyle(document.documentElement);
  for (const k of KEYS) PAL[k] = resolve(cs.getPropertyValue(`--color-${k}`).trim(), PAL[k]);
}

let watching = false;

/** Reads the palette now and after each theme change. Idempotent; call from an effect. */
export function watchPalette(): void {
  if (watching || typeof window === "undefined") return;
  watching = true;
  refreshPalette();
  // The theme attribute is set synchronously; wait one frame so styles are recomputed.
  onThemeChange(() => requestAnimationFrame(refreshPalette));
}

export const rgba = (c: RGB, a = 1): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const mix = (a: RGB, b: RGB, t: number): RGB => [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
