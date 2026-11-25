// Browser test of the SDK (headless Chrome with fake microphone and camera).
// Exercises every transport method of GhostPacketSDK plus proof sync to a real
// ghostpacket-verifier. Requires Google Chrome and the release verifier binary.
//   npm --prefix sdk run build && cargo build --release --manifest-path crates/ghostpacket-verifier/Cargo.toml
//   npm --prefix sdk run test:browser          (CHROME=<path> to override)
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, openSync, writeSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import qrcode from "qrcode-generator";
import { GhostPacketSDK, toHex } from "../dist/lib/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const sdkDir = join(here, "..");
const CHROME =
  process.env.CHROME ??
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find(existsSync);
const VERIFIER = join(sdkDir, "..", "crates", "ghostpacket-verifier", "target", "release", process.platform === "win32" ? "ghostpacket-verifier.exe" : "ghostpacket-verifier");
if (!CHROME || !existsSync(VERIFIER)) {
  console.log(`skip: ${!CHROME ? "Chrome not found (set CHROME)" : "verifier binary not built"}`);
  process.exit(0);
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  —  " + detail : ""}`);
};

// ---- Fake media, sealed by a fixed "emitter" key -------------------------------
const wasm = readFileSync(join(sdkDir, "dist", "wasm", "ghostpacket_core_bg.wasm"));
const emitter = await GhostPacketSDK.load({ wasm, seed: new Uint8Array(32).fill(0x5a) });
const core = emitter.core;
const work = mkdtempSync(join(tmpdir(), "gp-sdk-"));

const micFrame = emitter.sealMessage({ sender: "Ndiob health post", title: "Rx", message: "Heard through the air by the SDK." }).value.frame;
const fs = 48000;
const pcm = core.fskModulate(micFrame, fs, "robust").value;
const noise = core.injectNoise(new Float32Array(pcm.length + 2 * fs), 18, 3);
const pcm16 = Buffer.alloc(noise.length * 2);
for (let i = 0; i < noise.length; i++) {
  const s = (i >= fs && i < fs + pcm.length ? pcm[i - fs] : 0) * 0.6 + noise[i] * 0.6;
  pcm16.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s * 32767))), i * 2);
}
const hdr = Buffer.alloc(44);
hdr.write("RIFF", 0); hdr.writeUInt32LE(36 + pcm16.length, 4); hdr.write("WAVE", 8); hdr.write("fmt ", 12);
hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22); hdr.writeUInt32LE(fs, 24);
hdr.writeUInt32LE(fs * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34); hdr.write("data", 36); hdr.writeUInt32LE(pcm16.length, 40);
writeFileSync(join(work, "mic.wav"), Buffer.concat([hdr, pcm16]));

const camFrame = emitter.sealMessage({ sender: "Kaolack point 4", title: "Voucher", message: "Seen by the SDK camera scanner." }).value.frame;
const tx = core.fountainTx(camFrame, core.crc32(camFrame) & 0xffff).value;
const W = 640, H = 480, FRAMES = 60;
const out = openSync(join(work, "cam.y4m"), "w");
writeSync(out, `YUV4MPEG2 W${W} H${H} F8:1 Ip A1:1 C420jpeg\n`);
const chroma = Buffer.alloc((W / 2) * (H / 2) * 2, 128);
for (let n = 0; n < FRAMES; n++) {
  const qr = qrcode(0, "M");
  qr.addData(toHex(tx.droplet(n)), "Alphanumeric");
  qr.make();
  const m = qr.getModuleCount(), cell = 10, size = (m + 8) * cell;
  const ox = (W - size) >> 1, oy = (H - size) >> 1;
  const y = Buffer.alloc(W * H, 60);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const r0 = Math.floor(py / cell) - 4, c0 = Math.floor(px / cell) - 4;
    y[(oy + py) * W + ox + px] = r0 >= 0 && c0 >= 0 && r0 < m && c0 < m && qr.isDark(r0, c0) ? 30 : 220;
  }
  writeSync(out, "FRAME\n");
  writeSync(out, y);
  writeSync(out, chroma);
}
closeSync(out);
tx.free();

// ---- Static server for sdk/, verifier, Chrome ------------------------------------
const PORT = 18900 + Math.floor(Math.random() * 90);
const VPORT = PORT + 100;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm", ".json": "application/json" };
const server = createServer(async (req, res) => {
  const p = decodeURIComponent((req.url ?? "/").split("?")[0]);
  try {
    const body = await readFile(join(sdkDir, p));
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(PORT);
const origin = `http://127.0.0.1:${PORT}`;
const verifier = spawn(VERIFIER, ["serve", "--tofu", "--addr", `127.0.0.1:${VPORT}`, "--allow-origin", origin], { stdio: "ignore" });
const DBG = PORT + 200;
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "gp-chrome-"))}`,
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${join(work, "mic.wav")}`, `--use-file-for-fake-video-capture=${join(work, "cam.y4m")}`,
  "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) {
  try { targets = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map(), errors = [], external = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  else if (m.method === "Network.requestWillBeSent") {
    const u = m.params.request.url;
    if (!u.startsWith(origin) && !u.startsWith(`http://127.0.0.1:${VPORT}`) && !/^(data|blob):/.test(u)) external.push(u);
  }
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expr, timeout = 60000) => {
  const r = await Promise.race([send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }), sleep(timeout).then(() => ({ timeout: true }))]);
  if (r.timeout) return { timeout: true };
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? "exception" };
  return r.result?.result?.value;
};

await send("Runtime.enable");
await send("Network.enable");
await send("Page.navigate", { url: `${origin}/examples/browser/index.html` });
const ready = await (async () => { for (let i = 0; i < 80; i++) { if (await ev("!!window.demo", 2000) === true) return true; await sleep(250); } return false; })();
check("SDK loads in a plain page (ES modules + import map, no bundler)", ready);

const fp = await ev("gp.identity.fingerprint");
const sealed = await ev(`(() => { const f = demo.seal(); const v = gp.verifyFrame(f); return v.ok && v.value.fingerprint === gp.identity.fingerprint; })()`);
check("sealMessage + verifyFrame", sealed, fp);
const e2ee = await ev(`(() => { const s = gp.sealMessage({ sender: "a", title: "b", message: "secret" }, { passphrase: "baobab moon harmattan" }); return s.ok && s.value.encrypted && gp.verifyFrame(s.value.frame, { passphrase: "baobab moon harmattan" }).ok && gp.verifyFrame(s.value.frame).error.code === "PASSPHRASE_REQUIRED"; })()`);
check("E2EE seal / open in the browser", e2ee);

const qr = await ev(`(async () => { const p = demo.sendQr(1500); await new Promise(r => setTimeout(r, 400)); const c = document.getElementById("qr"); const px = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 100) dark++; await p; return dark > 500; })()`);
check("transmitOptical draws fountain QR codes", qr);

const sound = await ev(`(async () => { const t0 = performance.now(); const r = await demo.sendSound("fast"); return r.ok ? ((performance.now() - t0) / 1000).toFixed(1) : r.error.code; })()`, 30000);
check("transmitAcoustic plays a burst to the end", typeof sound === "string" && !Number.isNaN(Number(sound)), `${sound} s`);

const cam = await ev(`demo.scan().then(({ sc, v }) => { sc.stop(); return v ? v.document.body.customMessage.message : null; })`, 45000);
check("receiveOptical (fake camera) → verified frame", cam === "Seen by the SDK camera scanner.", JSON.stringify(cam));

const mic = await ev(`demo.listen("robust").then(({ rx, v }) => { rx.stop(); return v ? v.document.body.customMessage.message : null; })`, 75000);
check("receiveAcoustic (fake microphone) → verified frame", mic === "Heard through the air by the SDK.", JSON.stringify(mic));

const endpoint = `http://127.0.0.1:${VPORT}`;
const s1 = await ev(`demo.sync(${JSON.stringify(endpoint)})`);
check("syncProofs uploads queued proofs (201)", s1?.synced === 2 && !s1.networkError, JSON.stringify(s1));
const replay = await ev(`(async () => {
  // Second device: same received frames, empty local ledger and outbox.
  const items = JSON.parse(JSON.stringify(gp.outbox.list()));
  gp.outbox.clear();
  for (const it of items) { const bin = Uint8Array.from(atob(it.frameB64), c => c.charCodeAt(0)); gp.queueProof(bin, gp.verifyFrame(bin).value, it.channel); }
  return demo.sync(${JSON.stringify(endpoint)});
})()`);
check("same proofs from another device → 409 replay", replay?.replays === 2, JSON.stringify(replay));

check("no page error", errors.length === 0, errors.slice(0, 3).join(" | "));
check("no request outside the page origin and the configured verifier", external.length === 0, external.slice(0, 3).join(" "));

ws.close();
chrome.kill();
verifier.kill();
server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);
