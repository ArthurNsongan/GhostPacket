// Minimal Chrome DevTools Protocol driver for the demo recording: launches
// Chrome, serves pages-out/ locally (or uses a live URL), and offers the
// actions a scene needs (navigate, click by text with a visible cursor, type
// by aria-label, wait). No dependency: Node's built-in WebSocket and fetch.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { release, tempDir, track } from "../../scripts/lib/temp.mjs";

export const WIDTH = 1920;
export const HEIGHT = 1080;
const CHROME = process.env.CHROME ?? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find(existsSync);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain", ".png": "image/png" };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Static server for the merged Pages tree under /GhostPacket/. */
function serve(outDir) {
  const root = resolve(outDir);
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
    const file = resolve(root, `.${p}`);
    if (!file.startsWith(root + sep)) {
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
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

/**
 * Starts Chrome (headless, 1920×1080, 1× pixels) and returns a driver.
 * `opts.live` = deployed base URL, else `opts.outDir` (pages-out) is served locally.
 */
export async function launch(opts = {}) {
  if (!CHROME) throw new Error("Chrome not found: set CHROME=<path to chrome>");
  let server = null;
  let base = opts.live?.replace(/\/$/, "");
  if (!base) {
    if (!opts.outDir || !existsSync(join(opts.outDir, "index.html"))) throw new Error(`${opts.outDir}/index.html missing: run node scripts/build-pages.mjs --base /GhostPacket`);
    server = await serve(opts.outDir);
    base = `http://127.0.0.1:${server.address().port}/GhostPacket`;
  }
  const port = 9600 + Math.floor(Math.random() * 300);
  // Default: a real (GPU) Chrome window parked off-screen, so WebGL and the
  // screencast run at full speed without covering the desktop. GP_VIDEO_HEADLESS=1
  // falls back to headless SwiftShader (slower, fewer frames).
  const headless = process.env.GP_VIDEO_HEADLESS === "1" || opts.headless;
  const mode = headless
    ? ["--headless=new", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"]
    : ["--window-position=-2400,0", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWinOcclusion", "--no-first-run", "--no-default-browser-check", "--disable-infobars"];
  const profile = tempDir("gp-video-");
  const chrome = track(spawn(
    CHROME,
    [
      ...mode,
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${WIDTH},${HEIGHT + 140}`,
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      "about:blank",
    ],
    { stdio: "ignore" },
  ));
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {
      /* not up yet */
    }
    if (!target) await sleep(200);
  }
  if (!target) throw new Error("Chrome did not start");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  const errors = [];
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
      return;
    }
    if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    for (const fn of listeners.get(m.method) ?? []) fn(m.params);
  });
  const send = (method, params = {}) =>
    new Promise((r) => {
      const n = ++id;
      pending.set(n, r);
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const on = (method, fn) => {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(fn);
    return () => listeners.get(method).delete(fn);
  };
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

  const ev = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.exception?.description ?? "exception" };
    return r.result?.result?.value;
  };
  const until = async (expr, ms = 15_000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = await ev(expr);
      if (v && !v.error) return v;
      await sleep(150);
    }
    return null;
  };

  /** Fake mouse cursor: headless Chrome draws none, viewers need to see where we click. */
  const CURSOR = `(() => {
    if (document.getElementById("gp-cursor")) return;
    const c = document.createElement("div");
    c.id = "gp-cursor";
    c.style.cssText = "position:fixed;left:960px;top:620px;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:left .55s cubic-bezier(.3,.7,.2,1),top .55s cubic-bezier(.3,.7,.2,1);";
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2l7 19 2.6-7.4L20 11z" fill="#f4efe6" stroke="#120d18" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const r = document.createElement("div");
    r.id = "gp-ripple";
    r.style.cssText = "position:fixed;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;z-index:2147483646;pointer-events:none;background:rgba(244,190,110,.35);transform:scale(0);opacity:0;";
    document.body.appendChild(r);
  })()`;

  let last = { x: 960, y: 620 };
  const driver = {
    base,
    errors,
    send,
    on,
    ev,
    until,
    sleep,
    async go(path, wait = 'document.readyState === "complete"') {
      await send("Page.navigate", { url: /^(file|https?):/.test(path) ? path : base + path });
      await sleep(500);
      await until(wait, 30_000);
      await ev(CURSOR);
    },
    /** Moves the cursor to the first visible, enabled button (or link) containing `text`, then clicks it. */
    async click(text, { selector = "button, a, summary, [role=button]", pause = 250 } = {}) {
      await ev(CURSOR);
      const pos = await ev(`(() => {
        const t = ${JSON.stringify(text)};
        const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((x) => x.textContent.includes(t) && x.offsetParent !== null && !x.disabled);
        if (!el) return null;
        el.scrollIntoView({ block: "center", behavior: "instant" });
        const r = el.getBoundingClientRect();
        window.__gpTarget = el;
        return { x: r.left + Math.min(r.width / 2, 120), y: r.top + r.height / 2 };
      })()`);
      if (!pos) return false;
      await ev(`(() => { const c = document.getElementById("gp-cursor"); c.style.left = "${pos.x - 4}px"; c.style.top = "${pos.y - 3}px"; })()`);
      // Real pointer moves along the same path: hover states, the candle glow and the
      // spectres (they dissolve near the pointer) react as they would for a person.
      for (let i = 1; i <= 8; i++) {
        const k = i / 8;
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(last.x + (pos.x - last.x) * k), y: Math.round(last.y + (pos.y - last.y) * k) });
        await sleep(60);
      }
      last = pos;
      await sleep(120);
      await ev(`(() => {
        const r = document.getElementById("gp-ripple");
        r.style.left = "${pos.x}px"; r.style.top = "${pos.y}px";
        r.animate([{ transform: "scale(.2)", opacity: .9 }, { transform: "scale(1.4)", opacity: 0 }], { duration: 450, easing: "ease-out" });
        window.__gpTarget?.click();
      })()`);
      await sleep(pause);
      return true;
    },
    /** Types into a React-controlled input (last one with that aria-label), letter by letter. */
    async type(label, value, { perChar = 35 } = {}) {
      const sel = JSON.stringify(`input[aria-label="${label}"]`);
      const ok = await ev(`(() => { const el = [...document.querySelectorAll(${sel})].at(-1); if (!el) return false; el.scrollIntoView({ block: "center" }); el.focus(); return true; })()`);
      if (!ok) return false;
      for (let i = 1; i <= value.length; i++) {
        await ev(`(() => { const el = [...document.querySelectorAll(${sel})].at(-1); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(el, ${JSON.stringify(value)}.slice(0, ${i})); el.dispatchEvent(new Event("input", { bubbles: true })); })()`);
        await sleep(perChar);
      }
      return true;
    },
    /** Smooth scroll to an element containing `text` (or by `px`). */
    async scrollTo(text, { block = "start", offset = -90 } = {}) {
      await ev(`(() => {
        const el = [...document.querySelectorAll("h1,h2,h3,p,section,div,span")].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)}) && x.offsetParent !== null);
        if (!el) return false;
        const y = el.getBoundingClientRect().top + window.scrollY + ${offset};
        window.scrollTo({ top: ${block === "center" ? "y - innerHeight / 2" : "y"}, behavior: "smooth" });
        return true;
      })()`);
      await sleep(900);
    },
    async scrollBy(px) {
      await ev(`window.scrollBy({ top: ${px}, behavior: "smooth" })`);
      await sleep(900);
    },
    async text() {
      return String(await ev("document.body.innerText"));
    },
    async screenshot(path) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(path, Buffer.from(r.result.data, "base64"));
    },
    async close() {
      ws.close();
      // Kills Chrome and deletes its profile now (the exit hook covers crashes).
      release({ procs: [chrome], dirs: [profile] });
      server?.close();
    },
  };
  return driver;
}
