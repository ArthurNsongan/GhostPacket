// Shared paths and scene selection for the video pipeline.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scenes } from "../scenes.mjs";

export const VIDEO = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = join(VIDEO, "..");
export const WORK = join(VIDEO, "work");
export const OUT = join(VIDEO, "out");
export const FOOTAGE = join(VIDEO, "footage");
export const VOICE_OVERRIDE = join(VIDEO, "voice");
export const LEAD_IN = 0.35; // seconds of picture before the narration starts
export const TAIL = 0.6; // seconds of picture after the narration ends

export function ensure(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Footage file of an optional scene, if the team dropped it in video/footage/. */
export function footageOf(scene) {
  if (!scene.optional) return null;
  const f = join(FOOTAGE, scene.optional);
  return existsSync(f) ? f : null;
}

/** Scenes that will appear: optional scenes without footage and without a card fallback are skipped. */
export function activeScenes(only) {
  const ids = only ? new Set(only.split(",")) : null;
  return scenes.filter((s) => (!ids || ids.has(s.id)) && !(s.optional && !footageOf(s) && !s.card));
}

/** Narration file: a real recording in video/voice/ wins over the TTS placeholder. */
export function voiceOf(scene) {
  const own = join(VOICE_OVERRIDE, `${scene.id}.wav`);
  return existsSync(own) ? own : join(WORK, "voice", `${scene.id}.wav`);
}

export function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
