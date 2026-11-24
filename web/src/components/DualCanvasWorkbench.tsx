"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { runAcousticLoopback, type AcousticTick } from "@/lib/audio-engine";
import { DEMO_FLAGS, runFullDemo, tamper, type DemoStep } from "@/lib/demo-runner";
import { runOpticalLoopback, type OpticalTick } from "@/lib/optical-engine";
import { presetById, type Preset } from "@/lib/presets";
import type { DocumentDraft, EncodedFrame, FrameInspection, KeyInfo, VerifiedFrame } from "@/lib/types";
import { medianMs, type Core, type Result } from "@/lib/wasm-bridge";

import ChannelControls, { type ChannelSettings } from "./ChannelControls";
import FountainGridCanvas, { EMPTY_FOUNTAIN, type DropletFate, type FountainView } from "./FountainGridCanvas";
import FrameInspector from "./FrameInspector";
import JudgeQuickDemoBar, { type Kpi } from "./JudgeQuickDemoBar";
import PayloadComposer from "./PayloadComposer";
import ResultCard from "./ResultCard";
import SpectrogramCanvas, { type SignalSink } from "./SpectrogramCanvas";

interface Verdict {
  channel: string;
  verification: Result<VerifiedFrame>;
  detail?: string;
}

interface InspectorState {
  title: string;
  frame: Uint8Array;
  inspection: FrameInspection;
  flipped: { byte: number; bit: number } | null;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

export default function DualCanvasWorkbench({ core, seed, keyInfo }: { core: Core; seed: Uint8Array; keyInfo: KeyInfo }) {
  const [presetId, setPresetId] = useState<Preset["id"]>("tontine");
  const [draftText, setDraftText] = useState(() => JSON.stringify(presetById("tontine").draft, null, 2));
  const [settings, setSettings] = useState<ChannelSettings>({ snrDb: 10, dropPct: 30, fps: 12, playAudio: true });

  const [syncLocked, setSyncLocked] = useState(false);
  const [acousticProgress, setAcousticProgress] = useState(0);
  const [acousticInfo, setAcousticInfo] = useState<string>("");
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const [fates, setFates] = useState<DropletFate[]>([]);
  const [qrCaption, setQrCaption] = useState("idle");
  const [verdict, setVerdictState] = useState<(Verdict & { seq: number }) | null>(null);
  const verdictSeq = useRef(0);
  // New sequence number per verdict, so the seal/shake animation replays.
  const setVerdict = (v: Verdict | null) => setVerdictState(v ? { ...v, seq: ++verdictSeq.current } : null);
  const [inspector, setInspector] = useState<InspectorState | null>(null);

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<DemoStep>("idle");
  const [demoRunning, setDemoRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [summary, setSummary] = useState<string | null>(null);
  const [, setTick] = useState(0);

  const spectro = useRef<SignalSink>(null);
  const scope = useRef<SignalSink>(null);
  const qrCanvas = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);
  const demoStart = useRef(0);

  const trusted = useMemo(() => [keyInfo.publicKeyHex], [keyInfo]);

  // Draft → signed frame (re-encoded on every edit: < 1 ms).
  const { draft, draftError } = useMemo(() => {
    try {
      return { draft: JSON.parse(draftText) as DocumentDraft, draftError: null as string | null };
    } catch (e) {
      return { draft: null, draftError: `Invalid JSON: ${(e as Error).message}` };
    }
  }, [draftText]);

  const encoded = useMemo<Result<EncodedFrame> | null>(() => (draft ? core.encode(draft, seed, DEMO_FLAGS) : null), [core, draft, seed]);
  const encodeError = encoded && !encoded.ok ? `${encoded.error.code}: ${encoded.error.message}` : null;
  const jsonBytes = useMemo(() => new TextEncoder().encode(JSON.stringify(draft ?? {})).length, [draft]);

  useEffect(() => {
    if (encoded?.ok) {
      setInspector({ title: "emitted frame", frame: encoded.value.frame, inspection: core.inspect(encoded.value.frame), flipped: null });
    }
  }, [core, encoded]);

  useEffect(() => {
    if (!demoRunning) return;
    const id = window.setInterval(() => setElapsedMs(performance.now() - demoStart.current), 100);
    return () => window.clearInterval(id);
  }, [demoRunning]);

  const choosePreset = (id: Preset["id"]) => {
    setPresetId(id);
    setDraftText(JSON.stringify(presetById(id).draft, null, 2));
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
    scope.current?.clear();
  };

  const onAcousticTick = useCallback((t: AcousticTick) => {
    spectro.current?.push(t.window, t.sampleRate);
    scope.current?.push(t.window, t.sampleRate);
    setSyncLocked(t.syncLocked);
    setAcousticProgress(t.total ? t.cursor / t.total : 0);
  }, []);

  const onOpticalTick = useCallback((t: OpticalTick) => {
    const fate: DropletFate = t.dropped ? "drop" : t.unreadable ? "unreadable" : t.error ? "error" : t.step?.duplicate ? "duplicate" : "ok";
    setFates((f) => [...f, fate]);
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
    if (!encoded?.ok) return;
    resetReceivers();
    setBusy(true);
    abort.current = new AbortController();
    try {
      const out = await runAcousticLoopback(core, encoded.value.frame, {
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
        setVerdict({ channel: "4-FSK sound", verification: core.verify(r.frame, trusted), detail: `${r.symbols} symbols, preamble score ${r.preambleScore.toFixed(2)}` });
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
    if (!encoded?.ok || !qrCanvas.current) return;
    resetReceivers();
    setBusy(true);
    abort.current = new AbortController();
    try {
      const out = await runOpticalLoopback(core, encoded.value.frame, {
        fps: settings.fps,
        dropPct: settings.dropPct,
        seed: Date.now() & 0xffff,
        canvas: qrCanvas.current,
        signal: abort.current.signal,
        onTick: onOpticalTick,
      });
      setVerdict({
        channel: "fountain QR",
        verification: out.result.ok ? core.verify(out.result.value, trusted) : out.result,
        detail: `${out.received} droplets received of ${out.shown} shown (K = ${out.k}), ${(out.elapsedMs / 1000).toFixed(1)} s`,
      });
    } catch (e) {
      if (!isAbort(e)) throw e;
    } finally {
      setBusy(false);
    }
  };

  const flip = () => {
    if (!encoded?.ok) return;
    const t = tamper(core, encoded.value.frame);
    if (!t) return;
    setInspector({ title: "corrupted frame", frame: t.frame, inspection: t.inspection, flipped: { byte: t.byte, bit: t.bit } });
    setVerdict({ channel: "corrupted frame (1 bit)", verification: t.verification });
  };

  const runDemo = async () => {
    if (!draft || !qrCanvas.current) return;
    resetReceivers();
    setSummary(null);
    setBusy(true);
    setDemoRunning(true);
    demoStart.current = performance.now();
    setElapsedMs(0);
    abort.current = new AbortController();
    try {
      const res = await runFullDemo(
        core,
        { draft, seed, trustedHex: trusted, ...settings, qrCanvas: qrCanvas.current, signal: abort.current.signal },
        {
          onStep: setStep,
          onEncoded: () => setTick((n) => n + 1),
          onAcousticTick,
          onAcousticDone: (out, v) => {
            if (out.result.ok) {
              const r = out.result.value;
              setAcousticInfo(`symbol SNR ${r.meanSymbolSnrDb.toFixed(1)} dB · ${r.correctedBytes} byte(s) fixed by RS`);
            }
            setVerdict({ channel: "4-FSK sound", verification: v ?? (out.result.ok ? { ok: false, error: { code: "VERIFY", message: "?" } } : out.result) });
          },
          onOpticalTick,
          onOpticalDone: (out, v) => {
            setVerdict({
              channel: "fountain QR",
              verification: v ?? (out.result.ok ? { ok: false, error: { code: "VERIFY", message: "?" } } : out.result),
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
          ? `Full scenario in ${(res.totalMs / 1000).toFixed(1)} s: frame verified over sound and over light, 1-bit curse rejected.`
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

  const cancel = () => abort.current?.abort();

  const encMs = medianMs("encode");
  const verMs = medianMs("verify");
  const kpis: Kpi[] = [
    { label: "Encode", value: encMs === null ? "–" : `${encMs.toFixed(2)} ms`, good: encMs !== null && encMs < 15 },
    { label: "Ed25519 verify", value: verMs === null ? "–" : `${verMs.toFixed(2)} ms`, good: verMs !== null && verMs < 15 },
    { label: "Frame", value: encoded?.ok ? `${encoded.value.frameLen} / 512 B` : "–", good: encoded?.ok },
    { label: "QR received / shown", value: fountain.shown ? `${fountain.received} / ${fountain.shown}` : "–", good: fountain.complete },
  ];

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
          presetId={presetId}
          onPreset={choosePreset}
          draftText={draftText}
          onDraftText={setDraftText}
          draftError={draftError ?? encodeError}
          encoded={encoded}
          jsonBytes={jsonBytes}
          qrCanvasRef={qrCanvas}
          qrCaption={qrCaption}
          onSendFsk={sendFsk}
          onSendQr={sendQr}
          busy={busy}
        />

        <ChannelControls
          settings={settings}
          onChange={setSettings}
          onFlip={flip}
          scopeRef={scope}
          fates={fates}
          busy={busy}
          canFlip={!!encoded?.ok}
          acousticProgress={acousticProgress}
        />

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
          <ResultCard key={verdict?.seq ?? 0} verification={verdict?.verification ?? null} channel={verdict?.channel ?? "sound or QR"} detail={verdict?.detail} />
        </section>
      </div>

      <FrameInspector frame={inspector?.frame ?? null} inspection={inspector?.inspection ?? null} flipped={inspector?.flipped} title={inspector?.title ?? ""} />
    </div>
  );
}
