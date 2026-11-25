"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { runAcousticLoopback, type AcousticTick } from "ghostpacket-sdk/audio-engine";
import { BLOCKED_CAMERA_LOSS, runChimeraRace, type RaceLane, type Sabotage } from "ghostpacket-sdk/chimera";
import { DEMO_FLAGS, runFullDemo, type DemoStep } from "ghostpacket-sdk/demo-runner";
import { emitLevel } from "ghostpacket-sdk/effects";
import { clearLedger, redeem, type LedgerCheck } from "ghostpacket-sdk/ledger";
import { messageBudget, messageDraft, newDocId, type MessageInput } from "ghostpacket-sdk/messages";
import { runOpticalLoopback, type OpticalTick } from "ghostpacket-sdk/optical-engine";
import { presetById } from "ghostpacket-sdk/presets";
import { downloadFile } from "ghostpacket-sdk/sdk";
import { attack, curseByte, type AttackKind, type AttackOutcome, type LabContext } from "ghostpacket-sdk/tamper-lab";
import type { Channel, DocumentDraft, EncodedFrame, FrameInspection, KeyInfo, VerifiedFrame } from "ghostpacket-sdk/types";
import { sfx } from "ghostpacket-sdk/ui-sfx";
import { medianMs, type Core, type Result } from "ghostpacket-sdk/wasm-bridge";

import type { GhostState } from "./AppShell";
import ChannelControls, { type ChannelSettings } from "ghostpacket-ui/ChannelControls";
import CryptLedger from "ghostpacket-ui/CryptLedger";
import type { ConduitSink } from "ghostpacket-ui/EtherConduit";
import FountainGridCanvas, { EMPTY_FOUNTAIN, type DropletFate, type FountainView } from "ghostpacket-ui/FountainGridCanvas";
import FrameInspector from "ghostpacket-ui/FrameInspector";
import JudgeQuickDemoBar, { type Kpi } from "./JudgeQuickDemoBar";
import { encryptionBlocked, type EncryptionSetting } from "ghostpacket-ui/MessageComposer";
import PayloadComposer, { type Source } from "ghostpacket-ui/PayloadComposer";
import ResultCard from "ghostpacket-ui/ResultCard";
import SpectrogramCanvas, { type SignalSink } from "ghostpacket-ui/SpectrogramCanvas";
import TamperLab from "ghostpacket-ui/TamperLab";

interface Verdict {
  channel: string;
  verification: Result<VerifiedFrame>;
  detail?: string;
  replay?: LedgerCheck | null;
}

interface InspectorState {
  title: string;
  frame: Uint8Array;
  inspection: FrameInspection;
  flipped: { byte: number; bit: number } | null;
}

type LaneState = { status: "idle" | "running" | "won" | "second" | "failed"; detail: string; ms: number };
const IDLE_LANE: LaneState = { status: "idle", detail: "", ms: 0 };

const DEFAULT_MESSAGE: MessageInput = {
  sender: "Fatou Ndiaye, treasurer",
  title: "Meeting moved",
  message: "The Médina tontine meets Saturday at 10:00 under the baobab. Bring your card. — signed offline, no network.",
};

/** Public demo value, labelled as such in the UI. */
const DEMO_PASSPHRASE = "baobab moon harmattan";

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export default function DualCanvasWorkbench({ ghost }: { ghost: GhostState }) {
  const { core, seed, keyInfo } = ghost;
  return <Workbench core={core} seed={seed} keyInfo={keyInfo} />;
}

function Workbench({ core, seed, keyInfo }: { core: Core; seed: Uint8Array; keyInfo: KeyInfo }) {
  const [source, setSource] = useState<Source>("tontine");
  const [draftText, setDraftText] = useState(() => JSON.stringify(presetById("tontine").draft, null, 2));
  const [message, setMessage] = useState<MessageInput>(DEFAULT_MESSAGE);
  const [msgDocId] = useState(() => newDocId());
  const [encryption, setEncryption] = useState<EncryptionSetting>({ on: false, passphrase: DEMO_PASSPHRASE });
  const [settings, setSettings] = useState<ChannelSettings>({ snrDb: 10, dropPct: 30, fps: 12, playAudio: true });

  const [syncLocked, setSyncLocked] = useState(false);
  const [acousticProgress, setAcousticProgress] = useState(0);
  const [acousticInfo, setAcousticInfo] = useState("");
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const [fates, setFates] = useState<DropletFate[]>([]);
  const [qrCaption, setQrCaption] = useState("idle");
  const [verdict, setVerdictState] = useState<(Verdict & { seq: number }) | null>(null);
  const verdictSeq = useRef(0);
  const setVerdict = (v: Verdict | null) => setVerdictState(v ? { ...v, seq: ++verdictSeq.current } : null);
  const [inspector, setInspector] = useState<InspectorState | null>(null);
  const [lab, setLab] = useState<AttackOutcome | null>(null);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<DemoStep>("idle");
  const [demoRunning, setDemoRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);

  const [lanes, setLanes] = useState<Record<RaceLane, LaneState>>({ sound: IDLE_LANE, light: IDLE_LANE });
  const [racing, setRacing] = useState(false);
  const [sabotage, setSabotageState] = useState<Sabotage>({ jamAudio: false, blockCamera: false });
  const sabotageRef = useRef<Sabotage>(sabotage);
  const setSabotage = (s: Sabotage) => {
    sabotageRef.current = s;
    setSabotageState(s);
  };

  const spectro = useRef<SignalSink>(null);
  const conduit = useRef<ConduitSink>(null);
  const qrCanvas = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);
  const demoStart = useRef(0);
  const lastReplay = useRef<Partial<Record<Channel, LedgerCheck | null>>>({});
  const autoRun = useRef(false);

  const trusted = useMemo(() => [keyInfo.publicKeyHex], [keyInfo]);
  const passphrase = encryption.on && encryption.passphrase ? encryption.passphrase : undefined;
  // Encryption on with no passphrase: never fall back to sending in clear.
  const blocked = encryptionBlocked(encryption);

  // Source → draft.
  const { draft, draftError } = useMemo((): { draft: DocumentDraft | null; draftError: string | null } => {
    if (source === "message") {
      const b = messageBudget(message, core.limits);
      if (!b.ok) {
        const over = b.fields.find((f) => f.used > f.max);
        return { draft: null, draftError: over ? `FIELD_TOO_LONG: ${over.name} is ${over.used} bytes (max ${over.max})` : "The message is empty" };
      }
      return { draft: messageDraft(message, msgDocId), draftError: null };
    }
    try {
      return { draft: JSON.parse(draftText) as DocumentDraft, draftError: null };
    } catch (e) {
      return { draft: null, draftError: `Invalid JSON: ${(e as Error).message}` };
    }
  }, [source, message, msgDocId, draftText, core]);

  // Draft → signed frame. Encryption runs PBKDF2, so it is debounced while typing.
  const [encoded, setEncoded] = useState<Result<EncodedFrame> | null>(null);
  useEffect(() => {
    if (!draft || blocked) return setEncoded(null);
    const id = window.setTimeout(() => setEncoded(core.encode(draft, seed, DEMO_FLAGS, passphrase)), passphrase ? 250 : 0);
    return () => window.clearTimeout(id);
  }, [core, draft, seed, passphrase, blocked]);
  const encodeError = encoded && !encoded.ok ? `${encoded.error.code}: ${encoded.error.message}` : null;
  const jsonBytes = useMemo(() => new TextEncoder().encode(JSON.stringify(draft ?? {})).length, [draft]);
  const frame = encoded?.ok ? encoded.value.frame : null;

  useEffect(() => {
    if (frame) {
      setInspector({ title: "emitted frame", frame, inspection: core.inspect(frame, passphrase), flipped: null });
      setLab(null);
    }
  }, [core, frame, passphrase]);

  useEffect(() => {
    if (!demoRunning && !racing) return;
    const id = window.setInterval(() => setElapsedMs(performance.now() - demoStart.current), 100);
    return () => window.clearInterval(id);
  }, [demoRunning, racing]);

  /** Receiver: full verification with the shared passphrase, then the anti-replay ledger. */
  const receive = useCallback(
    (bytes: Uint8Array, channel: Channel): Result<VerifiedFrame> => {
      const v = core.verify(bytes, trusted, passphrase);
      lastReplay.current[channel] = v.ok ? redeem("sim", v.value, channel) : null;
      return v;
    },
    [core, trusted, passphrase],
  );

  const chooseSource = (s: Source) => {
    setSource(s);
    if (s !== "message") setDraftText(JSON.stringify(presetById(s).draft, null, 2));
    setVerdict(null);
  };

  const resetReceivers = () => {
    setSyncLocked(false);
    setAcousticProgress(0);
    setAcousticInfo("");
    setFountain(EMPTY_FOUNTAIN);
    setFates([]);
    setVerdict(null);
    spectro.current?.clear();
    conduit.current?.clear();
  };

  const onAcousticTick = useCallback((t: AcousticTick) => {
    spectro.current?.push(t.window, t.sampleRate);
    conduit.current?.wave(t.window);
    emitLevel(t.window);
    setSyncLocked((was) => {
      if (!was && t.syncLocked) void sfx("lock");
      return t.syncLocked;
    });
    setAcousticProgress(t.total ? t.cursor / t.total : 0);
  }, []);

  const onOpticalTick = useCallback((t: OpticalTick) => {
    const fate: DropletFate = t.dropped ? "drop" : t.unreadable ? "unreadable" : t.error ? "error" : t.step?.duplicate ? "duplicate" : "ok";
    setFates((f) => [...f, fate]);
    conduit.current?.orb(fate);
    if (fate === "ok") void sfx("droplet");
    setQrCaption(`droplet #${t.index} · QR ${t.modules}×${t.modules}`);
    if (t.step) {
      const s = t.step;
      setFountain((v) => ({
        k: s.totalK,
        decoded: s.decoded,
        flash: s.newlyResolved,
        cascadeDepth: Math.max(v.cascadeDepth, s.cascadeDepth),
        byElimination: v.byElimination || s.solvedByElimination,
        shown: t.index + 1,
        received: s.dropletsReceived,
        pending: s.pending,
        complete: s.complete,
      }));
    } else {
      setFountain((v) => ({ ...v, shown: t.index + 1, flash: [] }));
    }
  }, []);

  const sendFsk = async () => {
    if (!frame) return;
    resetReceivers();
    setBusy(true);
    abort.current = new AbortController();
    try {
      const out = await runAcousticLoopback(core, frame, {
        mode: "fast",
        snrDb: settings.snrDb,
        seed: Date.now() & 0xffff,
        playAudio: settings.playAudio,
        signal: abort.current.signal,
        onTick: onAcousticTick,
      });
      if (out.result.ok) {
        const r = out.result.value;
        setAcousticInfo(`symbol SNR ${r.meanSymbolSnrDb.toFixed(1)} dB · ${r.correctedBytes} byte(s) fixed by RS`);
        setVerdict({ channel: "4-FSK sound", verification: receive(r.frame, "sound"), replay: lastReplay.current.sound, detail: `${r.symbols} symbols, preamble score ${r.preambleScore.toFixed(2)}` });
      } else {
        setVerdict({ channel: "4-FSK sound", verification: out.result });
      }
    } catch (e) {
      if (!isAbort(e)) throw e;
    } finally {
      setBusy(false);
    }
  };

  const sendQr = async () => {
    if (!frame || !qrCanvas.current) return;
    resetReceivers();
    setBusy(true);
    abort.current = new AbortController();
    try {
      const out = await runOpticalLoopback(core, frame, {
        fps: settings.fps,
        dropPct: settings.dropPct,
        seed: Date.now() & 0xffff,
        canvas: qrCanvas.current,
        signal: abort.current.signal,
        onTick: onOpticalTick,
      });
      setVerdict({
        channel: "fountain QR",
        verification: out.result.ok ? receive(out.result.value, "light") : out.result,
        replay: out.result.ok ? lastReplay.current.light : null,
        detail: `${out.received} droplets received of ${out.shown} shown (K = ${out.k}), ${(out.elapsedMs / 1000).toFixed(1)} s`,
      });
    } catch (e) {
      if (!isAbort(e)) throw e;
    } finally {
      setBusy(false);
    }
  };

  const labCtx = (): LabContext | null => (frame && draft ? { core, frame, draft, trusted, passphrase, flags: DEMO_FLAGS } : null);

  const showAttack = (o: AttackOutcome | null) => {
    if (!o) return;
    setLab(o);
    setInspector({ title: o.title.toLowerCase(), frame: o.frame, inspection: o.inspection, flipped: o.flipped });
    setVerdict({ channel: o.title.toLowerCase(), verification: o.verification });
  };
  const onAttack = (kind: Exclude<AttackKind, "byte">) => {
    const ctx = labCtx();
    if (ctx) showAttack(attack(ctx, kind));
  };
  const onCurseByte = (byte: number) => {
    const ctx = labCtx();
    if (ctx) showAttack(curseByte(ctx, byte));
  };
  const restore = () => {
    if (!frame) return;
    setLab(null);
    setInspector({ title: "emitted frame", frame, inspection: core.inspect(frame, passphrase), flipped: null });
    setVerdict(null);
  };

  const exportGpkt = () => {
    if (!frame || !encoded?.ok) return;
    downloadFile(ghostFile(frame, encoded.value.fingerprint));
  };

  const runDemo = async () => {
    if (!draft || !qrCanvas.current) return;
    resetReceivers();
    clearLedger("sim");
    setSummary(null);
    setBusy(true);
    setDemoRunning(true);
    demoStart.current = performance.now();
    setElapsedMs(0);
    abort.current = new AbortController();
    try {
      const res = await runFullDemo(
        core,
        { draft, seed, passphrase, verify: receive, ...settings, qrCanvas: qrCanvas.current, signal: abort.current.signal },
        {
          onStep: setStep,
          onEncoded: () => undefined,
          onAcousticTick,
          onAcousticDone: (out, v) => {
            if (out.result.ok) {
              const r = out.result.value;
              setAcousticInfo(`symbol SNR ${r.meanSymbolSnrDb.toFixed(1)} dB · ${r.correctedBytes} byte(s) fixed by RS`);
            }
            setVerdict({ channel: "4-FSK sound", verification: v ?? (out.result.ok ? { ok: false, error: { code: "VERIFY", message: "?" } } : out.result), replay: lastReplay.current.sound });
          },
          onOpticalTick,
          onOpticalDone: (out, v) => {
            setVerdict({
              channel: "fountain QR",
              verification: v ?? (out.result.ok ? { ok: false, error: { code: "VERIFY", message: "?" } } : out.result),
              replay: lastReplay.current.light,
              detail: `${out.received} droplets received of ${out.shown} shown (K = ${out.k})`,
            });
          },
          onTamper: (t) => {
            setInspector({ title: "corrupted frame", frame: t.frame, inspection: t.inspection, flipped: { byte: t.byte, bit: t.bit } });
            setVerdict({ channel: "corrupted frame (1 bit)", verification: t.verification });
          },
        },
      );
      setElapsedMs(res.totalMs);
      setSummary(
        res.ok
          ? `Full scenario in ${(res.totalMs / 1000).toFixed(1)} s: frame verified over sound and over light${passphrase ? " (end-to-end encrypted)" : ""}, second delivery flagged by the anti-replay ledger, 1-bit curse rejected.`
          : `Failed at step "${res.failedAt}": ${res.message}`,
      );
    } catch (e) {
      if (isAbort(e)) {
        setStep("idle");
        setSummary("Demo stopped.");
      } else {
        throw e;
      }
    } finally {
      setBusy(false);
      setDemoRunning(false);
    }
  };

  const runRace = async () => {
    if (!frame || !qrCanvas.current) return;
    resetReceivers();
    clearLedger("sim");
    setSabotage({ jamAudio: false, blockCamera: false });
    setLanes({ sound: { status: "running", detail: "", ms: 0 }, light: { status: "running", detail: "", ms: 0 } });
    setSummary(null);
    setBusy(true);
    setRacing(true);
    demoStart.current = performance.now();
    abort.current = new AbortController();
    try {
      const res = await runChimeraRace(
        core,
        frame,
        { ...settings, qrCanvas: qrCanvas.current, signal: abort.current.signal, seed: crypto.getRandomValues(new Uint32Array(1))[0] ?? 1 },
        () => sabotageRef.current,
        (bytes, lane) => receive(bytes, lane),
        {
          onAcousticTick,
          onOpticalTick,
          onLaneDone: (r, won) => {
            setLanes((l) => ({ ...l, [r.lane]: { status: won ? "won" : r.ok ? "second" : "failed", detail: r.detail, ms: r.ms } }));
            if (r.verification) setVerdict({ channel: `${r.lane === "sound" ? "4-FSK sound" : "fountain QR"} (race)`, verification: r.verification, replay: lastReplay.current[r.lane], detail: r.detail });
          },
        },
      );
      const sab = sabotageRef.current;
      const won = res.results.find((r) => r.lane === res.winner);
      const despite =
        res.winner === "light" && sab.blockCamera
          ? ` despite ${BLOCKED_CAMERA_LOSS} % of QR frames blocked (fountain codes only need enough droplets, not specific ones)`
          : res.winner === "sound" && sab.jamAudio
            ? " despite the jammer"
            : "";
      setSummary(
        res.winner
          ? `Chimera race: ${res.winner} delivered the verified frame first in ${((won?.ms ?? 0) / 1000).toFixed(1)} s${despite}${res.results.some((r) => !r.ok) ? "; the sabotaged channel failed and the other one carried the document" : ""}.`
          : "Chimera race: both channels were killed. No frame arrived.",
      );
    } catch (e) {
      if (!isAbort(e)) throw e;
      setSummary("Race stopped.");
    } finally {
      setBusy(false);
      setRacing(false);
    }
  };

  // "Launch 20 s simulation" from the home page: /simulation/?run=1.
  useEffect(() => {
    if (autoRun.current || !frame || busy) return;
    if (new URLSearchParams(window.location.search).get("run") === "1") {
      autoRun.current = true;
      window.history.replaceState(null, "", window.location.pathname);
      void runDemo();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, busy]);

  const cancel = () => abort.current?.abort();

  const encMs = medianMs(passphrase ? "encode_encrypted" : "encode");
  const verMs = medianMs(passphrase ? "verify_encrypted" : "verify");
  const kpis: Kpi[] = [
    { label: passphrase ? "Encode + E2EE" : "Encode", value: encMs === null ? "–" : `${encMs.toFixed(2)} ms`, good: encMs !== null && encMs < (passphrase ? 500 : 15) },
    { label: passphrase ? "Decrypt + verify" : "Ed25519 verify", value: verMs === null ? "–" : `${verMs.toFixed(2)} ms`, good: verMs !== null && verMs < (passphrase ? 500 : 15) },
    { label: "Frame", value: encoded?.ok ? `${encoded.value.frameLen} / 512 B` : "–", good: encoded?.ok },
    { label: "QR received / shown", value: fountain.shown ? `${fountain.received} / ${fountain.shown}` : "–", good: fountain.complete },
  ];

  const laneBadge = (lane: RaceLane) => {
    const l = lanes[lane];
    const tone = l.status === "won" ? "bg-phosphor text-void" : l.status === "second" ? "bg-phosphor/15 text-phosphor" : l.status === "failed" ? "bg-alarm text-void" : l.status === "running" ? "bg-ion/15 text-ion" : "bg-void/70 text-mute";
    const text = l.status === "won" ? `WINNER · ${(l.ms / 1000).toFixed(1)} s` : l.status === "second" ? `2nd · ${(l.ms / 1000).toFixed(1)} s` : l.status === "failed" ? "LOST" : l.status === "running" ? "racing…" : "ready";
    return <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-bold ${tone}`}>{text}</span>;
  };

  return (
    <div className="flex flex-col gap-4">
      <JudgeQuickDemoBar
        step={step}
        running={demoRunning}
        elapsedMs={elapsedMs}
        onRun={runDemo}
        onCancel={cancel}
        kpis={kpis}
        summary={summary}
        disabled={(busy && !demoRunning) || !encoded?.ok}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <PayloadComposer
          source={source}
          onSource={chooseSource}
          draftText={draftText}
          onDraftText={setDraftText}
          message={message}
          onMessage={setMessage}
          encryption={encryption}
          onEncryption={setEncryption}
          limits={core.limits}
          draftError={draftError ?? (blocked ? "PASSPHRASE_REQUIRED: enter a passphrase or turn encryption off" : encodeError)}
          demoPassphrase={encryption.passphrase === DEMO_PASSPHRASE}
          encoded={encoded}
          jsonBytes={jsonBytes}
          qrCanvasRef={qrCanvas}
          qrCaption={qrCaption}
          onSendFsk={sendFsk}
          onSendQr={sendQr}
          onExport={exportGpkt}
          busy={busy}
        />

        <ChannelControls settings={settings} onChange={setSettings} conduitRef={conduit} fates={fates} busy={busy} acousticProgress={acousticProgress}>
          <div className="rounded-lg border border-ion/40 bg-ion/5 p-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-widest text-ion">Chimera dual-channel race</span>
              <span className="font-mono text-[10px] text-mute">sound ∥ light</span>
            </div>
            <p className="mt-1 text-[12px] text-mist">Both channels at once. Kill one mid-flight: the other still delivers a verified frame.</p>
            <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[11px]">
              <div className="flex items-center justify-between rounded-md border border-grid px-2 py-1">
                <span>Sound</span>
                {laneBadge("sound")}
              </div>
              <div className="flex items-center justify-between rounded-md border border-grid px-2 py-1">
                <span>Light</span>
                {laneBadge("light")}
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              <button type="button" onClick={racing ? cancel : runRace} disabled={(busy && !racing) || !frame} className="rounded-md bg-ion/90 px-2 py-2 text-[12px] font-semibold text-void hover:bg-ion disabled:opacity-40">
                {racing ? "Stop" : "Start race"}
              </button>
              <button
                type="button"
                onClick={() => setSabotage({ ...sabotageRef.current, jamAudio: true })}
                disabled={!racing || sabotage.jamAudio || lanes.sound.status !== "running"}
                className="rounded-md border border-alarm/60 px-2 py-2 text-[11px] text-alarm hover:bg-alarm/10 disabled:opacity-40"
              >
                Jam audio −25 dB
              </button>
              <button
                type="button"
                onClick={() => setSabotage({ ...sabotageRef.current, blockCamera: true })}
                disabled={!racing || sabotage.blockCamera || lanes.light.status !== "running"}
                className="rounded-md border border-alarm/60 px-2 py-2 text-[11px] text-alarm hover:bg-alarm/10 disabled:opacity-40"
              >
                Block camera {BLOCKED_CAMERA_LOSS} %
              </button>
            </div>
          </div>
          <TamperLab onAttack={onAttack} onRestore={restore} last={lab} encrypted={!!passphrase} disabled={busy || !frame} />
        </ChannelControls>

        <section className="panel flex flex-col gap-4 p-4" aria-labelledby="receiver-title">
          <div className="flex items-baseline justify-between">
            <h2 id="receiver-title" className="panel-title">
              ③ Receiver
            </h2>
            <span className="font-mono text-[10px] text-mute">keyring: {keyInfo.fingerprint}</span>
          </div>
          <div>
            <SpectrogramCanvas core={core} ref={spectro} syncLocked={syncLocked} caption="FFT 1024 · Hann · WASM" />
            <p className="mt-1 h-4 font-mono text-[11px] text-mute">{acousticInfo}</p>
          </div>
          <div className="rounded-lg border border-grid bg-void/40 p-3">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] uppercase tracking-widest text-mute">LT fountain decoder</span>
              <span className="font-mono text-[10px] text-mute">peeling + Gauss GF(2)</span>
            </div>
            <FountainGridCanvas view={fountain} />
          </div>
          <ResultCard key={verdict?.seq ?? 0} verification={verdict?.verification ?? null} channel={verdict?.channel ?? "sound or QR"} detail={verdict?.detail} replay={verdict?.replay} />
        </section>
      </div>

      <FrameInspector frame={inspector?.frame ?? null} inspection={inspector?.inspection ?? null} flipped={inspector?.flipped} title={inspector?.title ?? ""} onCurseByte={busy ? undefined : onCurseByte} />

      <CryptLedger scope="sim" note="Simulation ledger, reset at the start of each 1-click demo or race. The second channel delivering the same document is flagged as a replay." />
    </div>
  );
}

function ghostFile(frame: Uint8Array, fingerprint: string): File {
  return new File([frame.slice().buffer], `ghostpacket-${fingerprint.toLowerCase()}.gpkt`, { type: "application/vnd.ghostpacket" });
}
