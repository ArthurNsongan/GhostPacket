"use client";

import { useState } from "react";

import type { Verified } from "ghostpacket-sdk/sdk";
import type { FrameInspection } from "ghostpacket-sdk/types";
import type { Result } from "ghostpacket-sdk/wasm-bridge";

import type { GhostState } from "./GhostContext";
import FrameInspector from "./FrameInspector";
import ResultCard from "./ResultCard";

/** Drag-and-drop `.gpkt` verifier: the file never leaves the browser. */
export default function GpktVerifier({ ghost }: { ghost: GhostState }) {
  const [over, setOver] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const [frame, setFrame] = useState<Uint8Array | null>(null);
  const [inspection, setInspection] = useState<FrameInspection | null>(null);
  const [verdict, setVerdict] = useState<Result<Verified> | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [seq, setSeq] = useState(0);

  const check = (bytes: Uint8Array, phrase = passphrase) => {
    setFrame(bytes);
    setInspection(ghost.core.inspect(bytes, phrase || undefined));
    setVerdict(ghost.sdk.verifyFrame(bytes, { passphrase: phrase || undefined, ledger: "field", channel: "file" }));
    setSeq((s) => s + 1);
  };

  const load = async (file: File | undefined) => {
    if (!file) return;
    setName(file.name);
    const r = await ghost.sdk.importGpktFile(file);
    if (!r.ok) {
      setFrame(null);
      setInspection(null);
      setVerdict(r);
      setSeq((s) => s + 1);
      return;
    }
    check(r.value);
  };

  const sample = () => {
    const s = ghost.sdk.sealMessage({ sender: "GhostPacket docs", title: "Sample frame", message: "This frame was signed in your browser a moment ago." });
    if (s.ok) {
      setName("sample.gpkt (generated)");
      check(s.value.frame);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void load(e.dataTransfer.files[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${over ? "border-phosphor bg-phosphor/5" : "border-grid hover:border-phosphor/50"}`}
      >
        <span className="display text-2xl text-ink">
          Drop a <em className="text-phosphor">.gpkt</em> file
        </span>
        <span className="mt-1 text-sm text-mist">or click to choose one. Verified locally in WASM; nothing is uploaded.</span>
        <input type="file" accept=".gpkt,application/vnd.ghostpacket,application/octet-stream" className="sr-only" onChange={(e) => void load(e.target.files?.[0])} />
        {name && <span className="mt-2 font-mono text-[11px] text-ion">{name}</span>}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={sample} className="rounded-md border border-grid px-3 py-1.5 text-[12px] text-mist hover:text-ink">
          Generate a sample frame
        </button>
        <input
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder="passphrase (encrypted frames)"
          className="min-w-0 flex-1 rounded-md border border-grid bg-void px-2 py-1.5 font-mono text-[12px] text-ink outline-none"
        />
        <button type="button" disabled={!frame} onClick={() => frame && check(frame)} className="rounded-md border border-ion/50 px-3 py-1.5 text-[12px] text-ion disabled:opacity-40">
          Re-verify
        </button>
      </div>
      <ResultCard key={seq} verification={verdict} channel="file" replay={verdict?.ok ? verdict.value.replay : null} />
      {frame && <FrameInspector frame={frame} inspection={inspection} title={name ?? "file"} />}
    </div>
  );
}
