// Builds fake capture files for Chrome (used by scripts/e2e/portal.mjs):
// - gp-mic.wav: robust FSK burst of a signed frame, through a simulated room
//   (100 ppm clock drift, two echoes, 15 dB white noise);
// - gp-cam.y4m: fountain droplets as QR codes, 8 FPS, shot at a slight blur.
import { readFileSync, writeFileSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
//   node scripts/e2e/fake-media.mjs        (writes gp-mic.wav and gp-cam.y4m to the temp folder)

const root = join(fileURLToPath(import.meta.url), "..", "..", "..");
const sdk = join(root, "packages", "ghostpacket-sdk");
const gp = await import(pathToFileURL(join(sdk, "wasm", "ghostpacket_core.js")).href);
gp.initSync({ module: readFileSync(join(sdk, "wasm", "ghostpacket_core_bg.wasm")) });
const { PRESETS } = await import(pathToFileURL(join(sdk, "src", "presets.ts")).href);
const qrcode = (await import(pathToFileURL(join(root, "node_modules", "qrcode-generator", "dist", "qrcode.mjs")).href)).default;

const seed = new Uint8Array(32).fill(0x5a);
const micFrame = gp.encode_document(PRESETS[1].draft, seed, 0b1110).frame;
const camFrame = gp.encode_document(PRESETS[2].draft, seed, 0b1110).frame;

// --- microphone ---------------------------------------------------------------
const fs = 48000;
const pcm = gp.fsk_modulate(micFrame, fs, 0);
const r = 1 + 100e-6;
const drifted = new Float32Array(Math.floor(pcm.length / r));
for (let i = 0; i < drifted.length; i++) {
  const t = i * r, k = Math.floor(t), f = t - k;
  drifted[i] = (pcm[k] ?? 0) * (1 - f) + (pcm[k + 1] ?? 0) * f;
}
const lead = fs, tail = 2 * fs;
const dry = new Float32Array(lead + drifted.length + tail);
dry.set(drifted, lead);
const wet = new Float32Array(dry.length);
const d1 = Math.round(0.003 * fs), d2 = Math.round(0.009 * fs);
for (let i = 0; i < dry.length; i++) wet[i] = 0.55 * (dry[i] + (i >= d1 ? 0.5 * dry[i - d1] : 0) + (i >= d2 ? 0.3 * dry[i - d2] : 0));
const noise = gp.inject_awgn(new Float32Array(wet.length), 15, 7);
const pcm16 = Buffer.alloc(wet.length * 2);
for (let i = 0; i < wet.length; i++) pcm16.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round((wet[i] + 0.55 * noise[i]) * 32767))), i * 2);
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm16.length, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(fs, 24);
hdr.writeUInt32LE(fs * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm16.length, 40);
writeFileSync(join(tmpdir(), "gp-mic.wav"), Buffer.concat([hdr, pcm16]));
console.log(`mic: frame ${micFrame.length} B, ${(wet.length / fs).toFixed(1)} s`);

// --- camera -------------------------------------------------------------------
const W = 640, H = 480, FPS = 8, FRAMES = 64;
const session = gp.crc32(camFrame) & 0xffff;
const tx = new gp.FountainTx(camFrame, session, 16);
const out = openSync(join(tmpdir(), "gp-cam.y4m"), "w");
writeSync(out, `YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`);
const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
for (let n = 0; n < FRAMES; n++) {
  const hex = Array.from(tx.droplet(n), (b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
  const qr = qrcode(0, "M");
  qr.addData(hex, "Alphanumeric");
  qr.make();
  const m = qr.getModuleCount(), cell = 10, size = (m + 8) * cell;
  const ox = Math.floor((W - size) / 2), oy = Math.floor((H - size) / 2);
  const y = Buffer.alloc(W * H, 60); // dim room around the phone screen
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const r0 = Math.floor(py / cell) - 4, c0 = Math.floor(px / cell) - 4;
    const dark = r0 >= 0 && c0 >= 0 && r0 < m && c0 < m && qr.isDark(r0, c0);
    y[(oy + py) * W + ox + px] = dark ? 30 : 220;
  }
  const blurred = Buffer.alloc(W * H);
  for (let py = 1; py < H - 1; py++) for (let px = 1; px < W - 1; px++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += y[(py + dy) * W + px + dx];
    blurred[py * W + px] = Math.round(s / 9);
  }
  writeSync(out, "FRAME\n");
  writeSync(out, blurred);
  writeSync(out, chroma);
}
closeSync(out);
tx.free();
console.log(`cam: frame ${camFrame.length} B, K=${Math.ceil(camFrame.length / 16)}, ${FRAMES} QR @ ${FPS} FPS`);
