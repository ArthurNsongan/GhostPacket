#!/usr/bin/env node
// Step 1: narration. Writes work/voice/<scene>.wav with the offline Windows voice
// (placeholder), unless video/voice/<scene>.wav (a real recording) exists, and
// prints every duration and the total.
//   node video/narrate.mjs [--only 03-one-click,04-clinic] [--voice "Microsoft David Desktop"] [--rate 2]
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { activeScenes, arg, ensure, LEAD_IN, TAIL, VIDEO, voiceOf, WORK } from "./lib/paths.mjs";
import { probeSeconds } from "./lib/recorder.mjs";

const voice = arg("voice", "Microsoft Zira Desktop");
const rate = Number(arg("rate", "2"));
const dir = ensure(join(WORK, "voice"));
const durations = {};
let total = 0;
for (const s of activeScenes(arg("only"))) {
  const out = voiceOf(s);
  if (!out.startsWith(dir) && existsSync(out)) {
    console.log(`${s.id}: own recording ${out}`);
  } else {
    const txt = join(dir, `${s.id}.txt`);
    writeFileSync(txt, s.narration, "utf8");
    const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(VIDEO, "lib", "tts.ps1"), "-TextFile", txt, "-Out", out, "-Voice", voice, "-Rate", String(rate)], { stdio: "inherit" });
    if (r.status !== 0) throw new Error(`TTS failed for ${s.id}`);
  }
  const sec = probeSeconds(out);
  durations[s.id] = sec;
  total += sec + LEAD_IN + TAIL;
  console.log(`${s.id}: ${sec.toFixed(1)} s · ${s.narration.split(/\s+/).length} words`);
}
writeFileSync(join(dir, "durations.json"), JSON.stringify(durations, null, 2));
console.log(`narration + lead/tail: ${total.toFixed(1)} s (${(total / 60).toFixed(2)} min) · budget 180 s`);
