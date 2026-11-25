#!/usr/bin/env node
// End-to-end check of the Skeleton Crew apps in headless Chrome, on the merged
// GitHub Pages tree (scripts/build-pages.mjs --base /GhostPacket):
//   node scripts/build-pages.mjs --base /GhostPacket && node scripts/e2e-apps.mjs [pages-out]
//   GP_BASE_URL=https://<user>.github.io/GhostPacket node scripts/e2e-apps.mjs   (deployed site)
// GhostClinic: seeded ward → sign → virtual hand-over → verify → dispense once → refuse twice.
// GhostTontine: contribution receipt → wallet; aid voucher → redeem once → refuse twice.
// Both: storage isolation, Clean Field Mode, service worker scope, no error, no external request, no 404.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const OUT = resolve(root, process.argv[2] ?? "pages-out");
const CHROME = process.env.CHROME ?? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
if (!CHROME) {
  console.log("skip: Chrome not found (set CHROME)");
  process.exit(0);
}
const LIVE = process.env.GP_BASE_URL?.replace(/\/$/, "");
if (!LIVE && !existsSync(join(OUT, "clinic", "index.html"))) {
  console.error(`${OUT}/clinic/index.html missing: run node scripts/build-pages.mjs --base /GhostPacket`);
  process.exit(1);
}

const PORT = 4500 + Math.floor(Math.random() * 200);
const DBG = 9480 + Math.floor(Math.random() * 40);
const BASE = LIVE ?? `http://127.0.0.1:${PORT}/GhostPacket`;
const ORIGIN = new URL(BASE).origin;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  let p;
  try {
    p = decodeURIComponent((req.url ?? "/").split("?")[0]);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (!p.startsWith("/GhostPacket/")) {
    res.writeHead(404);
    return res.end();
  }
  p = p.slice("/GhostPacket".length);
  if (p.endsWith("/")) p += "index.html";
  // Never serve outside the export (../ in the URL).
  const file = resolve(OUT, `.${p}`);
  if (!file.startsWith(OUT + sep)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
if (!LIVE) server.listen(PORT, "127.0.0.1");

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${DBG}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "gp-apps-"))}`, "--autoplay-policy=no-user-gesture-required", "--window-size=1440,1000", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) {
  try {
    targets = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json();
    if (targets.some((t) => t.type === "page")) break;
  } catch {}
  await sleep(200);
}
const ws = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
const pending = new Map();
const errors = [];
const external = [];
const missing = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  } else if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  else if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  else if (m.method === "Network.requestWillBeSent") {
    const u = m.params.request.url;
    if (!u.startsWith(`${ORIGIN}/`) && !/^(data|blob):/.test(u)) external.push(u);
  } else if (m.method === "Network.responseReceived" && m.params.response.status >= 400) missing.push(`${m.params.response.status} ${m.params.response.url}`);
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const n = ++id;
    pending.set(n, r);
    ws.send(JSON.stringify({ id: n, method, params }));
  });
const ev = async (expr) => {
  const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? "exception" };
  return r.result?.result?.value;
};
const until = async (expr, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await ev(expr);
    if (v && !v.error) return v;
    await sleep(200);
  }
  return null;
};
const go = async (path) => {
  await send("Page.navigate", { url: BASE + path });
  await sleep(400);
  await until(`document.readyState === "complete"`);
};
/** Clicks the first visible button whose text contains `text`. */
const click = (text) =>
  ev(`(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(${JSON.stringify(text)}) && x.offsetParent !== null && !x.disabled); if (!b) return false; b.click(); return true; })()`);
const text = () => ev("document.body.innerText");

const results = [];
const check = (name, ok, detail = "") => {
  results.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  —  ${String(detail).slice(0, 140)}` : ""}`);
};

await send("Runtime.enable");
await send("Network.enable");

// ---- GhostClinic -------------------------------------------------------------
await go("/clinic/");
const ward = await until(`document.body.innerText.includes("PAT-0815") && document.body.innerText.includes("Mariama Ba")`, 20000);
check("clinic: renders the seeded ward from local records", ward);
check("clinic: haunted theme, clinic identity", (await ev(`[document.documentElement.dataset.theme, document.documentElement.dataset.app].join("/")`)) === "haunted/clinic");
await click("Prescribe");
await until(`document.body.innerText.includes("Sign the prescription")`);
await click("Sign the prescription");
const sealed = await until(`(document.body.innerText.match(/RX-[A-Z0-9]{5} · \\d+ B/) || [])[0]`);
check("clinic: prescription signed (Ed25519, ≤ 512 B)", sealed && Number(sealed.split("· ")[1].split(" ")[0]) <= 512, sealed);
await click("Hand over to the pharmacy");
const verified = await until(`document.body.innerText.includes("ED25519 VERIFIED") && document.body.innerText.includes("Dispense the medicines")`, 30000);
check("clinic: virtual hand-over (30 % QR loss) → pharmacy verifies", verified, (await text()).match(/\d+ QR shown[^\n]*/)?.[0]);
await click("Dispense the medicines");
check("clinic: first dispensing recorded", await until(`document.body.innerText.includes("Dispensed ✓")`));
await click("Dispensed ✓");
const twice = await until(`document.body.innerText.includes("Already dispensed") && /REPLAY/.test(document.body.innerText)`);
check("clinic: second presentation refused (REPLAY)", twice);
const keys = await ev(`Object.keys(localStorage)`);
check(
  "clinic: data isolated under the clinic: namespace",
  keys.some((k) => k === "clinic:ghostpacket.ledger.v1.dispensed") && keys.some((k) => k.startsWith("clinic:ghostpacket.records.v1.patients")) && !keys.some((k) => k === "ghostpacket.ledger.v1.dispensed"),
  keys.filter((k) => k.includes("ghost")).join(" "),
);
await click("Sync");
check("clinic: verified proof queued for opt-in sync", await until(`document.body.innerText.includes("PENDING")`));
await click("HAUNTED");
// Rendered boxes of the moon and the bat canvas: none once the decoration is hidden.
const clean = await ev(`[document.documentElement.dataset.theme, document.querySelector(".moon").getClientRects().length + document.querySelector("canvas.haunt-only").getClientRects().length].join("/")`);
check("clinic: Clean Field Mode hides the decoration", clean === "clean/0", clean);
await click("CLEAN FIELD");
const swClinic = await until(`navigator.serviceWorker.getRegistration().then((r) => r && r.scope)`, 10000);
check("clinic: own service worker scope", typeof swClinic === "string" && swClinic.endsWith("/GhostPacket/clinic/"), swClinic);

// ---- GhostTontine ------------------------------------------------------------
await go("/tontine/");
check("tontine: renders the seeded members", await until(`document.body.innerText.includes("Aminata Diop") && document.body.innerText.includes("Coumba Gueye")`, 20000));
check("tontine: theme shared across apps (prefs), tontine identity", (await ev(`[document.documentElement.dataset.theme, document.documentElement.dataset.app].join("/")`)) === "haunted/tontine");
await click("Record contribution");
const receipt = await until(`(document.body.innerText.match(/Receipt TNT-[A-Z0-9]{4}[^\\n]*/) || [])[0]`);
check("tontine: contribution receipt signed", receipt, receipt);
await click("Hand over to the member");
const inWallet = await until(`document.body.innerText.includes("ED25519 VERIFIED") && /Receipt · round \\d+/.test(document.body.innerText)`, 30000);
check("tontine: member phone verifies the receipt and keeps it in the wallet", inWallet);
await click("Aid voucher");
await until(`document.body.innerText.includes("Sign the voucher")`);
await click("Sign the voucher");
await until(`/Aid voucher AID-[A-Z0-9]{4}/.test(document.body.innerText)`);
await click("Hand over to the member");
check("tontine: aid voucher verified on the member phone", await until(`document.body.innerText.includes("Redeem the voucher")`, 30000));
await click("Redeem the voucher");
check("tontine: voucher redeemed once", await until(`document.body.innerText.includes("Redeemed ✓")`));
await click("Redeemed ✓");
check("tontine: same voucher refused the second time (REPLAY)", await until(`document.body.innerText.includes("Already redeemed") && /REPLAY/.test(document.body.innerText)`));
const tkeys = await ev(`Object.keys(localStorage)`);
check("tontine: clinic data invisible to the tontine", tkeys.some((k) => k.startsWith("tontine:")) && !(await ev(`document.body.innerText.includes("PAT-0815")`)));

// ---- Portal links -------------------------------------------------------------
await go("/");
const links = await ev(`[...document.querySelectorAll("a")].map((a) => a.getAttribute("href")).filter((h) => /clinic|tontine/.test(h)).join(" ")`);
const basePath = new URL(BASE).pathname.replace(/\/$/, "");
check("portal: links to both apps", links.includes(`${basePath}/clinic/`) && links.includes(`${basePath}/tontine/`), links);

check("no console error", errors.length === 0, errors.slice(0, 3).join(" | "));
check("no external request", external.length === 0, external.slice(0, 3).join(" "));
check("no 404", missing.filter((m) => !m.endsWith("favicon.ico")).length === 0, [...new Set(missing)].slice(0, 4).join(" "));

ws.close();
chrome.kill();
if (server.listening) server.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} app checks passed`);
process.exit(failed ? 1 : 0);
