"use client";

// Small form and layout primitives shared by the skeleton apps.
import type { ReactNode } from "react";

export function TabBar<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; badge?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto rounded-full bg-ink/[0.04] p-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          onClick={() => onChange(t.id)}
          className={`flex items-center gap-2 whitespace-nowrap rounded-full px-4 py-2 text-sm transition-colors ${t.id === value ? "bg-accent-soft font-medium text-accent" : "text-mist hover:bg-ink/[0.04] hover:text-ink"}`}
        >
          {t.label}
          {t.badge ? <span className="rounded-full bg-accent/20 px-1.5 font-mono text-[10px] text-accent">{t.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

const input = "mt-1 w-full rounded-md bg-ink/[0.045] px-2 py-1.5 text-sm text-ink outline-none focus:bg-ink/[0.08] disabled:opacity-50";

export function TextField({
  label,
  value,
  onChange,
  max,
  placeholder,
  disabled,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** Byte budget shown live (UTF-8). */
  max?: number;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
}) {
  const used = new TextEncoder().encode(value).length;
  const over = max !== undefined && used > max;
  return (
    <label className="block text-[12px] text-mist">
      <span className="flex justify-between">
        {label}
        {max !== undefined && <span className={`font-mono ${over ? "text-alarm" : "text-mute"}`}>{used}/{max} B</span>}
      </span>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} disabled={disabled} spellCheck={false} className={`${input} ${mono ? "font-mono" : ""} ${over ? "border-alarm/70" : ""}`} />
    </label>
  );
}

export function NumberField({ label, value, onChange, min = 0, max, step = 1, suffix, disabled }: { label: string; value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string; disabled?: boolean }) {
  return (
    <label className="block text-[12px] text-mist">
      {label}
      <span className="flex items-center gap-2">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => onChange(Math.max(min, Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.round(Number(e.target.value) || 0))))}
          className={`${input} font-mono`}
        />
        {suffix && <span className="mt-1 font-mono text-xs text-mute">{suffix}</span>}
      </span>
    </label>
  );
}

export function Stat({ value, label, tone = "text-ink" }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <div className="rounded-xl bg-ink/[0.035] p-3.5">
      <div className={`font-mono text-[1.4rem] font-medium tracking-tight ${tone}`}>{value}</div>
      <div className="mt-1 text-[12px] text-mist">{label}</div>
    </div>
  );
}

export function Panel({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel flex flex-col gap-4 p-5 ${className}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="panel-title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Hero({ kicker, title, accent, children }: { kicker: string; title: string; accent: string; children?: ReactNode }) {
  return (
    <section className="relative px-1 pb-2 pt-6 sm:pt-10">
      <p className="panel-title">{kicker}</p>
      <h1 className="display mt-4 max-w-4xl text-[clamp(2.2rem,4.6vw,3.8rem)] leading-[1.02] text-ink">
        {title} <em className="text-accent">{accent}</em>
      </h1>
      {children && <div className="mt-5 max-w-3xl text-[15px] leading-relaxed text-mist">{children}</div>}
    </section>
  );
}
