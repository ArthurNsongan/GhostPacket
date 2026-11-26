"use client";

// Chimera Turbo, virtual: the same frame leaves as ChromaCrypt matrices and as
// OFDM droplet bundles at once, and one wide-fountain decoder takes droplets
// from both. Cover the camera or jam the sound mid-transfer: it slows down and
// carries on, it never restarts.
import { useEffect, useRef, useState } from "react";

import { DROPLETS_PER_BURST, runChimeraTurbo } from "ghostpacket-sdk/chimera-turbo";
import { emitLevel, spectral } from "ghostpacket-sdk/effects";
import type { Channel } from "ghostpacket-sdk/types";
import { sfx } from "ghostpacket-sdk/ui-sfx";

import FountainGridCanvas, { EMPTY_FOUNTAIN, type FountainView } from "./FountainGridCanvas";
import type { GhostState } from "./GhostContext";
import SpectrogramCanvas, { type SignalSink } from "./SpectrogramCanvas";

/** Scripted sabotage: the camera is covered for the first seconds, so both lanes visibly count. */
const SCRIPT_COVER_MS = 6000;

export default function ChimeraTurboLab({
  ghost,
  frame,
  onFrame,
  onPartial,
  dropPct = 30,
  snrDb = 15,
}: {
  ghost: GhostState;
  frame: Uint8Array | null;
  onFrame: (frame: Uint8Array, channel: Channel) => void;
  onPartial?: (decoded: boolean[]) => void;
  dropPct?: number;
  snrDb?: number;
}) {
  const { core } = ghost;
  const canvas = useRef<HTMLCanvasElement>(null);
  const spectro = useRef<SignalSink>(null);
  const abort = useRef<AbortController | null>(null);
  const covered = useRef(false);
  const jammed = useRef(false);
  const [coverOn, setCoverOn] = useState(false);
  const [jamOn, setJamOn] = useState(false);
  const [script, setScript] = useState(true);
  const [running, setRunning] = useState(false);
  const [lanes, setLanes] = useState({ light: 0, sound: 0 });
  const [fountain, setFountain] = useState<FountainView>(EMPTY_FOUNTAIN);
  const [status, setStatus] = useState("");
  useEffect(() => () => abort.current?.abort(), []);

  const toggleCover = (v: boolean) => {
    covered.current = v;
    setCoverOn(v);
  };
  const toggleJam = (v: boolean) => {
    jammed.current = v;
    setJamOn(v);
  };

  const run = async () => {
    if (!frame || !canvas.current) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    setStatus("");
    setLanes({ light: 0, sound: 0 });
    setFountain(EMPTY_FOUNTAIN);
    spectral("transmit");
    void sfx("summon");
    let blocks: boolean[] = [];
    let uncover: number | null = null;
    if (script) {
      toggleCover(true);
      uncover = window.setTimeout(() => toggleCover(false), SCRIPT_COVER_MS);
    }
    try {
      const out = await runChimeraTurbo(core, frame, {
        canvas: canvas.current,
        fps: 15,
        dropPct,
        snrDb,
        seed: core.crc32(frame) & 0xffff,
        signal: ac.signal,
        lightBlocked: () => covered.current,
        soundJammed: () => jammed.current,
        onAudio: (t) => {
          spectro.current?.push(t.window, t.sampleRate);
          emitLevel(t.window);
        },
        onTick: (t) => {
          setLanes({ light: t.lightDroplets, sound: t.soundDroplets });
          if (t.lane === "light" && t.lost) spectral("drop");
          const s = t.step;
          if (!s) return;
          blocks = blocks.length === s.totalK ? [...blocks] : Array<boolean>(s.totalK).fill(false);
          for (const i of s.newlyResolved) blocks[i] = true;
          const decoded = blocks;
          onPartial?.(decoded);
          setFountain((v) => ({
            k: s.totalK,
            decoded,
            flash: s.newlyResolved,
            cascadeDepth: Math.max(v.cascadeDepth, s.cascadeDepth),
            byElimination: v.byElimination || s.solvedByElimination,
            shown: t.lightDroplets + t.soundDroplets,
            received: s.dropletsReceived,
            pending: s.pending,
            complete: s.complete,
          }));
        },
      });
      if (out.result.ok) {
        setStatus(
          `Chimera Turbo · ${(frame.length / 1024).toFixed(1)} KB in ${(out.elapsedMs / 1000).toFixed(1)} s (${out.kbps.toFixed(1)} kbit/s) · ${out.lightDroplets} droplet(s) by light, ${out.soundDroplets} by sound · K = ${out.k}`,
        );
        onFrame(out.result.value, "chimera");
      } else {
        setStatus(`${out.result.error.code}: ${out.result.error.message}`);
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setStatus(String(e));
    } finally {
      if (uncover !== null) window.clearTimeout(uncover);
      toggleCover(false);
      toggleJam(false);
      setRunning(false);
    }
  };

  const chip = (on: boolean) => `rounded-full px-3 py-1.5 text-[12px] transition ${on ? "bg-alarm/15 font-medium text-alarm" : "bg-ink/[0.05] text-mist hover:bg-ink/[0.09]"}`;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-mist">
        Matrices at 15 per second and OFDM bursts of {DROPLETS_PER_BURST} droplets (≈ 2.5 s each) leave together; one wide-fountain decoder in the core takes droplets from both. The light lane is fast, the sound lane is slow but needs no line of
        sight.
      </p>
      <label className="flex items-center gap-2 text-[12px] text-mist">
        <input type="checkbox" checked={script} disabled={running} onChange={(e) => setScript(e.target.checked)} aria-label="Cover the camera for the first 6 seconds" />
        Script: the camera is covered for the first {SCRIPT_COVER_MS / 1000} s
      </label>
      <button type="button" onClick={() => void run()} disabled={!frame || running} className="cta-ember px-5 py-3 text-sm font-semibold disabled:opacity-50">
        {running ? "Both lanes on the air…" : "▶ Send through Chimera Turbo (light + sound)"}
      </button>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => toggleCover(!covered.current)} disabled={!running} className={chip(coverOn)} aria-pressed={coverOn}>
          {coverOn ? "Camera covered" : "Cover the camera"}
        </button>
        <button type="button" onClick={() => toggleJam(!jammed.current)} disabled={!running} className={chip(jamOn)} aria-pressed={jamOn}>
          {jamOn ? "Sound jammed" : "Jam the sound"}
        </button>
        <span className="self-center font-mono text-[11px] text-mute" aria-live="polite">
          light <span className="text-ion">{lanes.light}</span> · sound <span className="text-phosphor">{lanes.sound}</span> droplets
        </span>
      </div>
      <div className={`grid items-start gap-3 lg:grid-cols-[260px_1fr] ${running || fountain.k > 0 ? "" : "hidden"}`}>
        <canvas ref={canvas} width={300} height={300} className="pixelated w-full max-w-[260px] rounded-md bg-white" aria-label="Virtual Chimera Turbo matrix stream" />
        <div className="flex flex-col gap-2">
          <FountainGridCanvas view={fountain} />
          <SpectrogramCanvas core={core} ref={spectro} syncLocked={running && !jamOn} caption="sound lane · OFDM bundles" band="ofdm" />
        </div>
      </div>
      {status && <p className="font-mono text-xs text-mute">{status}</p>}
    </div>
  );
}
