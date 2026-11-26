// GhostPacket portal end-to-end check (headless Chrome, fake mic/camera, base path /GhostPacket/).
//   npm run build:pages -- --base /GhostPacket && node scripts/e2e/portal.mjs [pages-out] [section,...]
//   GP_BASE_URL=https://<user>.github.io/GhostPacket node scripts/e2e/portal.mjs - [sections]   (deployed site)
// Sections: pages, demo, message, replay, race, verifier, field, sync, offline (default: all).
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const OUT = resolve(ROOT, process.argv[2] && process.argv[2] !== "-" ? process.argv[2] : "pages-out");
const ONLY = process.argv[3]?.split(",");
const LIVE = process.env.GP_BASE_URL?.replace(/\/$/, "");
const CHROME = process.env.CHROME ?? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!CHROME) {
  console.log("skip: Chrome not found (set CHROME)");
  process.exit(0);
}
// Fake microphone (FSK burst through a simulated room) and camera (QR stream) files.
if (!existsSync(join(tmpdir(), "gp-mic.wav")) || !existsSync(join(tmpdir(), "gp-cam.y4m"))) {
  spawnSync(process.execPath, [join(ROOT, "scripts", "e2e", "fake-media.mjs")], { stdio: "inherit" });
}
const PORT = 4190 + Math.floor(Math.random() * 50), DBG = 9461 + Math.floor(Math.random() * 30);
const ORIGIN = LIVE ? new URL(LIVE).origin : `http://127.0.0.1:${PORT}`;
const BASE = LIVE ? `${LIVE}/` : `http://127.0.0.1:${PORT}/GhostPacket/`;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain" };
const missing = [], external = [], logs = [], results = [];
let offline = false;

const server = createServer(async (req, res) => {
  if (offline) { req.socket.destroy(); return; }
  let p;
  try {
    p = decodeURIComponent((req.url ?? "/").split("?")[0]);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (!p.startsWith("/GhostPacket/")) { missing.push(p); res.writeHead(404); return res.end(); }
  p = p.slice("/GhostPacket".length);
  if (p.endsWith("/")) p += "index.html";
  const file = resolve(OUT, `.${p}`);
  if (!file.startsWith(OUT + sep)) { res.writeHead(403); return res.end(); }
  try {
    const b = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(b);
  } catch { missing.push(p); res.writeHead(404); res.end(); }
});
if (!LIVE) server.listen(PORT, "127.0.0.1");

const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "gp-chrome-"))}`,
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
  `--use-file-for-fake-audio-capture=${join(tmpdir(), "gp-mic.wav")}`, `--use-file-for-fake-video-capture=${join(tmpdir(), "gp-cam.y4m")}`,
  "--autoplay-policy=no-user-gesture-required", "--window-size=1500,1100", "about:blank",
], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (targets.some((t) => t.type === "page")) break; } catch {} await sleep(200); }
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  else if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) logs.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  else if (m.method === "Runtime.exceptionThrown") logs.push("exception: " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  else if (m.method === "Network.requestWillBeSent") { const u = m.params.request.url; if (!u.startsWith(ORIGIN) && !/^(data|blob):/.test(u)) external.push(u); }
  else if (LIVE && m.method === "Network.responseReceived" && m.params.response.status >= 400) missing.push(`${m.params.response.status} ${m.params.response.url}`);
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result?.result?.value;
const click = (text, scope = "button") => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(scope)})].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled); if (b) b.click(); return !!b; })()`);
const until = async (expr, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await ev(expr); if (v) return v; await sleep(250); } return null; };
const verdictText = `(document.querySelector('[role=alert].tampered, [role=alert]') ?? document.querySelector('div[role=status].rounded-lg'))?.textContent ?? ''`;
const go = async (path) => { await send("Page.navigate", { url: BASE + path }); await sleep(400); await until(`document.readyState === 'complete'`, 15000); };
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  —  " + detail : ""}`); };
const want = (s) => !ONLY || ONLY.includes(s);

await send("Runtime.enable"); await send("Network.enable"); await send("Page.enable");

if (want("pages")) {
  for (const [path, probe] of [["", "Launch the 20 s simulation"], ["how-it-works/", "threat model"], ["simulation/", "Summon the full demo"], ["test/", "This device sends"]]) {
    await go(path);
    const ok = await until(`document.body.innerText.includes(${JSON.stringify(probe)})`, 15000);
    check(`page /${path} renders`, ok);
  }
}

if (want("demo")) {
  await go("");
  await until(`!!document.querySelector('a[href*="simulation/?run=1"]')`, 10000);
  const t0 = Date.now();
  await ev(`document.querySelector('a[href*="simulation/?run=1"]').click()`);
  const summary = await until(`[...document.querySelectorAll('[role=status]')].map(e => e.textContent).find(t => t.includes('Full scenario') || t.includes('Failed at')) ?? null`, 40000);
  const secs = (Date.now() - t0) / 1000;
  check("home CTA auto-runs 1-click demo < 20 s", summary?.includes("Full scenario") && secs < 20, `${secs.toFixed(1)} s · ${summary?.slice(0, 90)}`);
  check("demo ends on 1-bit curse rejection", (await ev(verdictText)).includes("CRC32_MISMATCH"));
  const ledger = await ev(`document.body.innerText.includes('replay(s) blocked')`);
  check("second channel delivery recorded as replay in Crypt Ledger", ledger);
}

if (want("message")) {
  await go("simulation/");
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Write a message'))`, 15000);
  await click("Write a message");
  await sleep(200);
  await ev(`(() => { const t = document.querySelector('textarea'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; set.call(t, 'Ghosts carry this secret line: E2E test 4242.'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await ev(`document.querySelector('input[aria-label="Encrypt the payload"]').click()`);
  await until(`document.body.innerText.includes('ENC')`, 5000);
  await sleep(600);
  await click("Send over QR");
  const v = await until(`(() => { const t = ${verdictText}; return t.includes('VERIFIED') || t.includes('REJECTED') ? t : null; })()`, 25000);
  check("custom message + E2EE over QR verified and decrypted", v?.includes("ED25519 VERIFIED") && v.includes("E2EE") && v.includes("E2E test 4242"), v?.slice(0, 110));
  const plainLeak = await ev(`(() => { const s = document.getElementById('inspector-title')?.closest('section')?.innerText ?? ''; return s.includes('ENC'); })()`);
  check("inspector marks payload as ENC ciphertext", plainLeak);

  for (const [btn, code] of [["Curse payload", "CRC32_MISMATCH"], ["Curse signature", "INVALID_SIGNATURE"], ["Forge rogue key", "UNTRUSTED_ISSUER"], ["Wrong passphrase", "DECRYPTION_FAILED"]]) {
    await click(btn);
    await sleep(btn === "Forge rogue key" || btn === "Wrong passphrase" ? 900 : 300);
    const t = await ev(verdictText);
    check(`tamper lab: ${btn} → ${code}`, t.includes(code), t.slice(0, 60));
  }
  await click("Restore intact frame");
  await sleep(300);
  await ev(`document.querySelector('button[title^="#0 "]').click()`);
  await sleep(300);
  const t0 = await ev(verdictText);
  const layer = await ev(`document.body.innerText.match(/caught by [^\\n]+/)?.[0] ?? ''`);
  check("curse byte #0 → INVALID_PREAMBLE, caught by Structure", t0.includes("INVALID_PREAMBLE") && layer.includes("Structure"), layer);
  await click("Restore intact frame");
  const blood = await ev(`(async () => { document.querySelector('button[title^="#300 "], button[title^="#200 "]')?.click(); await new Promise(r => setTimeout(r, 80)); return document.documentElement.classList.contains('blood-moon'); })()`);
  check("Blood Moon alert on rejection", blood);
  await click("Restore intact frame");
}

if (want("replay")) {
  await go("simulation/");
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Send over QR') && !b.disabled)`, 15000);
  await click("Send over QR");
  await until(`(${verdictText}).includes('VERIFIED')`, 20000);
  await click("Send over QR");
  await sleep(500);
  const v = await until(`(() => { const t = ${verdictText}; return t.includes('REPLAY DETECTED') ? t : null; })()`, 20000);
  check("same document twice → REPLAY DETECTED · ALREADY REDEEMED", v);
}

if (want("race")) {
  await go("simulation/");
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Start race') && !b.disabled)`, 15000);
  await click("Start race");
  await sleep(1500);
  await click("Jam audio");
  const s1 = await until(`[...document.querySelectorAll('[role=status]')].map(e => e.textContent).find(t => t.startsWith('Chimera race')) ?? null`, 30000);
  const lanes1 = await ev(`[...document.querySelectorAll('span')].filter(s => /WINNER|LOST|2nd/.test(s.textContent)).map(s => s.textContent).join(' | ')`);
  check("race with audio jammed: light wins, sound lost", s1?.includes("light delivered") && lanes1.includes("LOST"), `${lanes1} · ${s1?.slice(0, 80)}`);
  const restarted = await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Start race') && !b.disabled)`, 15000);
  await click("Start race");
  await sleep(400);
  const blocked = await click("Block camera");
  console.log("race2 restarted", !!restarted, "blocked", blocked);
  // Either sound wins, or light wins and the summary credits the fountain code "despite 85 %".
  const s2 = await until(`[...document.querySelectorAll('[role=status]')].map(e => e.textContent).find(t => t.startsWith('Chimera race') && (t.includes('sound delivered') || t.includes('despite 85'))) ?? null`, 60000);
  const dbg = await ev(`[...document.querySelectorAll('[role=status]')].map(e => e.textContent).filter(t => t.startsWith('Chimera')).join(' || ') + ' ## ' + [...document.querySelectorAll('span')].filter(s => /WINNER|LOST|2nd|racing/.test(s.textContent)).map(s => s.textContent).join(' | ')`);
  const strip = await ev(`document.body.innerText.match(/\\d+ frames · \\d+ lost \\(\\d+ %\\)/)?.[0] ?? 'no strip'`);
  console.log("race2 QR strip:", strip);
  check("race with camera blocked 85 %: sound wins", s2, s2?.slice(0, 90) ?? dbg);
}

if (want("verifier")) {
  await go("how-it-works/");
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Generate a sample frame'))`, 15000);
  await click("Generate a sample frame");
  const v = await until(`(() => { const t = ${verdictText}; return t.includes('VERIFIED') ? t : null; })()`, 5000);
  check(".gpkt verifier verifies a generated frame", v);
}

if (want("field")) {
  await go("test/");
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('This device receives'))`, 15000);
  await click("This device receives");
  await sleep(300);
  await click("Listen (microphone)");
  const mic = await until(`(() => { const t = ${verdictText}; return t.includes('VERIFIED') ? t : null; })()`, 70000);
  check("field receiver: fake microphone → ED25519 VERIFIED", mic, mic?.slice(0, 80));
  await click("Stop listening");
  await sleep(300);
  await click("Scan the screen (camera)");
  const cam = await until(`(() => { const t = ${verdictText}; return t.includes('camera') && t.includes('VERIFIED') ? t : null; })()`, 40000);
  check("field receiver: fake camera → ED25519 VERIFIED", cam, cam?.slice(0, 80));
}

if (want("sync")) {
  const exe = join(ROOT, "crates", "ghostpacket-verifier", "target", "release", process.platform === "win32" ? "ghostpacket-verifier.exe" : "ghostpacket-verifier");
  const vport = 18787;
  const ver = spawn(exe, ["serve", "--tofu", "--addr", `127.0.0.1:${vport}`, "--allow-origin", ORIGIN], { stdio: "ignore" });
  await sleep(500);
  await go("test/");
  await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('This device receives'))`, 15000);
  const before = await ev(`!!document.getElementById('outbox-title')`);
  const sentBefore = external.filter((u) => u.includes(`:${vport}`)).length;
  check("outbox panel shown; no verifier URL → nothing sent", before && sentBefore === 0);
  await click("This device receives");
  await sleep(300);
  await click("Scan the screen (camera)");
  await until(`(${verdictText}).includes('camera') && (${verdictText}).includes('VERIFIED')`, 40000);
  const queued = await until(`document.body.innerText.includes('PENDING') ? true : null`, 5000);
  check("verified camera frame queued as PENDING", queued);
  await ev(`(() => { const i = document.querySelector('input[aria-label="Verifier URL"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'http://127.0.0.1:${vport}'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  await click("Sync now");
  const synced = await until(`document.body.innerText.includes('SYNCED · 201') ? document.querySelector('#outbox-title')?.closest('section')?.querySelector('[role=status]')?.textContent : null`, 10000);
  check("Sync now → server re-verifies → SYNCED · 201", synced, synced ?? "");
  const health = await (await fetch(`http://127.0.0.1:${vport}/v1/health`)).json();
  const nSynced = Number(String(synced ?? "").match(/(\d+) synced/)?.[1] ?? -1);
  check("verifier ledger holds every synced proof", nSynced >= 1 && health.ledger === nSynced, `${nSynced} synced · ${JSON.stringify(health)}`);
  ver.kill();
  // The verifier is a configured endpoint, not an external request.
  for (let i = external.length - 1; i >= 0; i--) if (external[i].startsWith(`http://127.0.0.1:${vport}`)) external.splice(i, 1);
}

if (want("offline")) {
  await go("");
  await sleep(1500);
  await send("Page.reload", {});
  await sleep(2500);
  const controlled = await until(`navigator.serviceWorker && !!navigator.serviceWorker.controller`, 10000);
  check("service worker controls the page", controlled);
  // Visit every page once while online so their assets are cached.
  for (const p of ["simulation/", "test/", "how-it-works/"]) { await go(p); await sleep(1200); }
  offline = true;
  await send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await go("simulation/");
  const ok = await until(`document.body.innerText.includes('Summon the full demo') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Summon the full demo') && !b.disabled)`, 15000);
  const badge = await ev(`document.body.innerText.toLowerCase().includes('offline · air-gap active')`);
  check("offline reload: simulation works from cache, badge OFFLINE · AIR-GAP ACTIVE", ok && badge);
  await send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  offline = false;
}

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(join(tmpdir(), "gp-v2.png"), Buffer.from(shot.result.data, "base64"));
check("no console error", logs.length === 0, logs.slice(0, 4).join(" || "));
check("no external request", external.length === 0, external.slice(0, 3).join(" "));
check("no 404", missing.filter((m) => !m.endsWith("favicon.ico")).length === 0, [...new Set(missing)].slice(0, 5).join(" "));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
ws.close(); chrome.kill(); if (server.listening) server.close(); process.exit(failed ? 1 : 0);
