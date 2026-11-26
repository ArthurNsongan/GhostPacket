"use client";

// "Haunted mirror" (HALLOWEEN_REDESIGN_PLAN.md §3.5): while a large frame
// arrives, each fountain block burns a tile through the spectral fog. The
// image itself appears only after the whole frame verified (never before).
export default function SpectralImageReveal({ decoded, children, label }: { decoded: boolean[]; children?: React.ReactNode; label?: string }) {
  const k = decoded.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(k * 1.5)));
  const done = decoded.filter(Boolean).length;
  return (
    <figure className="relative overflow-hidden rounded-lg bg-ink/[0.04]">
      <div className="flex min-h-40 items-center justify-center">{children ?? <span className="font-mono text-[11px] text-mute">{label ?? "Waiting for the image…"}</span>}</div>
      {k > 0 && !children && (
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }} aria-hidden>
          {decoded.map((d, i) => (
            <span
              key={i}
              className={`transition-opacity duration-500 ${d ? "opacity-0" : "opacity-90"}`}
              style={{ background: "radial-gradient(circle, rgba(168,85,247,0.35), rgba(6,5,10,0.95))" }}
            />
          ))}
        </div>
      )}
      {k > 0 && (
        <figcaption className="absolute bottom-1 right-2 font-mono text-[10px] text-ion">
          {done}/{k} blocks
        </figcaption>
      )}
    </figure>
  );
}
