// Counts real acoustic modem activity (speaker bursts and microphone captures).
// Sound effects subscribe to it and stay silent while the count is above zero,
// so they can never jam a physical transfer. Kept separate from audio-engine
// and ui-sfx to avoid an import cycle.
let active = 0;
const listeners = new Set<(busy: boolean) => void>();

/** Marks the start of a real speaker burst or microphone capture; returns the matching release. */
export function modemBusy(): () => void {
  active++;
  if (active === 1) listeners.forEach((l) => l(true));
  let released = false;
  return () => {
    if (released) return;
    released = true;
    active = Math.max(0, active - 1);
    if (active === 0) listeners.forEach((l) => l(false));
  };
}

export function isModemBusy(): boolean {
  return active > 0;
}

export function onModemActivity(fn: (busy: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
