"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { MicReceiver, playBurst, type MicStatus } from "ghostpacket-sdk/audio-engine";
import { emitLevel } from "ghostpacket-sdk/effects";
import { labelFor, parseIdentity, readKeyring, trustKey } from "ghostpacket-sdk/keyring";
import { redeem, type LedgerCheck } from "ghostpacket-sdk/ledger";
import { messageBudget, messageDraft, newDocId, type MessageInput } from "ghostpacket-sdk/messages";
import { broadcast, CameraScanner } from "ghostpacket-sdk/optical-engine";
import { PRESETS, presetById } from "ghostpacket-sdk/presets";
import { FLAG_FOUNTAIN, FLAG_FSK, type Channel, type DocumentDraft, type EncodedFrame, type FskMode, type VerifiedFrame } from "ghostpacket-sdk/types";
import { muteSfx } from "ghostpacket-sdk/ui-sfx";
import type { FountainReceiver, Result } from "ghostpacket-sdk/wasm-bridge";

import { useShell, type GhostState } from "./AppShell";
import CryptLedger from "ghostpacket-ui/CryptLedger";
import FountainGridCanvas, { EMPTY_FOUNTAIN, type FountainView } from "ghostpacket-ui/FountainGridCanvas";
import { IdentityQr, KeyringPanel } from "ghostpacket-ui/IdentityCard";
import ProofOutboxPanel from "ghostpacket-ui/ProofOutboxPanel";
import MessageComposer, { EncryptionToggle, encryptionBlocked, type EncryptionSetting } from "ghostpacket-ui/MessageComposer";
import type { Source } from "ghostpacket-ui/PayloadComposer";
import ResultCard from "ghostpacket-ui/ResultCard";
import SpectrogramCanvas, { type SignalSink } from "ghostpacket-ui/SpectrogramCanvas";

/** Field frames are real documents: no DEMO flag. */
const FIELD_FLAGS = FLAG_FSK | FLAG_FOUNTAIN;

function permissionProblem(e: unknown): string | null {
  if (e instanceof DOMException && ["NotAllowedError", "NotFoundError", "NotReadableError", "SecurityError", "OverconstrainedError", "NotSupportedError"].includes(e.name)) {
    return e.name;
  }
  if (e instanceof TypeError) return "mediaDevices unavailable (HTTPS required)";
  return null;
}

/** Real PC ↔ phone mode: speaker/screen on one device, microphone/camera on the other (US-05). */
export default function FieldModeView({ ghost }: { ghost: GhostState }) {
  const { core, seed, keyInfo } = ghost;
  const { setBanner } = useShell();
  const router = useRouter();

  const [role, setRole] = useState<"emitter" | "receiver">("emitter");
  const [mode, setMode] = useState<FskMode>("robust");
  const [status, setStatus] = useState("ready");
  const [active, setActive] = useState<"sound" | "qr" | "mic" | "camera" | "identity" | null>(null);

  // Emitter.
  const [source, setSource] = useState<Source>("message");
  const [message, setMessage] = useState<MessageInput>({ sender: "Ndiob Rural Health Post", title: "Prescription ready", message: "Your prescription is signed. Show this screen at the pharmacy." });
  const [docId, setDocId] = useState(() => newDocId());
  const [encryption, setEncryption] = useState<EncryptionSetting>({ on: false, passphrase: "" });
  const [progress, setProgress] = useState(0);
  const [qrIndex, setQrIndex] = useState(0);
  const [fullscreenQr, setFullscreenQr] = useState(false);

  // Receiver.
  const [passphrase, setPassphrase] = useState("");
  const [strict, setStrict] = useState(false);
  const [micStatus, setMicStatus] = useState<MicStatus | null>(null);
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const [verdict, setVerdict] = useState<{ channel: Channel; v: Result<VerifiedFrame>; replay: LedgerCheck | null; seq: number } | null>(null);
  const [locked, setLocked] = useState<{ frame: Uint8Array; channel: Channel } | null>(null);

  const spectro = useRef<SignalSink>(null);
  const qrCanvas = useRef<HTMLCanvasElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const abort = useRef<AbortController | null>(null);
  const mic = useRef<MicReceiver | null>(null);
  const cam = useRef<CameraScanner | null>(null);
  const rx = useRef<FountainReceiver | null>(null);
  const seq = useRef(0);

  const draft = useMemo((): DocumentDraft | null => {
    if (source !== "message") return presetById(source).draft;
    return messageBudget(message, core.limits).ok ? messageDraft(message, docId) : null;
  }, [source, message, docId, core]);
  const pass = encryption.on && encryption.passphrase ? encryption.passphrase : undefined;
  const [encoded, setEncoded] = useState<Result<EncodedFrame> | null>(null);
  useEffect(() => {
    if (!draft || encryptionBlocked(encryption)) return setEncoded(null);
    const id = window.setTimeout(() => setEncoded(core.encode(draft, seed, FIELD_FLAGS, pass)), pass ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [core, draft, seed, pass, encryption]);
  const burstSeconds = encoded?.ok ? core.fskBurstSeconds(encoded.value.frameLen, mode) : 0;

  const stopAll = () => {
    abort.current?.abort();
    abort.current = null;
    mic.current?.stop();
    mic.current = null;
    cam.current?.stop();
    cam.current = null;
    rx.current?.free();
    rx.current = null;
    muteSfx(false);
    setActive(null);
    setFullscreenQr(false);
  };

  useEffect(() => () => stopAll(), []);

  const fallback = (what: string, p: string) => {
    stopAll();
    setBanner(`${what} unavailable (${p}): switched to the virtual loopback.`);
    router.push("/simulation/");
  };

  // Mic/camera callbacks outlive renders: read the latest settings through refs.
  const passRef = useRef(passphrase);
  const strictRef = useRef(strict);
  passRef.current = passphrase;
  strictRef.current = strict;

  const verifyReceived = (frame: Uint8Array, channel: Channel) => {
    const phrase = passRef.current;
    const trusted = strictRef.current ? readKeyring().map((k) => k.publicKeyHex) : [];
    const v = core.verify(frame, trusted, phrase || undefined);
    const replay = v.ok ? redeem("field", v.value, channel) : null;
    // Offline-to-cloud: keep the proof for upload to a verifier (sent only if one is configured).
    if (v.ok) ghost.sdk.queueProof(frame, v.value, channel);
    setVerdict({ channel, v, replay, seq: ++seq.current });
    setLocked(!v.ok && (v.error.code === "PASSPHRASE_REQUIRED" || v.error.code === "DECRYPTION_FAILED") ? { frame, channel } : null);
  };

  // ----- emitter -----
  const emitSound = async () => {
    if (!encoded?.ok) return;
    stopAll();
    setActive("sound");
    setProgress(0);
    abort.current = new AbortController();
    setStatus(`sending sound, ${mode} mode · ${burstSeconds.toFixed(1)} s`);
    try {
      const res = await playBurst(core, encoded.value.frame, mode, {
        signal: abort.current.signal,
        onTick: (t) => {
          spectro.current?.push(t.window, t.sampleRate);
          emitLevel(t.window);
          setProgress(t.total ? t.cursor / t.total : 0);
        },
      });
      setProgress(1);
      setStatus(res.ok ? "burst sent" : `${res.error.code}: ${res.error.message}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setStatus(String(e));
    } finally {
      setActive(null);
    }
  };

  const emitQr = () => {
    if (!encoded?.ok) return;
    stopAll();
    setActive("qr");
    setFullscreenQr(true);
    abort.current = new AbortController();
    const signal = abort.current.signal;
    requestAnimationFrame(() => {
      if (!qrCanvas.current) return;
      broadcast(core, encoded.value.frame, qrCanvas.current, 8, signal, (i) => setQrIndex(i)).catch((e: unknown) => setStatus(String(e)));
    });
  };

  // ----- receiver -----
  const listen = async () => {
    stopAll();
    setVerdict(null);
    setActive("mic");
    muteSfx(true);
    const receiver = new MicReceiver(core, mode, {
      onTick: (t) => {
        spectro.current?.push(t.window, t.sampleRate);
        emitLevel(t.window);
      },
      onStatus: (s, d) => {
        setMicStatus(s);
        if (d) setStatus(d);
      },
      onFrame: (frame, info) => {
        verifyReceived(frame, "sound");
        setStatus(`frame received · symbol SNR ${info.meanSymbolSnrDb.toFixed(1)} dB · ${info.correctedBytes} byte(s) fixed`);
      },
    });
    mic.current = receiver;
    try {
      await receiver.start();
      setStatus(`listening on the microphone (mode ${mode})`);
    } catch (e) {
      const p = permissionProblem(e);
      if (p) fallback("Microphone", p);
      else {
        stopAll();
        setStatus(String(e));
      }
    }
  };

  const startCamera = async (purpose: "camera" | "identity") => {
    stopAll();
    if (purpose === "camera") {
      setVerdict(null);
      setFountain(EMPTY_FOUNTAIN);
    }
    if (!video.current) return;
    setActive(purpose);
    const receiver = core.fountainRx();
    rx.current = receiver;
    let shown = 0;
    const scanner = new CameraScanner(
      video.current,
      receiver,
      (step) => {
        if (purpose !== "camera") return;
        shown++;
        if (!step.ok) return;
        const s = step.value;
        setFountain((v) => ({
          k: s.totalK,
          decoded: s.decoded,
          flash: s.newlyResolved,
          cascadeDepth: Math.max(v.cascadeDepth, s.cascadeDepth),
          byElimination: v.byElimination || s.solvedByElimination,
          shown,
          received: s.dropletsReceived,
          pending: s.pending,
          complete: s.complete,
        }));
        if (s.complete) {
          const frame = receiver.frame();
          if (frame.ok) verifyReceived(frame.value, "light");
          else setVerdict({ channel: "light", v: frame, replay: null, seq: ++seq.current });
          cam.current?.stop();
          cam.current = null;
          setActive(null);
        }
      },
      (text) => {
        if (!text.startsWith("GPKT-KEY:")) return false;
        if (purpose === "identity") {
          const p = parseIdentity(core, text);
          if (p.ok) {
            trustKey(p.key);
            setStrict(true);
            strictRef.current = true;
            setStatus(`pinned "${p.key.label}" · ${p.key.fingerprint} · strict keyring on`);
            stopAll();
          } else {
            setStatus(p.reason);
          }
        } else {
          setStatus("identity QR seen: use “Scan identity QR” to pin it");
        }
        return true;
      },
    );
    cam.current = scanner;
    try {
      await scanner.start();
      setStatus(purpose === "camera" ? `camera on · decoder ${scanner.engine}` : "point the camera at the sender's identity QR");
    } catch (e) {
      const p = permissionProblem(e);
      if (p) fallback("Camera", p);
      else {
        stopAll();
        setStatus(String(e));
      }
    }
  };

  const issuerLabel = verdict?.v.ok ? labelFor(verdict.v.value.fingerprint) : null;

  return (
    <div className="flex flex-col gap-4">
      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-void/60 p-1">
          {(["emitter", "receiver"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                stopAll();
                setRole(r);
              }}
              className={`rounded-md px-4 py-2 text-sm ${role === r ? "bg-ink/[0.08] text-ink font-medium" : "text-mute"}`}
            >
              {r === "emitter" ? "This device sends" : "This device receives"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-mute">Modem</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as FskMode)} className="rounded-md bg-panel-2 px-2 py-1 font-mono text-xs" disabled={active !== null}>
            <option value="robust">robust · 15 ms/symbol</option>
            <option value="fast">fast · 6 ms/symbol</option>
          </select>
        </label>
        <p className="font-mono text-xs text-mute">Both devices must use the same mode. Put the phone in airplane mode once this page has loaded: nothing goes through the network.</p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {role === "emitter" ? (
          <section className="panel flex flex-col gap-4 p-4">
            <h2 className="panel-title">Field emitter</h2>
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-void/60 p-1 sm:grid-cols-4">
              {[{ id: "message" as Source, label: "✎ Your message" }, ...PRESETS.map((p) => ({ id: p.id as Source, label: p.label }))].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={active !== null}
                  onClick={() => setSource(p.id)}
                  className={`rounded-md px-2 py-1.5 text-[12px] ${p.id === source ? "bg-ink/[0.08] text-ink font-medium" : "text-mute"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {source === "message" && (
              <div className="rounded-xl bg-ink/[0.035] p-3">
                <MessageComposer value={message} onChange={setMessage} limits={core.limits} disabled={active !== null} />
                <button type="button" onClick={() => setDocId(newDocId())} className="mt-2 font-mono text-[10px] text-mist hover:text-ink">
                  new document id ({String.fromCharCode(...docId)})
                </button>
              </div>
            )}
            <EncryptionToggle value={encryption} onChange={setEncryption} disabled={active !== null} limits={core.limits} />
            {encoded?.ok ? (
              <p className="font-mono text-xs text-mute">
                Frame {encoded.value.frameLen} B{encoded.value.encrypted ? " · E2EE" : ""} · signed {keyInfo.fingerprint} · burst {burstSeconds.toFixed(1)} s
              </p>
            ) : (
              <p className="font-mono text-xs text-alarm">{encryptionBlocked(encryption) ? "Enter a passphrase or turn encryption off" : encoded ? encoded.error.message : draft ? "sealing…" : "Message empty or too long"}</p>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={active === "sound" ? stopAll : emitSound}
                disabled={!encoded?.ok || (active !== null && active !== "sound")}
                className="rounded-lg bg-phosphor/10 px-3 py-3 text-sm text-phosphor hover:bg-phosphor/20 disabled:opacity-40"
              >
                {active === "sound" ? "Stop sound" : "Send over the speaker"}
              </button>
              <button type="button" onClick={emitQr} disabled={!encoded?.ok || active !== null} className="rounded-lg bg-ion/10 px-3 py-3 text-sm text-ion hover:bg-ion/20 disabled:opacity-40">
                Show the full-screen QR stream
              </button>
            </div>
            <div className="h-1.5 overflow-hidden rounded bg-void" aria-label="Burst progress">
              <div className="h-full bg-phosphor transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
            </div>
            <SpectrogramCanvas core={core} ref={spectro} syncLocked={false} caption="emitted signal" />
            <p className="font-mono text-xs text-mute">Status: {status}</p>
            <IdentityQr keyInfo={keyInfo} />
          </section>
        ) : (
          <section className="panel flex flex-col gap-4 p-4">
            <h2 className="panel-title">Field receiver</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={active === "mic" ? stopAll : listen}
                disabled={active !== null && active !== "mic"}
                className="rounded-lg bg-phosphor/10 px-3 py-3 text-sm text-phosphor hover:bg-phosphor/20 disabled:opacity-40"
              >
                {active === "mic" ? "Stop listening" : "Listen (microphone)"}
              </button>
              <button
                type="button"
                onClick={active === "camera" ? stopAll : () => void startCamera("camera")}
                disabled={active !== null && active !== "camera"}
                className="rounded-lg bg-ion/10 px-3 py-3 text-sm text-ion hover:bg-ion/20 disabled:opacity-40"
              >
                {active === "camera" ? "Stop camera" : "Scan the screen (camera)"}
              </button>
            </div>
            <label className="block text-[12px] text-mist">
              Passphrase for encrypted frames (optional)
              <input
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="off"
                spellCheck={false}
                className="mt-1 w-full rounded-md bg-ink/[0.045] px-2 py-1.5 font-mono text-sm text-ink outline-none focus:bg-ink/[0.08]"
              />
            </label>
            <SpectrogramCanvas core={core} ref={spectro} syncLocked={micStatus === "sync" || micStatus === "decoded"} caption="microphone" />
            <video ref={video} className={`w-full rounded-lg border border-grid ${active === "camera" || active === "identity" ? "block" : "hidden"}`} muted playsInline />
            <FountainGridCanvas view={fountain} />
            <p className="font-mono text-xs text-mute">Status: {status}</p>
            <KeyringPanel core={core} strict={strict} onStrict={setStrict} scanning={active === "identity"} onScan={() => (active === "identity" ? stopAll() : void startCamera("identity"))} />
          </section>
        )}

        <section className="panel flex flex-col gap-3 p-4">
          <h2 className="panel-title">Verdict · verified plaintext</h2>
          <ResultCard
            key={verdict?.seq ?? 0}
            verification={verdict?.v ?? null}
            channel={verdict ? (verdict.channel === "sound" ? "microphone" : "camera") : role === "emitter" ? "(this device sends)" : "microphone or camera"}
            replay={verdict?.replay}
            issuerLabel={issuerLabel}
          />
          {locked && (
            <button
              type="button"
              onClick={() => verifyReceived(locked.frame, locked.channel)}
              disabled={!passphrase}
              className="rounded-lg bg-ion/90 px-3 py-2 text-sm font-semibold text-void hover:bg-ion disabled:opacity-40"
            >
              Unlock with the passphrase above
            </button>
          )}
          <CryptLedger scope="field" note="Persistent on this device. A receipt or voucher presented twice raises REPLAY DETECTED, even offline." />
        </section>
      </div>

      <ProofOutboxPanel ghost={ghost} />

      {fullscreenQr && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#e9fff3]" role="dialog" aria-label="Full-screen QR stream">
          <canvas ref={qrCanvas} className="pixelated aspect-square w-[min(80vh,92vw)]" />
          <p className="font-mono text-sm text-[#04150c]">
            Droplet #{qrIndex} · 8 FPS · {keyInfo.fingerprint}
            {encoded?.ok && encoded.value.encrypted ? " · E2EE" : ""}
          </p>
          <button type="button" onClick={stopAll} className="rounded-lg bg-[#04150c] px-4 py-2 text-sm text-[#e9fff3]">
            Close
          </button>
        </div>
      )}
    </div>
  );
}
