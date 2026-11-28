#!/usr/bin/env node
// Step 3: editing. Speeds up long clips, pads each one to its narration, lays
// the voice-over (lead-in 0.35 s), adds short fades between scenes, writes the
// subtitles, and encodes:
//   out/ghostpacket-demo.mp4            H.264 + AAC, soft subtitles (mov_text)
//   out/ghostpacket-demo-subtitled.mp4  subtitles burned in (for platforms without captions)
//   out/ghostpacket-demo.srt            captions file for YouTube / Devpost
//   node video/assemble.mjs [--only …] [--no-burn]
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { activeScenes, arg, ensure, footageOf, LEAD_IN, OUT, TAIL, voiceOf, WORK } from "./lib/paths.mjs";
import { ffmpeg, FPS, hasAudio, probeSeconds } from "./lib/recorder.mjs";

const out = ensure(OUT);
const segDir = ensure(join(WORK, "segments"));
const FADE = 0.25;
const segments = [];
const srt = [];
let clock = 0;

const stamp = (t) => {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/**
 * Captions of at most ~44 characters, cut at sentence ends first, then at
 * commas or colons, timed by character count (closer to speech than words).
 */
function captions(text, start, length) {
  const MAX = 44;
  const chunks = [];
  for (const sentence of text.match(/[^.!?]+[.!?]*/g) ?? [text]) {
    let rest = sentence.trim();
    while (rest.length > MAX) {
      const window = rest.slice(0, MAX + 1);
      const soft = Math.max(window.lastIndexOf(", "), window.lastIndexOf(": "));
      // A sentence just over the limit is cut near its middle, never leaving a one-word tail.
      const middle = rest.length <= MAX + 16 ? rest.lastIndexOf(" ", Math.ceil(rest.length / 2) + 4) : -1;
      const cut = soft > MAX / 2 ? soft + 1 : middle > 0 ? middle : window.lastIndexOf(" ");
      chunks.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) chunks.push(rest);
  }
  const chars = chunks.reduce((n, c) => n + c.length, 0);
  let t = start;
  for (const c of chunks) {
    const d = (length * c.length) / chars;
    srt.push(`${srt.length + 1}\n${stamp(t)} --> ${stamp(t + d)}\n${c}\n`);
    t += d;
  }
}

for (const s of activeScenes(arg("only"))) {
  const voice = voiceOf(s);
  if (!existsSync(voice)) throw new Error(`${s.id}: narration missing, run node video/narrate.mjs`);
  const vsec = probeSeconds(voice);
  const footage = footageOf(s);
  const clip = footage ?? join(WORK, "clips", `${s.id}.mp4`);
  if (!existsSync(clip)) throw new Error(`${s.id}: clip missing, run node video/capture.mjs`);
  const speed = footage ? 1 : (s.speed ?? 1);
  // Footage is cut to the scene budget (maxSeconds), recordings are used whole.
  const csec = Math.min(probeSeconds(clip) / speed, footage ? (s.maxSeconds ?? 12) : Infinity);
  const length = Math.max(csec, LEAD_IN + vsec + TAIL);
  const seg = join(segDir, `${s.id}.mp4`);
  const v = [
    `[0:v]setpts=PTS/${speed}`,
    `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x1a1420`,
    `fps=${FPS}`,
    `tpad=stop_mode=clone:stop_duration=${Math.max(0, length - csec + 0.1).toFixed(3)}`,
    `trim=duration=${length.toFixed(3)}`,
    `fade=t=in:st=0:d=${FADE}`,
    `fade=t=out:st=${(length - FADE).toFixed(3)}:d=${FADE}`,
    "format=yuv420p[v]",
  ].join(",");
  // Footage keeps its own sound (the modem chirps), ducked under the narration.
  const delay = `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${Math.round(LEAD_IN * 1000)}:all=1`;
  const end = `apad,atrim=duration=${length.toFixed(3)}[a]`;
  const a =
    footage && hasAudio(footage)
      ? `${delay}[n];[0:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.25[f];[n][f]amix=inputs=2:duration=longest:normalize=0,${end}`
      : `${delay},${end}`;
  ffmpeg([
    "-i",
    clip,
    "-i",
    voice,
    "-filter_complex",
    `${v};${a}`,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-ar",
    "48000",
    "-ac",
    "2",
    seg,
  ]);
  captions(s.narration, clock + LEAD_IN, vsec);
  segments.push(seg);
  console.log(`${s.id}: ${length.toFixed(1)} s (clip ${csec.toFixed(1)} s${speed !== 1 ? ` at ×${speed}` : ""}, voice ${vsec.toFixed(1)} s)${footage ? " · footage" : ""}`);
  clock += length;
}

const list = join(segDir, "segments.ffconcat");
writeFileSync(list, ["ffconcat version 1.0", ...segments.map((f) => `file '${f.replace(/\\/g, "/")}'`)].join("\n"));
const srtFile = join(out, "ghostpacket-demo.srt");
writeFileSync(srtFile, srt.join("\n"));
const main = join(out, "ghostpacket-demo.mp4");
// Loudness normalized for YouTube (-14 LUFS), soft English captions.
ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-i", srtFile, "-map", "0:v", "-map", "0:a", "-map", "1:0", "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "160k", "-c:s", "mov_text", "-metadata:s:s:0", "language=eng", "-movflags", "+faststart", main]);
const total = probeSeconds(main);
console.log(`\n${main}: ${total.toFixed(1)} s (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")})${total > 180 ? "  ⚠ over 3:00, judges may stop watching" : ""}`);
if (arg("no-burn") !== true) {
  const burned = join(out, "ghostpacket-demo-subtitled.mp4");
  const style = "FontName=Arial,FontSize=13,PrimaryColour=&H00E6EFF4,OutlineColour=&H80120D18,BorderStyle=1,Outline=1.2,Shadow=0,MarginV=36";
  const escaped = srtFile.replace(/\\/g, "/").replace(":", "\\:");
  ffmpeg(["-i", main, "-vf", `subtitles='${escaped}':force_style='${style}'`, "-map", "0:v", "-map", "0:a", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-c:a", "copy", "-movflags", "+faststart", burned]);
  console.log(`${burned}: subtitles burned in`);
}
console.log(`${srtFile}: ${srt.length} captions`);
