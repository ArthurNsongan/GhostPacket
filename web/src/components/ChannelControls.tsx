"use client";

import type { ReactNode, Ref } from "react";
import EtherConduit, { type ConduitSink } from "./EtherConduit";
import { DropletStrip, type DropletFate } from "./FountainGridCanvas";

export interface ChannelSettings {
  snrDb: number;
  dropPct: number;
  fps: number;
  playAudio: boolean;
}

/** Centre column: what the air does to the signal. */
export default function ChannelControls({
  settings,
  onChange,
  conduitRef,
  children,
  fates,
  busy,
  acousticProgress,
}: {
  settings: ChannelSettings;
  onChange: (s: ChannelSettings) => void;
  conduitRef: Ref<ConduitSink>;
  /** Tamper lab, Chimera race… rendered under the channel settings. */
  children?: ReactNode;
  fates: DropletFate[];
  busy: boolean;
  acousticProgress: number;
}) {
  return (
    <section className="panel flex flex-col gap-4 p-4" aria-labelledby="channel-title">
      <h2 id="channel-title" className="panel-title">
        ② Haunt the channel
      </h2>
      <div>
        <span className="text-[11px] uppercase tracking-widest text-mute">The Ether Conduit</span>
        <div className="mt-1">
          <EtherConduit ref={conduitRef} />
        </div>
      </div>

      <div className="rounded-lg border border-grid bg-void/40 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[11px] uppercase tracking-widest text-mute">Channel A · acoustic air</span>
          <span className="font-mono text-[10px] text-mute">{Math.round(acousticProgress * 100)} %</span>
        </div>
        <div className="mt-1 h-1 overflow-hidden rounded bg-void">
          <div className="h-full bg-phosphor transition-[width] duration-100" style={{ width: `${acousticProgress * 100}%` }} />
        </div>
        <label className="mt-3 block">
          <div className="flex justify-between text-[12px]">
            <span>White noise · SNR</span>
            <span className={`font-mono ${settings.snrDb < 8 ? "text-amber" : "text-phosphor"}`}>{settings.snrDb} dB</span>
          </div>
          <input
            type="range"
            min={0}
            max={25}
            step={1}
            value={settings.snrDb}
            disabled={busy}
            onChange={(e) => onChange({ ...settings, snrDb: Number(e.target.value) })}
            className="w-full"
            aria-label="Signal-to-noise ratio in decibels"
          />
          <div className="flex justify-between font-mono text-[9px] text-mute">
            <span>0 dB · storm</span>
            <span>25 dB · quiet</span>
          </div>
        </label>
        <label className="mt-2 flex items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={settings.playAudio}
            disabled={busy}
            onChange={(e) => onChange({ ...settings, playAudio: e.target.checked })}
          />
          Play the signal on the speakers
        </label>
      </div>

      <div className="rounded-lg border border-grid bg-void/40 p-3">
        <span className="text-[11px] uppercase tracking-widest text-mute">Channel B · optical stream</span>
        <label className="mt-2 block">
          <div className="flex justify-between text-[12px]">
            <span>QR frames lost</span>
            <span className={`font-mono ${settings.dropPct > 40 ? "text-amber" : "text-phosphor"}`}>{settings.dropPct} %</span>
          </div>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={settings.dropPct}
            disabled={busy}
            onChange={(e) => onChange({ ...settings, dropPct: Number(e.target.value) })}
            className="w-full"
            aria-label="Percentage of QR frames lost"
          />
        </label>
        <label className="mt-2 block">
          <div className="flex justify-between text-[12px]">
            <span>Display rate</span>
            <span className="font-mono text-phosphor">{settings.fps} FPS</span>
          </div>
          <input
            type="range"
            min={4}
            max={20}
            step={1}
            value={settings.fps}
            disabled={busy}
            onChange={(e) => onChange({ ...settings, fps: Number(e.target.value) })}
            className="w-full"
            aria-label="QR frames per second"
          />
        </label>
        <div className="mt-3">
          <DropletStrip fates={fates} />
        </div>
      </div>

      {children}
    </section>
  );
}
