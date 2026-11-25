"use client";

import { useEffect, useState } from "react";

import { BUILD_INFO } from "@/lib/build-info";
import { medianMs, onTiming } from "ghostpacket-sdk/wasm-bridge";

import type { GhostState } from "./AppShell";

const OPS: { op: string; label: string; budget: number }[] = [
  { op: "wasm_load", label: "WASM load", budget: 500 },
  { op: "encode", label: "Encode + sign", budget: 15 },
  { op: "encode_encrypted", label: "Encode + E2EE + sign", budget: 500 },
  { op: "verify", label: "Verify", budget: 15 },
  { op: "verify_encrypted", label: "Decrypt + verify", budget: 500 },
  { op: "fsk_demodulate", label: "FSK demodulate", budget: 500 },
  { op: "fft", label: "FFT 1024", budget: 5 },
  { op: "droplet_ingest", label: "Fountain ingest", budget: 2 },
];

/** Drawer with live WASM latencies, binary size and the `.kiro/` architecture. */
export default function KiroTelemetry({ ghost, onClose }: { ghost: GhostState | null; onClose: () => void }) {
  const [, setTick] = useState(0);
  const [wasmKb, setWasmKb] = useState<{ transfer: number; raw: number } | null>(null);

  useEffect(() => {
    let last = 0;
    const off = onTiming(() => {
      const now = performance.now();
      if (now - last > 250) {
        last = now;
        setTick((n) => n + 1);
      }
    });
    const entry = performance
      .getEntriesByType("resource")
      .find((e) => e.name.endsWith("ghostpacket_core_bg.wasm")) as PerformanceResourceTiming | undefined;
    if (entry) setWasmKb({ transfer: entry.transferSize / 1024, raw: entry.decodedBodySize / 1024 });
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => {
      off();
      window.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-void/60 backdrop-blur-sm" role="dialog" aria-label="Kiro telemetry" onClick={onClose}>
      <aside className="panel h-full w-full max-w-md overflow-y-auto rounded-none p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h2 className="display text-2xl text-ink">
            Kiro <em className="text-phosphor">Telemetry</em>
          </h2>
          <button type="button" onClick={onClose} className="font-mono text-xs text-mist hover:text-ink">
            close ✕
          </button>
        </div>

        <h3 className="panel-title mt-5">Live WASM latencies (median)</h3>
        <table className="mt-2 w-full font-mono text-xs">
          <tbody>
            {OPS.map(({ op, label, budget }) => {
              const m = medianMs(op);
              return (
                <tr key={op} className="border-b border-grid/60">
                  <td className="py-1 text-mist">{label}</td>
                  <td className={`py-1 text-right ${m === null ? "text-mute" : m <= budget ? "text-phosphor" : "text-amber"}`}>{m === null ? "not run yet" : `${m.toFixed(2)} ms`}</td>
                  <td className="py-1 pl-2 text-right text-mute">≤ {budget} ms</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h3 className="panel-title mt-5">Binary & tests</h3>
        <dl className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs">
          <div className="rounded-md border border-grid p-2">
            <dt className="text-mute">WASM (this load)</dt>
            <dd className="text-ink">{wasmKb ? `${wasmKb.raw.toFixed(0)} KB raw · ${wasmKb.transfer > 0 ? `${wasmKb.transfer.toFixed(0)} KB sent` : "from cache"}` : "…"}</dd>
          </div>
          <div className="rounded-md border border-grid p-2">
            <dt className="text-mute">WASM gzip (build)</dt>
            <dd className="text-ink">{BUILD_INFO.wasmGzipKb} KB / 350 KB</dd>
          </div>
          <div className="rounded-md border border-grid p-2">
            <dt className="text-mute">Rust tests</dt>
            <dd className="text-phosphor">{BUILD_INFO.rustTests} passing</dd>
          </div>
          <div className="rounded-md border border-grid p-2">
            <dt className="text-mute">Core</dt>
            <dd className="text-ink">{ghost?.core.version ?? "…"}</dd>
          </div>
        </dl>

        <h3 className="panel-title mt-5">.kiro/ architecture</h3>
        <ul className="mt-2 space-y-2 text-xs">
          <li>
            <span className="text-mist">Steering</span> <span className="font-mono text-ink">{BUILD_INFO.steering.join(" · ")}</span>
          </li>
          <li>
            <span className="text-mist">Specs (EARS)</span> <span className="font-mono text-ink">{BUILD_INFO.specs.join(" · ")}</span>
          </li>
          <li>
            <span className="text-mist">Hooks</span> <span className="font-mono text-ink">{BUILD_INFO.hooks.join(" · ")}</span>
          </li>
          <li>
            <span className="text-mist">Custom agent</span> <span className="font-mono text-ink">{BUILD_INFO.agents.join(" · ")}</span>
          </li>
          <li>
            <span className="text-mist">MCP ghostpacket-inspector</span> <span className="font-mono text-ink">{BUILD_INFO.mcpTools.join(" · ")}</span>
          </li>
        </ul>
        <a href={BUILD_INFO.repository} className="mt-5 inline-block font-mono text-xs text-ion hover:underline" target="_blank" rel="noreferrer">
          Browse .kiro/ on GitHub ↗
        </a>
      </aside>
    </div>
  );
}
