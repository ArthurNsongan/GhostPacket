"use client";

import { DEMO_STEPS, type DemoStep } from "@/lib/demo-runner";

export interface Kpi {
  label: string;
  value: string;
  good?: boolean;
}

/** One-click judge scenario with live step tracker and KPIs (US-01). */
export default function JudgeQuickDemoBar({
  step,
  running,
  elapsedMs,
  onRun,
  onCancel,
  kpis,
  summary,
  disabled,
}: {
  step: DemoStep;
  running: boolean;
  elapsedMs: number;
  onRun: () => void;
  onCancel: () => void;
  kpis: Kpi[];
  summary: string | null;
  disabled: boolean;
}) {
  const currentIndex = DEMO_STEPS.findIndex((s) => s.id === step);
  return (
    <section className="panel p-4" aria-labelledby="demo-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={running ? onCancel : onRun}
            disabled={disabled}
            className={`px-6 py-3 text-base font-bold tracking-wide transition disabled:opacity-40 ${
              running ? "rounded-full bg-void text-amber ring-1 ring-amber/60" : "cta-ember hover:brightness-110"
            }`}
          >
            {running ? "Stop" : "▶ Summon the full demo"}
          </button>
          <div>
            <h2 id="demo-title" className="text-sm font-semibold text-ink">
              1-click demo · &lt; 30 s · no mic, no camera
            </h2>
            <p className="font-mono text-xs text-mute">
              {running || step === "done" || step === "failed" ? `${(elapsedMs / 1000).toFixed(1)} s` : "Sign → noisy sound → lossy QR → 1-bit rejection"}
            </p>
          </div>
        </div>

        <ol className="flex flex-1 flex-wrap gap-1.5" aria-label="Demo steps">
          {DEMO_STEPS.map((s, i) => {
            const done = step === "done" || (currentIndex > i && step !== "failed") || (step === "failed" && i < currentIndex);
            const active = s.id === step && step !== "done";
            return (
              <li
                key={s.id}
                aria-current={active ? "step" : undefined}
                className={`rounded-full px-3 py-1 font-mono text-[11px] ${
                  done
                    ? "bg-phosphor/15 text-phosphor"
                    : active
                      ? "bg-ion/15 text-ion ring-1 ring-ion/50"
                      : "bg-void/60 text-mute"
                }`}
              >
                {done ? "✓ " : active ? "● " : ""}
                {s.label}
              </li>
            );
          })}
          {step === "failed" && <li className="rounded-full bg-alarm/15 px-3 py-1 font-mono text-[11px] text-alarm">✗ failed</li>}
        </ol>

        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:w-[30rem]">
          {kpis.map((k) => (
            <div key={k.label} className="rounded-md border border-grid bg-void/60 px-2 py-1">
              <dt className="text-[9px] uppercase tracking-widest text-mute">{k.label}</dt>
              <dd className={`font-mono text-sm ${k.good ? "text-phosphor" : "text-ink"}`}>{k.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      {summary && (
        <p className={`mt-3 font-mono text-xs ${step === "failed" ? "text-alarm" : "text-phosphor"}`} role="status">
          {summary}
        </p>
      )}
    </section>
  );
}
