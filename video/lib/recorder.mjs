// Records the page with CDP screencast frames (JPEG + timestamps), then turns
// them into a constant 30 fps H.264 clip with ffmpeg. Frames only arrive when
// the page repaints, so each frame lasts until the next one.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { HEIGHT, WIDTH } from "./cdp.mjs";

export const FPS = 30;

export function ffmpeg(args, { quiet = true } = {}) {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-y", ...(quiet ? ["-loglevel", "error"] : []), ...args], { stdio: ["ignore", "inherit", "inherit"] });
  if (r.status !== 0) throw new Error(`ffmpeg failed (${r.status}): ffmpeg ${args.join(" ")}`);
}

export function hasAudio(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], { encoding: "utf8" });
  return r.stdout.trim().length > 0;
}

export function probeSeconds(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  const s = Number(r.stdout.trim());
  if (!Number.isFinite(s)) throw new Error(`ffprobe could not read ${file}`);
  return s;
}

/** Starts recording; `stop()` resolves to the frame list once the clip is written. */
export async function record(driver, framesDir) {
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });
  const frames = [];
  const writes = [];
  const off = driver.on("Page.screencastFrame", (p) => {
    const n = frames.length;
    const file = join(framesDir, `f${String(n).padStart(6, "0")}.jpg`);
    frames.push({ file, t: p.metadata.timestamp });
    writes.push(writeFile(file, Buffer.from(p.data, "base64")));
    void driver.send("Page.screencastFrameAck", { sessionId: p.sessionId });
  });
  await driver.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 });
  const started = Date.now() / 1000;
  return {
    async stop(outFile) {
      const stopped = Date.now() / 1000;
      await driver.send("Page.stopScreencast");
      off();
      await Promise.all(writes);
      if (frames.length === 0) throw new Error("No screencast frame received");
      // Concat list: each frame shown until the next one; the last until stop.
      const lines = ["ffconcat version 1.0"];
      const t0 = frames[0].t;
      const lead = Math.max(0, t0 - started);
      frames.forEach((f, i) => {
        const next = i + 1 < frames.length ? frames[i + 1].t : t0 + (stopped - started - lead);
        lines.push(`file '${f.file.replace(/\\/g, "/")}'`, `duration ${Math.max(1 / FPS, next - f.t).toFixed(4)}`);
      });
      lines.push(`file '${frames.at(-1).file.replace(/\\/g, "/")}'`);
      const list = join(framesDir, "frames.ffconcat");
      writeFileSync(list, lines.join("\n"));
      // The last entry is repeated so its duration is honored; -t cuts the extra copy.
      const length = Math.max(1 / FPS, stopped - started - lead);
      ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-t", length.toFixed(3), "-vf", `fps=${FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,format=yuv420p`, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-an", outFile]);
      return { frames: frames.length, seconds: probeSeconds(outFile) };
    },
  };
}
