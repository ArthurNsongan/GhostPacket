// GhostPacketSDK: one facade over the WASM core, Web Audio, canvas QR codes,
// the camera, the anti-replay ledger and the trusted keyring. Third-party
// offline apps can use it without touching the protocol details.
//
//   const gp = await GhostPacketSDK.load();
//   const sealed = gp.sealMessage({ sender: "Clinic", title: "Rx", message: "…" }, { passphrase });
//   if (sealed.ok) await gp.transmitAcoustic(sealed.value.frame);
import { MicReceiver, playBurst, type AcousticTick } from "./audio-engine";
import { readKeyring } from "./keyring";
import { redeem, type LedgerCheck, type LedgerScope } from "./ledger";
import { messageDraft, type MessageInput } from "./messages";
import { broadcast, CameraScanner } from "./optical-engine";
import { FLAG_FOUNTAIN, FLAG_FSK, type Channel, type DocumentDraft, type EncodedFrame, type FskMode, type KeyInfo, type VerifiedFrame } from "./types";
import { loadCore, newSigningSeed, type Core, type Result } from "./wasm-bridge";

export interface SealOptions {
  /** Encrypts the payload end-to-end (ChaCha20-Poly1305, PBKDF2-HMAC-SHA256 key). */
  passphrase?: string;
  /** Extra protocol flags (FSK / FOUNTAIN / DEMO). Default: FSK | FOUNTAIN. */
  flags?: number;
}

export interface VerifyOptions {
  passphrase?: string;
  /** Pinned issuer keys (hex). Default: none (trust on first use). */
  trusted?: string[];
  /** Use every key of the local keyring as the trusted set. */
  strictKeyring?: boolean;
  /** Record in the anti-replay ledger and report replays. */
  ledger?: LedgerScope;
  channel?: Channel;
}

export interface Verified extends VerifiedFrame {
  replay: LedgerCheck | null;
}

export const GPKT_MIME = "application/vnd.ghostpacket";
export const MAX_GPKT_FILE = 512;

export class GhostPacketSDK {
  readonly identity: KeyInfo;

  private constructor(
    readonly core: Core,
    private readonly seed: Uint8Array,
  ) {
    const k = core.keyInfo(seed);
    if (!k.ok) throw new Error(k.error.message);
    this.identity = k.value;
  }

  /** Loads the WASM core and creates an ephemeral signing key for this tab. */
  static async load(seed: Uint8Array = newSigningSeed()): Promise<GhostPacketSDK> {
    return new GhostPacketSDK(await loadCore(), seed);
  }

  static fromCore(core: Core, seed: Uint8Array): GhostPacketSDK {
    return new GhostPacketSDK(core, seed);
  }

  /** Signs a free-form message or a full document draft into a GPKT frame (≤ 512 B). */
  sealMessage(input: MessageInput | DocumentDraft, opts: SealOptions = {}): Result<EncodedFrame> {
    const draft = "body" in input ? input : messageDraft(input);
    return this.core.encode(draft, this.seed, opts.flags ?? FLAG_FSK | FLAG_FOUNTAIN, opts.passphrase);
  }

  /** Full verification, optionally against the keyring and the anti-replay ledger. */
  verifyFrame(bytes: Uint8Array, opts: VerifyOptions = {}): Result<Verified> {
    const trusted = opts.strictKeyring ? readKeyring().map((k) => k.publicKeyHex) : (opts.trusted ?? []);
    const v = this.core.verify(bytes, trusted, opts.passphrase);
    if (!v.ok) return v;
    const replay = opts.ledger ? redeem(opts.ledger, v.value, opts.channel ?? "file") : null;
    return { ok: true, value: { ...v.value, replay } };
  }

  /** Plays the frame on the speaker. Robust mode (15 ms/symbol) is meant for the air. */
  transmitAcoustic(frame: Uint8Array, opts: { mode?: FskMode; volume?: number; signal?: AbortSignal; onTick?: (t: AcousticTick) => void } = {}) {
    return playBurst(this.core, frame, opts.mode ?? "robust", opts);
  }

  /** Listens on the microphone until frames arrive; call `stop()` on the result. */
  async receiveAcoustic(opts: { mode?: FskMode; onFrame: (frame: Uint8Array) => void; onTick?: (t: AcousticTick) => void; onStatus?: (s: string) => void }): Promise<MicReceiver> {
    const rx = new MicReceiver(this.core, opts.mode ?? "robust", {
      onFrame: (f) => opts.onFrame(f),
      onTick: opts.onTick,
      onStatus: (s, d) => opts.onStatus?.(d ?? s),
    });
    await rx.start();
    return rx;
  }

  /** Loops fountain droplets as QR codes on `canvas` until `signal` aborts. */
  transmitOptical(frame: Uint8Array, canvas: HTMLCanvasElement, signal: AbortSignal, fps = 8) {
    return broadcast(this.core, frame, canvas, fps, signal);
  }

  /** Scans QR droplets from the rear camera; resolves the rebuilt frame through `onFrame`. */
  async receiveOptical(video: HTMLVideoElement, onFrame: (frame: Uint8Array) => void): Promise<CameraScanner> {
    const rx = this.core.fountainRx();
    const scanner = new CameraScanner(video, rx, (step) => {
      if (step.ok && step.value.complete) {
        const f = rx.frame();
        if (f.ok) onFrame(f.value);
        rx.reset();
      }
    });
    await scanner.start();
    return scanner;
  }

  /** A `.gpkt` file is the raw frame: it starts with the "GPKT" magic. */
  exportGpktFile(frame: Uint8Array, name = "document.gpkt"): File {
    return new File([frame.slice().buffer], name, { type: GPKT_MIME });
  }

  async importGpktFile(file: Blob): Promise<Result<Uint8Array>> {
    if (file.size > MAX_GPKT_FILE) {
      return { ok: false, error: { code: "FRAME_TOO_LARGE", message: `File of ${file.size} bytes > 512-byte frame limit` } };
    }
    return { ok: true, value: new Uint8Array(await file.arrayBuffer()) };
  }
}

/** Triggers a browser download of a `.gpkt` file (no network involved). */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
