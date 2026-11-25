// Small shared visual effects: the Blood Moon alert and a signal-level bus
// that drives the audio-reactive header sigil.

let bloodTimer: number | null = null;

/** Lightning flash, then the mist and moon turn crimson for 1.6 s after a rejection. */
export function bloodMoon(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove("blood-moon");
  // Force a reflow so the animation restarts on repeated rejections.
  void root.offsetWidth;
  root.classList.add("blood-moon");
  if (bloodTimer !== null) window.clearTimeout(bloodTimer);
  bloodTimer = window.setTimeout(() => root.classList.remove("blood-moon"), 1600);
}

export type SpectralEvent = "transmit" | "verified" | "rejected" | "replay" | "drop" | "synced";
const eventListeners = new Set<(e: SpectralEvent) => void>();

/** Broadcasts a protocol moment to decorative layers (lantern, bats). Never carries document data. */
export function spectral(e: SpectralEvent): void {
  eventListeners.forEach((l) => l(e));
}

export function onSpectral(fn: (e: SpectralEvent) => void): () => void {
  eventListeners.add(fn);
  return () => eventListeners.delete(fn);
}

const levelListeners = new Set<(rms: number) => void>();

/** Publishes the RMS level of the latest audio window (0..1). */
export function emitLevel(window: Float32Array): void {
  if (levelListeners.size === 0 || window.length === 0) return;
  let sum = 0;
  for (const x of window) sum += x * x;
  const rms = Math.sqrt(sum / window.length);
  levelListeners.forEach((l) => l(rms));
}

export function onLevel(fn: (rms: number) => void): () => void {
  levelListeners.add(fn);
  return () => levelListeners.delete(fn);
}
