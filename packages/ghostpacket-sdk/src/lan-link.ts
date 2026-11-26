// WebRTC LAN link, signaled over the air. Two devices on the same Wi-Fi or
// phone hotspot open a DataChannel with no server at all: no STUN, no TURN,
// no signaling server. The offer and the answer are compacted to a short text
// ("GPLAN1|…") that travels as one QR code or one OFDM burst.
//
// Trust: the DTLS fingerprint in the offer pins the channel encryption; the
// GPKT frames sent over it are still verified by the Rust core (CRC32, then
// Ed25519), and E2EE frames stay sealed. A neighbour who answers first only
// gets frames anyone in the room could already film or record.
//
// Untrusted input: a scanned code is parsed field by field against strict
// patterns and the SDP is rebuilt from those fields, so a crafted QR cannot
// inject SDP lines.
import jsQR from "jsqr";

export const LAN_PREFIX = "GPLAN1";
/** Largest message accepted on the channel: one GPKT v2 frame. */
export const LAN_MAX_MESSAGE = 131_150;
const MAX_CANDIDATES = 4;
const MAX_FRAMES_PER_SECOND = 20;
const GATHER_TIMEOUT_MS = 3000;

export type LanRole = "o" | "a";

export interface LanSignal {
  role: LanRole;
  ufrag: string;
  pwd: string;
  /** SHA-256 DTLS certificate fingerprint, 64 hex digits. */
  fingerprint: string;
  setup: "actpass" | "active" | "passive";
  /** Host candidates only (same LAN): "foundation component udp priority address port typ host". */
  candidates: string[];
}

const UFRAG = /^[A-Za-z0-9+/]{4,64}$/;
const PWD = /^[A-Za-z0-9+/]{22,128}$/;
const FP = /^[0-9A-F]{64}$/;
const CANDIDATE = /^([A-Za-z0-9+/]{1,32}) 1 (udp|UDP) (\d{1,10}) ([A-Za-z0-9.:-]{1,64}) (\d{1,5}) typ host$/;
/** Browser mDNS host name (a UUID under .local). */
const MDNS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.local$/i;

/**
 * Local-network addresses only: a crafted code must not make the browser send
 * ICE checks (or a DNS lookup) to a host on the Internet.
 */
function localAddress(addr: string): boolean {
  if (MDNS.test(addr)) return true;
  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (v4.slice(1).some((x) => Number(x) > 255)) return false;
    return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  if (/^[0-9a-f:]+$/i.test(addr) && addr.includes(":")) {
    const first = parseInt(addr.split(":")[0] || "0", 16);
    return (first & 0xffc0) === 0xfe80 || (first & 0xfe00) === 0xfc00;
  }
  return false;
}

/** Normalized candidate ("udp" lowercase) if it is a LAN host candidate, else null. */
function lanCandidate(c: string): string | null {
  const m = c.match(CANDIDATE);
  if (!m) return null;
  const [, foundation, , priority, address, port] = m as unknown as [string, string, string, string, string, string];
  const p = Number(port);
  if (Number(priority) > 0xffff_ffff || p < 1 || p > 65_535 || !localAddress(address)) return null;
  return `${foundation} 1 udp ${priority} ${address} ${p} typ host`;
}

function line(sdp: string, key: string): string | null {
  for (const l of sdp.split(/\r?\n/)) if (l.startsWith(`a=${key}:`)) return l.slice(key.length + 3).trim();
  return null;
}

/** Extracts the fields a data-channel-only SDP needs. */
export function compactSdp(sdp: string, role: LanRole): LanSignal {
  const fpLine = line(sdp, "fingerprint") ?? "";
  const [algo, fp] = fpLine.split(" ");
  const setup = (line(sdp, "setup") ?? (role === "o" ? "actpass" : "active")) as LanSignal["setup"];
  const candidates: string[] = [];
  for (const l of sdp.split(/\r?\n/)) {
    if (!l.startsWith("a=candidate:")) continue;
    // Drop extensions (generation, network-id, network-cost…).
    const c = lanCandidate(l.slice("a=candidate:".length).split(" ").slice(0, 8).join(" "));
    if (c && candidates.length < MAX_CANDIDATES) candidates.push(c);
  }
  if (algo !== "sha-256" || !fp) throw new Error("No SHA-256 DTLS fingerprint in the local description");
  return { role, ufrag: line(sdp, "ice-ufrag") ?? "", pwd: line(sdp, "ice-pwd") ?? "", fingerprint: fp.replace(/:/g, "").toUpperCase(), setup, candidates };
}

export function encodeSignal(s: LanSignal): string {
  return [LAN_PREFIX, s.role, s.ufrag, s.pwd, s.fingerprint, s.setup, s.candidates.join(",")].join("|");
}

export type ParsedSignal = { ok: true; signal: LanSignal } | { ok: false; reason: string };

/** Strict parser for a scanned or heard code. */
export function parseSignal(text: string, expected: LanRole): ParsedSignal {
  if (text.length > 1024) return { ok: false, reason: "Code too long" };
  const parts = text.trim().split("|");
  if (parts.length !== 7 || parts[0] !== LAN_PREFIX) return { ok: false, reason: "Not a GhostPacket LAN code" };
  const [, role, ufrag, pwd, fingerprint, setup, cands] = parts as [string, string, string, string, string, string, string];
  if (role !== expected) return { ok: false, reason: expected === "o" ? "This is an answer, not an offer" : "This is an offer, not an answer" };
  if (!UFRAG.test(ufrag) || !PWD.test(pwd) || !FP.test(fingerprint)) return { ok: false, reason: "Malformed ICE credentials or fingerprint" };
  if (setup !== "actpass" && setup !== "active" && setup !== "passive") return { ok: false, reason: "Malformed DTLS role" };
  const raw = cands ? cands.split(",") : [];
  if (raw.length === 0) return { ok: false, reason: "No local network address in the code: join the same Wi-Fi or hotspot" };
  if (raw.length > MAX_CANDIDATES) return { ok: false, reason: "Too many network candidates" };
  const candidates = raw.map(lanCandidate);
  if (candidates.some((c) => c === null)) return { ok: false, reason: "Network candidate outside the local network, or malformed" };
  return { ok: true, signal: { role, ufrag, pwd, fingerprint, setup, candidates: candidates as string[] } };
}

/** Rebuilds a data-channel SDP from validated fields only. */
export function expandSignal(s: LanSignal): RTCSessionDescriptionInit {
  const fp = s.fingerprint.match(/.{2}/g)?.join(":") ?? "";
  const lines = [
    "v=0",
    "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    ...s.candidates.map((c) => `a=candidate:${c}`),
    `a=ice-ufrag:${s.ufrag}`,
    `a=ice-pwd:${s.pwd}`,
    "a=ice-options:trickle",
    `a=fingerprint:sha-256 ${fp}`,
    `a=setup:${s.setup}`,
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  return { type: s.role === "o" ? "offer" : "answer", sdp: lines.join("\r\n") + "\r\n" };
}

export type LanState = "gathering" | "waiting" | "connecting" | "open" | "closed" | "failed";

function gathered(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    const done = () => {
      if (pc.iceGatheringState === "complete") resolve();
    };
    pc.addEventListener("icegatheringstatechange", done);
    setTimeout(resolve, GATHER_TIMEOUT_MS);
  });
}

/** One end of a LAN link. Create with `LanLink.offer()` or `LanLink.answer(code)`. */
export class LanLink {
  private channel: RTCDataChannel | null = null;
  private frameCb: ((frame: Uint8Array) => void) | null = null;
  private stateCb: ((s: LanState, detail?: string) => void) | null = null;

  private constructor(private readonly pc: RTCPeerConnection) {
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") this.emit("failed", "No route between the devices: are they on the same Wi-Fi or hotspot?");
      if (pc.connectionState === "closed") this.emit("closed");
    });
    pc.addEventListener("datachannel", (e) => this.attach(e.channel));
  }

  static supported(): boolean {
    return typeof RTCPeerConnection !== "undefined";
  }

  /** Offering side: returns the code to show (QR) to the other device. */
  static async offer(): Promise<{ link: LanLink; code: string }> {
    // No ICE servers: host candidates only, nothing leaves the local network.
    const link = new LanLink(new RTCPeerConnection({ iceServers: [] }));
    link.attach(link.pc.createDataChannel("gpkt", { ordered: true }));
    await link.pc.setLocalDescription(await link.pc.createOffer());
    await gathered(link.pc);
    const code = encodeSignal(compactSdp(link.pc.localDescription?.sdp ?? "", "o"));
    return { link, code };
  }

  /** Answering side: takes the scanned offer, returns the answer code to send back. */
  static async answer(offerCode: string): Promise<{ link: LanLink; code: string }> {
    const parsed = parseSignal(offerCode, "o");
    if (!parsed.ok) throw new Error(parsed.reason);
    const link = new LanLink(new RTCPeerConnection({ iceServers: [] }));
    await link.pc.setRemoteDescription(expandSignal(parsed.signal));
    await link.pc.setLocalDescription(await link.pc.createAnswer());
    await gathered(link.pc);
    const code = encodeSignal(compactSdp(link.pc.localDescription?.sdp ?? "", "a"));
    link.emit("connecting");
    return { link, code };
  }

  /** Offering side: completes the link with the answer heard or scanned. */
  async accept(answerCode: string): Promise<void> {
    const parsed = parseSignal(answerCode, "a");
    if (!parsed.ok) throw new Error(parsed.reason);
    this.emit("connecting");
    await this.pc.setRemoteDescription(expandSignal(parsed.signal));
  }

  onFrame(cb: (frame: Uint8Array) => void): void {
    this.frameCb = cb;
  }

  onState(cb: (s: LanState, detail?: string) => void): void {
    this.stateCb = cb;
    if (this.channel?.readyState === "open") cb("open");
  }

  get open(): boolean {
    return this.channel?.readyState === "open";
  }

  /** Sends one frame. Throws if the link is not open or the frame is too large. */
  send(frame: Uint8Array): void {
    if (!this.channel || this.channel.readyState !== "open") throw new Error("LAN link not open");
    if (frame.length === 0 || frame.length > LAN_MAX_MESSAGE) throw new Error(`Frame of ${frame.length} bytes outside 1..${LAN_MAX_MESSAGE}`);
    this.channel.send(frame.slice().buffer);
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
  }

  private emit(s: LanState, detail?: string): void {
    this.stateCb?.(s, detail);
  }

  private attach(ch: RTCDataChannel): void {
    // One channel per link: extra channels opened by the peer are closed.
    if (this.channel || ch.label !== "gpkt") {
      ch.close();
      return;
    }
    this.channel = ch;
    ch.binaryType = "arraybuffer";
    ch.addEventListener("open", () => this.emit("open"));
    ch.addEventListener("close", () => this.emit("closed"));
    let windowStart = 0;
    let inWindow = 0;
    ch.addEventListener("message", (e: MessageEvent) => {
      // Bounded before anything else; verification is the app's job (core.verify).
      if (!(e.data instanceof ArrayBuffer) || e.data.byteLength === 0 || e.data.byteLength > LAN_MAX_MESSAGE) return;
      // Each frame costs an Ed25519 check: at most MAX_FRAMES_PER_SECOND reach the app.
      const now = performance.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        inWindow = 0;
      }
      if (++inWindow > MAX_FRAMES_PER_SECOND) return;
      this.frameCb?.(new Uint8Array(e.data));
    });
  }
}

/** Reads QR text from a live camera until `signal` aborts or `accept` returns true. */
export async function scanQrText(video: HTMLVideoElement, accept: (text: string) => boolean, signal: AbortSignal): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false });
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  const canvas = document.createElement("canvas");
  const Detector = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(v: HTMLVideoElement): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
  const native = Detector ? new Detector({ formats: ["qr_code"] }) : null;
  try {
    while (!signal.aborted) {
      let text: string | null = null;
      if (video.readyState >= 2 && video.videoWidth) {
        if (native) {
          const found = await native.detect(video).catch(() => []);
          text = found[0]?.rawValue ?? null;
        } else {
          canvas.width = Math.min(960, video.videoWidth);
          canvas.height = Math.round((canvas.width * video.videoHeight) / video.videoWidth);
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height)?.data ?? null;
          }
        }
      }
      if (text && accept(text)) return;
      await new Promise((r) => setTimeout(r, 120));
    }
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
}
