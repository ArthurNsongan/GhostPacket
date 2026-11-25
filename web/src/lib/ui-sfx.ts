// Optional UI sound effects, synthesized with Web Audio (no audio files).
// Off by default. Never played during a real microphone capture.
import { audioContext } from "./audio-engine";

const KEY = "ghostpacket.sfx";
let enabled = typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "on";
let muted = false;
const listeners = new Set<(on: boolean) => void>();

export function sfxEnabled(): boolean {
  return enabled;
}

export function setSfx(on: boolean): void {
  enabled = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(on));
}

export function onSfxChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Silences effects while the microphone listens, so they cannot jam the modem. */
export function muteSfx(on: boolean): void {
  muted = on;
}

type Cue = "tap" | "verified" | "rejected" | "droplet" | "lock";

const CUES: Record<Cue, { f: number[]; dur: number; type: OscillatorType; gain: number }> = {
  tap: { f: [880], dur: 0.05, type: "triangle", gain: 0.05 },
  droplet: { f: [1320], dur: 0.03, type: "sine", gain: 0.025 },
  lock: { f: [660, 990], dur: 0.12, type: "sine", gain: 0.05 },
  verified: { f: [523.25, 659.25, 783.99], dur: 0.32, type: "sine", gain: 0.06 },
  rejected: { f: [110, 116.5], dur: 0.35, type: "sawtooth", gain: 0.04 },
};

export async function sfx(cue: Cue): Promise<void> {
  if (!enabled || muted) return;
  try {
    const ctx = await audioContext();
    const c = CUES[cue];
    const t0 = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(c.gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + c.dur);
    g.connect(ctx.destination);
    c.f.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = c.type;
      o.frequency.value = f;
      o.connect(g);
      const start = t0 + (cue === "verified" ? i * 0.06 : 0);
      o.start(start);
      o.stop(start + c.dur);
    });
  } catch {
    /* audio unavailable: effects are optional */
  }
}
