"use client";

// WebRTC LAN link signaled over the air. No server: the offer travels as a QR
// code, the answer as a QR code or one OFDM chord, then a DataChannel on the
// shared Wi-Fi or hotspot carries the signed frame in milliseconds. Every
// frame received is still verified by the Rust core.
import { useEffect, useRef, useState } from "react";

import { MicReceiver, playBurst } from "ghostpacket-sdk/audio-engine";
import { LanLink, LAN_PREFIX, scanQrText, type LanState } from "ghostpacket-sdk/lan-link";
import { drawQr, readQrFromCanvas } from "ghostpacket-sdk/optical-engine";
import type { Channel } from "ghostpacket-sdk/types";

import type { GhostState } from "./GhostContext";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const tonal = "rounded-lg px-3 py-2.5 text-sm transition disabled:opacity-40";

function useQr(text: string | null) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current && text) drawQr(ref.current, text, 4, 3);
  }, [text]);
  return ref;
}

/** Two peers in this page, signaled through real QR rendering and reading. */
function VirtualLan({ frame, onFrame }: { frame: Uint8Array | null; onFrame: (frame: Uint8Array, channel: Channel) => void }) {
  const [offer, setOffer] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const offerQr = useQr(offer);
  const answerQr = useQr(answer);
  const links = useRef<LanLink[]>([]);
  useEffect(() => () => links.current.forEach((l) => l.close()), []);

  const run = async () => {
    if (!frame) return;
    setRunning(true);
    // ICE over mDNS host candidates occasionally stalls: one fresh attempt before giving up.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const err = await once();
      if (!err) break;
      setStatus(attempt === 1 ? `${err} · retrying with a fresh link…` : err);
    }
    setRunning(false);
  };

  /** One pairing + transfer; returns an error message, or null on success. */
  const once = async (): Promise<string | null> => {
    if (!frame) return "No frame";
    links.current.forEach((l) => l.close());
    links.current = [];
    setStatus("gathering local candidates…");
    setOffer(null);
    setAnswer(null);
    const t0 = performance.now();
    try {
      const host = await LanLink.offer();
      links.current.push(host.link);
      setOffer(host.code);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      // The "phone" reads the offer from the pixels of the QR.
      const seenOffer = offerQr.current ? readQrFromCanvas(offerQr.current) : null;
      if (seenOffer !== host.code) throw new Error("Offer QR unreadable");
      const guest = await LanLink.answer(seenOffer);
      links.current.push(guest.link);
      setAnswer(guest.code);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const seenAnswer = answerQr.current ? readQrFromCanvas(answerQr.current) : null;
      if (seenAnswer !== guest.code) throw new Error("Answer QR unreadable");
      const timeout = (what: string) => new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`LAN link: ${what} within 10 s`)), 10_000));
      const received = new Promise<Uint8Array>((resolve) => guest.link.onFrame(resolve));
      const opened = new Promise<void>((resolve, reject) =>
        host.link.onState((s, d) => {
          if (s === "open") resolve();
          if (s === "failed") reject(new Error(d ?? "LAN link failed"));
        }),
      );
      await host.link.accept(seenAnswer);
      await Promise.race([opened, timeout("not open")]);
      const tSend = performance.now();
      host.link.send(frame);
      const got = await Promise.race([received, timeout("no frame")]);
      const ms = performance.now() - tSend;
      setStatus(
        `WebRTC LAN · offer ${host.code.length} chars, answer ${guest.code.length} chars (QR) · link open in ${((tSend - t0) / 1000).toFixed(1)} s · ${(frame.length / 1024).toFixed(1)} KB delivered in ${ms.toFixed(0)} ms`,
      );
      onFrame(got, "lan");
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={() => void run()} disabled={!frame || running || !LanLink.supported()} className="cta-ember px-5 py-3 text-sm font-semibold disabled:opacity-50">
        {running ? "Linking…" : "▶ Send over a virtual WebRTC LAN link (QR signaling)"}
      </button>
      {(offer || answer) && (
        <div className="grid grid-cols-2 gap-3">
          <figure className="flex flex-col items-center gap-1">
            <canvas ref={offerQr} className="pixelated aspect-square w-full max-w-[180px] rounded-sm" aria-label="LAN offer QR" />
            <figcaption className="font-mono text-[10px] text-mute">offer · sender screen</figcaption>
          </figure>
          <figure className="flex flex-col items-center gap-1">
            <canvas ref={answerQr} className="pixelated aspect-square w-full max-w-[180px] rounded-sm" aria-label="LAN answer QR" />
            <figcaption className="font-mono text-[10px] text-mute">answer · receiver screen</figcaption>
          </figure>
        </div>
      )}
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
    </div>
  );
}

/** Real devices: one opens the link and sends, the other joins and receives. */
function FieldLan({ ghost, frame, onFrame }: { ghost: GhostState; frame: Uint8Array | null; onFrame: (frame: Uint8Array, channel: Channel) => void }) {
  const { core } = ghost;
  const [role, setRole] = useState<"host" | "guest" | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [state, setState] = useState<LanState | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<"scan" | "listen" | "play" | null>(null);
  const qr = useQr(code);
  const video = useRef<HTMLVideoElement>(null);
  const link = useRef<LanLink | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mic = useRef<MicReceiver | null>(null);
  const deliver = useRef(onFrame);
  deliver.current = onFrame;

  const reset = () => {
    abort.current?.abort();
    mic.current?.stop();
    mic.current = null;
    link.current?.close();
    link.current = null;
    setRole(null);
    setCode(null);
    setState(null);
    setBusy(null);
  };
  useEffect(() => () => reset(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const watch = (l: LanLink) => {
    l.onState((s, d) => {
      setState(s);
      if (d) setStatus(d);
      if (s === "open") setStatus("LAN link open: frames now travel over the local network, verified on arrival");
    });
    l.onFrame((f) => {
      setStatus(`frame received over the LAN (${f.length} B)`);
      deliver.current(f, "lan");
    });
  };

  const host = async () => {
    reset();
    setRole("host");
    setStatus("gathering local candidates…");
    try {
      const out = await LanLink.offer();
      link.current = out.link;
      watch(out.link);
      setCode(out.code);
      setState("waiting");
      setStatus("Scan this QR with the other device, then read its answer here.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  const acceptAnswer = async (text: string): Promise<boolean> => {
    if (!text.startsWith(`${LAN_PREFIX}|a|`) || !link.current) return false;
    try {
      await link.current.accept(text);
      return true;
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      return false;
    }
  };

  const scanFor = async (accept: (text: string) => Promise<boolean> | boolean) => {
    if (!video.current) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy("scan");
    let done = false;
    // One code at a time: the scan loop keeps running while a code is being applied.
    let inFlight = false;
    try {
      await scanQrText(
        video.current,
        (text) => {
          if (done) return true;
          if (inFlight) return false;
          inFlight = true;
          void Promise.resolve(accept(text))
            .then((ok) => {
              if (ok) {
                done = true;
                ac.abort();
              }
            })
            .finally(() => {
              inFlight = false;
            });
          return false;
        },
        ac.signal,
      );
    } catch (e) {
      setStatus(`Camera unavailable (${e instanceof Error ? e.message : String(e)})`);
    } finally {
      setBusy(null);
    }
  };

  const listenForAnswer = async () => {
    setBusy("listen");
    let taken = false;
    const ear = new MicReceiver(core, "ofdm", {
      onFrame: (bytes) => {
        if (taken) return;
        taken = true;
        void acceptAnswer(decoder.decode(bytes)).then((ok) => {
          taken = ok;
          if (ok) {
            ear.stop();
            setBusy(null);
          }
        });
      },
    });
    mic.current = ear;
    try {
      await ear.start();
      setStatus("listening for the answer chord…");
    } catch (e) {
      setBusy(null);
      setStatus(`Microphone unavailable (${e instanceof Error ? e.message : String(e)})`);
    }
  };

  const join = () => {
    reset();
    setRole("guest");
    setStatus("Point the camera at the sender's LAN QR.");
    void scanFor(async (text) => {
      if (!text.startsWith(`${LAN_PREFIX}|o|`)) return false;
      try {
        const out = await LanLink.answer(text);
        link.current?.close();
        link.current = out.link;
        watch(out.link);
        setCode(out.code);
        setStatus("Show this answer QR to the sender, or play it as a chord.");
        return true;
      } catch (e) {
        setStatus(e instanceof Error ? e.message : String(e));
        return false;
      }
    });
  };

  const playAnswer = async () => {
    if (!code) return;
    setBusy("play");
    try {
      const r = await playBurst(core, encoder.encode(code), "ofdm");
      if (!r.ok) setStatus(`${r.error.code}: ${r.error.message}`);
    } finally {
      setBusy(null);
    }
  };

  const send = () => {
    if (!frame || !link.current) return;
    try {
      link.current.send(frame);
      setStatus(`${frame.length} B sent over the LAN link`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={() => void host()} disabled={!LanLink.supported()} className={`${tonal} ${role === "host" ? "bg-ink/[0.1] font-medium text-ink" : "bg-ink/[0.05] text-mist hover:bg-ink/[0.09]"}`}>
          This device sends · open a link
        </button>
        <button type="button" onClick={join} disabled={!LanLink.supported()} className={`${tonal} ${role === "guest" ? "bg-ink/[0.1] font-medium text-ink" : "bg-ink/[0.05] text-mist hover:bg-ink/[0.09]"}`}>
          This device receives · join a link
        </button>
      </div>
      {code && <canvas ref={qr} className="pixelated aspect-square w-full max-w-[260px] self-center rounded-sm" aria-label={role === "host" ? "LAN offer QR" : "LAN answer QR"} />}
      {role === "host" && state === "waiting" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => void scanFor(acceptAnswer)} disabled={busy !== null} className={`${tonal} bg-ion/10 text-ion hover:bg-ion/20`}>
            Scan the answer QR (camera)
          </button>
          <button type="button" onClick={() => void listenForAnswer()} disabled={busy !== null} className={`${tonal} bg-phosphor/10 text-phosphor hover:bg-phosphor/20`}>
            Listen for the answer (OFDM)
          </button>
        </div>
      )}
      {role === "guest" && code && state !== "open" && (
        <button type="button" onClick={() => void playAnswer()} disabled={busy !== null} className={`${tonal} bg-phosphor/10 text-phosphor hover:bg-phosphor/20`}>
          {busy === "play" ? "Playing the answer…" : `Play the answer as an OFDM chord (${core.ofdmBurstSeconds(code.length).toFixed(1)} s)`}
        </button>
      )}
      {role === "host" && state === "open" && (
        <button type="button" onClick={send} disabled={!frame} className="cta-ember px-5 py-3 text-sm font-semibold disabled:opacity-50">
          {frame ? `Send the signed frame over the LAN (${(frame.length / 1024).toFixed(1)} KB)` : "Sign something first"}
        </button>
      )}
      <video ref={video} className={`w-full rounded-lg ${busy === "scan" ? "block" : "hidden"}`} muted playsInline />
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
    </div>
  );
}

export default function LanLinkPanel({
  ghost,
  frame,
  onFrame,
  variant,
}: {
  ghost: GhostState;
  frame: Uint8Array | null;
  onFrame: (frame: Uint8Array, channel: Channel) => void;
  variant: "virtual" | "field";
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-mist">
        Same Wi-Fi or phone hotspot, no Internet: a WebRTC DataChannel with no STUN, TURN or signaling server. The offer and answer (about 250 characters) travel over the air; the frame then crosses the local network in
        milliseconds and is verified like any other.
      </p>
      {variant === "virtual" ? <VirtualLan frame={frame} onFrame={onFrame} /> : <FieldLan ghost={ghost} frame={frame} onFrame={onFrame} />}
    </div>
  );
}
