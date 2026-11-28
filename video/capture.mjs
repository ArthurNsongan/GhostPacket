#!/usr/bin/env node
// Step 2: recording. Plays every scene of scenes.mjs in one headless Chrome
// (1920×1080) and writes work/clips/<scene>.mp4. Each clip holds until its
// narration (step 1) has ended. Optional scenes use video/footage/ instead.
//   node video/capture.mjs [--only 07-chimera,08-lan-whisper] [--live https://arthurnsongan.github.io/GhostPacket]
// Scenes run in order in the same tab: a scene without `path` continues the previous page.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { launch } from "./lib/cdp.mjs";
import { activeScenes, arg, ensure, footageOf, LEAD_IN, ROOT, TAIL, VIDEO, WORK } from "./lib/paths.mjs";
import { record } from "./lib/recorder.mjs";

const durationsFile = join(WORK, "voice", "durations.json");
if (!existsSync(durationsFile)) throw new Error("Run node video/narrate.mjs first (narration sets each clip's length)");
const durations = JSON.parse(readFileSync(durationsFile, "utf8"));
const clips = ensure(join(WORK, "clips"));
const live = arg("live");
const d = await launch(live ? { live: typeof live === "string" ? live : "https://arthurnsongan.github.io/GhostPacket" } : { outDir: join(ROOT, "pages-out") });
const cardUrl = pathToFileURL(join(VIDEO, "cards", "card.html")).href;
const report = [];
try {
  for (const s of activeScenes(arg("only"))) {
    if (footageOf(s)) {
      report.push(`${s.id}: footage ${footageOf(s)} (used as is by assemble)`);
      continue;
    }
    const speed = s.speed ?? 1;
    const need = ((durations[s.id] ?? 0) + LEAD_IN + TAIL) * speed;
    if (s.card) {
      await d.go(`${cardUrl}?${new URLSearchParams(s.card)}`, `document.body.dataset.ready === "1"`);
      await d.ev(`document.getElementById("gp-cursor")?.remove()`);
      // Replay the entrance animation inside the recording.
      await d.ev(`document.querySelectorAll(".rise").forEach((e) => { e.style.animation = "none"; void e.offsetWidth; e.style.animation = ""; })`);
    } else if (s.path) {
      await d.go(s.path);
    }
    if (s.setup) await s.setup(d);
    const rec = await record(d, join(WORK, "frames", s.id));
    const t0 = Date.now();
    if (s.run) await s.run(d);
    const acted = (Date.now() - t0) / 1000;
    if (acted < need) await d.sleep((need - acted) * 1000);
    const out = await rec.stop(join(clips, `${s.id}.mp4`));
    const meta = { id: s.id, seconds: out.seconds, frames: out.frames, speed, acted, narration: durations[s.id] ?? 0 };
    writeFileSync(join(clips, `${s.id}.json`), JSON.stringify(meta, null, 2));
    report.push(`${s.id}: ${out.seconds.toFixed(1)} s recorded (${out.frames} frames), actions ${acted.toFixed(1)} s, narration ${meta.narration.toFixed(1)} s, speed ×${speed}`);
    console.log(report.at(-1));
  }
} finally {
  if (d.errors.length) console.log(`page errors: ${d.errors.slice(0, 3).join(" | ")}`);
  await d.close();
}
console.log(report.join("\n"));
