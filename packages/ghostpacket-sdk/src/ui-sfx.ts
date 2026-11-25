// Optional sound effects and crypt ambience, synthesized with Web Audio
// (no audio file, no network). Off by default.
// - Haunted Mode plays the spooky cues of HALLOWEEN_REDESIGN_PLAN.md §4;
//   Clean Field Mode plays short neutral tones.
// - Always silent while the real modem plays a burst or the microphone listens
//   (modem-activity), so effects can never jam a physical transfer.
import { audioContext } from "./audio-engine";
import { isModemBusy, onModemActivity } from "./modem-activity";
import { prefs } from "./storage";
import { currentTheme } from "./theme";

const KEY = "ghostpacket.sfx";
const AMBIENCE_KEY = "ghostpacket.ambience";

function stored(key: string): boolean {
  try {
    return prefs().getItem(key) === "on";
  } catch {
    return false;
  }
}

function store(key: string, on: boolean): void {
  try {
    prefs().setItem(key, on ? "on" : "off");
  } catch {
    /* ignore */
  }
}

let enabled = stored(KEY);
let ambienceOn = stored(AMBIENCE_KEY);
let manualMute = false;
const listeners = new Set<(on: boolean) => void>();
const ambienceListeners = new Set<(on: boolean) => void>();

export function sfxEnabled(): boolean {
  return enabled;
}

export function setSfx(on: boolean): void {
  enabled = on;
  store(KEY, on);
  listeners.forEach((l) => l(on));
}

export function onSfxChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Extra manual mute (kept for callers of V2); the modem mutes effects on its own. */
export function muteSfx(on: boolean): void {
  manualMute = on;
  if (master) duck(master.context, master, silent());
  void updateAmbience();
}

function silent(): boolean {
  return manualMute || isModemBusy();
}

export type Cue = "tap" | "summon" | "lock" | "droplet" | "drop" | "verified" | "rejected" | "replay" | "synced";

// ---- Building blocks -------------------------------------------------------

function env(ctx: AudioContext, t0: number, peak: number, attack: number, dur: number, dest: AudioNode): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(dest);
  return g;
}

function tone(ctx: AudioContext, dest: AudioNode, f: number, t0: number, dur: number, peak: number, type: OscillatorType = "sine", attack = 0.01): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t0);
  o.connect(env(ctx, t0, peak, attack, dur, dest));
  o.start(t0);
  o.stop(t0 + dur + 0.05);
  return o;
}

let noiseBuffer: AudioBuffer | null = null;
/** 2 s of pink-ish noise, generated once (Paul Kellet's economy filter). */
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.11;
  }
  noiseBuffer = b;
  return b;
}

function burst(ctx: AudioContext, dest: AudioNode, t0: number, dur: number, peak: number, filter: BiquadFilterType, freq: number, q = 1): BiquadFilterNode {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const f = ctx.createBiquadFilter();
  f.type = filter;
  f.frequency.setValueAtTime(freq, t0);
  f.Q.value = q;
  src.connect(f);
  f.connect(env(ctx, t0, peak, 0.005, dur, dest));
  src.start(t0);
  src.stop(t0 + dur + 0.05);
  return f;
}

function bell(ctx: AudioContext, dest: AudioNode, f: number, t0: number, dur: number, peak: number): void {
  // Inharmonic partials of a struck bell.
  [1, 2.0, 2.76, 5.4].forEach((r, i) => tone(ctx, dest, f * r, t0, dur / (1 + i * 0.6), peak / (1 + i * 1.5), "sine", 0.003));
}

// ---- Cues ------------------------------------------------------------------

const CLEAN: Record<Cue, (ctx: AudioContext, out: AudioNode, t: number) => void> = {
  tap: (c, o, t) => void tone(c, o, 880, t, 0.05, 0.05, "triangle"),
  summon: (c, o, t) => [440, 660].forEach((f, i) => tone(c, o, f, t + i * 0.08, 0.12, 0.04)),
  lock: (c, o, t) => [660, 990].forEach((f) => tone(c, o, f, t, 0.12, 0.04)),
  droplet: (c, o, t) => void tone(c, o, 1320, t, 0.03, 0.02),
  drop: (c, o, t) => void tone(c, o, 330, t, 0.04, 0.015, "triangle"),
  verified: (c, o, t) => [523.25, 659.25, 783.99].forEach((f, i) => tone(c, o, f, t + i * 0.06, 0.32, 0.05)),
  rejected: (c, o, t) => [110, 116.5].forEach((f) => tone(c, o, f, t, 0.35, 0.035, "sawtooth")),
  replay: (c, o, t) => [392, 392].forEach((f, i) => tone(c, o, f, t + i * 0.22, 0.18, 0.04, "triangle")),
  synced: (c, o, t) => [523.25, 783.99].forEach((f, i) => tone(c, o, f, t + i * 0.08, 0.2, 0.04)),
};

const HAUNTED: Record<Cue, (ctx: AudioContext, out: AudioNode, t: number) => void> = {
  tap: (c, o, t) => void tone(c, o, 740, t, 0.06, 0.04, "triangle"),
  // Theremin glide with vibrato and a short echo, plus a filtered bat-wing whoosh.
  summon: (c, o, t) => {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(310, t);
    osc.frequency.exponentialRampToValueAtTime(620, t + 0.9);
    const lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.value = 6.2;
    depth.gain.value = 9;
    lfo.connect(depth).connect(osc.frequency);
    const g = env(c, t, 0.05, 0.12, 1.2, o);
    const delay = c.createDelay(1);
    delay.delayTime.value = 0.22;
    const fb = c.createGain();
    fb.gain.value = 0.35;
    osc.connect(g);
    g.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(o);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 1.3);
    lfo.stop(t + 1.3);
    const f = burst(c, o, t + 0.05, 0.45, 0.03, "bandpass", 500, 0.8);
    f.frequency.exponentialRampToValueAtTime(2400, t + 0.45);
  },
  // Midnight clock strike: FM-ish metallic bell.
  lock: (c, o, t) => bell(c, o, 880, t, 0.9, 0.04),
  droplet: (c, o, t) => void tone(c, o, 1560, t, 0.025, 0.012),
  // A spark lost in the ether.
  drop: (c, o, t) => void burst(c, o, t, 0.025, 0.04, "bandpass", 2400, 6),
  // Gothic organ fifth + wax-seal thump.
  verified: (c, o, t) => {
    [130.81, 196.0, 261.63].forEach((f) => {
      tone(c, o, f, t, 1.1, 0.03, "sine", 0.08);
      tone(c, o, f * 2, t, 1.0, 0.012, "sine", 0.08);
      tone(c, o, f * 3, t, 0.9, 0.006, "sine", 0.08);
    });
    const th = c.createOscillator();
    th.frequency.setValueAtTime(140, t);
    th.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    th.connect(env(c, t, 0.09, 0.004, 0.16, o));
    th.start(t);
    th.stop(t + 0.2);
  },
  // Diabolus in musica (tritone) + 42 Hz rolling thunder.
  rejected: (c, o, t) => {
    [233.08, 329.63].forEach((f) => tone(c, o, f, t, 0.9, 0.03, "sawtooth", 0.02));
    tone(c, o, 42, t, 1.1, 0.08, "sine", 0.05);
    burst(c, o, t, 1.1, 0.06, "lowpass", 160, 0.7);
  },
  // Double low funeral bell toll.
  replay: (c, o, t) => {
    bell(c, o, 146, t, 1.4, 0.06);
    bell(c, o, 146, t + 0.7, 1.4, 0.06);
  },
  // Soft ascending ethereal arpeggio.
  synced: (c, o, t) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, f, t + i * 0.09, 0.6, 0.025, "sine", 0.03)),
};

// Every cue goes through one master gain, cut to silence the instant the modem
// starts, so even a cue already scheduled (echo tails) cannot reach the microphone.
let master: GainNode | null = null;

function masterFor(ctx: AudioContext): GainNode {
  if (!master || master.context !== ctx) {
    master = ctx.createGain();
    master.gain.value = silent() ? 0 : 1;
    master.connect(ctx.destination);
  }
  return master;
}

function duck(ctx: BaseAudioContext, g: GainNode, on: boolean): void {
  const now = ctx.currentTime;
  g.gain.cancelScheduledValues(now);
  g.gain.setValueAtTime(on ? 0 : 1, now);
}

export async function sfx(cue: Cue): Promise<void> {
  if (!enabled || silent()) return;
  try {
    const ctx = await audioContext();
    // The modem may have started while the context resumed.
    if (silent()) return;
    const out = ctx.createGain();
    out.gain.value = 0.9;
    out.connect(masterFor(ctx));
    (currentTheme() === "haunted" ? HAUNTED : CLEAN)[cue](ctx, out, ctx.currentTime + 0.01);
    setTimeout(() => out.disconnect(), 3000);
  } catch {
    /* audio unavailable: effects are optional */
  }
}

// ---- Crypt ambience (-28 dB drone + night wind) ------------------------------

let amb: { gain: GainNode; stop: () => void } | null = null;
let ambStarting: Promise<void> | null = null;

export function ambienceEnabled(): boolean {
  return ambienceOn;
}

export function onAmbienceChange(fn: (on: boolean) => void): () => void {
  ambienceListeners.add(fn);
  return () => ambienceListeners.delete(fn);
}

/** Needs a user gesture the first time (AudioContext policy). */
export function setAmbience(on: boolean): void {
  ambienceOn = on;
  store(AMBIENCE_KEY, on);
  ambienceListeners.forEach((l) => l(on));
  void updateAmbience();
}

function startAmbience(): Promise<void> {
  if (amb) return Promise.resolve();
  // One graph only, even if several updates race.
  ambStarting ??= buildAmbience().finally(() => {
    ambStarting = null;
  });
  return ambStarting;
}

async function buildAmbience(): Promise<void> {
  const ctx = await audioContext();
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  gain.connect(ctx.destination);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 220;
  lp.connect(gain);
  const drones = [55, 55.6].map((f) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    o.connect(lp);
    o.start();
    return o;
  });
  const wind = ctx.createBufferSource();
  wind.buffer = noise(ctx);
  wind.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.9;
  bp.frequency.value = 600;
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  lfo.frequency.value = 0.07;
  depth.gain.value = 380;
  lfo.connect(depth).connect(bp.frequency);
  const windGain = ctx.createGain();
  windGain.gain.value = 0.5;
  wind.connect(bp).connect(windGain).connect(gain);
  wind.start();
  lfo.start();
  amb = {
    gain,
    stop: () => {
      drones.forEach((o) => o.stop());
      wind.stop();
      lfo.stop();
      gain.disconnect();
    },
  };
}

const wantAmbience = () => ambienceOn && !silent() && currentTheme() === "haunted";

async function updateAmbience(): Promise<void> {
  try {
    if (wantAmbience()) await startAmbience();
    if (!amb) return;
    // Re-read after the awaits: the modem may have started meanwhile.
    const want = wantAmbience();
    if (!ambienceOn) {
      amb.stop();
      amb = null;
      return;
    }
    const ctx = amb.gain.context;
    if (!want) duck(ctx, amb.gain, true);
    // −28 dB ≈ 0.04 linear.
    else amb.gain.gain.setTargetAtTime(0.04, ctx.currentTime, 0.8);
  } catch {
    /* audio unavailable */
  }
}

/** Re-evaluates the ambience after a theme change. */
export function refreshAmbience(): void {
  void updateAmbience();
}

onModemActivity((busy) => {
  if (master) duck(master.context, master, busy || manualMute);
  void updateAmbience();
});
