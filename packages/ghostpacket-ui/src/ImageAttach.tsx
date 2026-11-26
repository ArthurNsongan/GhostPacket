"use client";

// Image picker for GPKT v2 documents: a file, a camera capture or a built-in
// sample (malaria RDT). The browser re-encodes it to the chosen budget before
// the core signs it; the original never leaves the device.
import { useEffect, useState } from "react";

import { encodeImage, IMAGE_BUDGETS, loadBitmap, sampleRdtImage, type EncodedImage, type ImageBudget } from "ghostpacket-sdk/image-codec";

export type ImageSource = ImageBitmap | HTMLCanvasElement;

export default function ImageAttach({ onChange, disabled }: { onChange: (source: ImageSource | null, budget: ImageBudget, preview: EncodedImage | null) => void; disabled?: boolean }) {
  const [source, setSource] = useState<ImageSource | null>(null);
  const [budget, setBudget] = useState<ImageBudget>("standard");
  const [preview, setPreview] = useState<EncodedImage | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setPreview(null);
      onChange(null, budget, null);
      return;
    }
    encodeImage(source, budget)
      .then((img) => {
        if (cancelled) return;
        setError(null);
        setPreview(img);
        onChange(source, budget, img);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, budget]);

  useEffect(() => {
    if (!preview) return setUrl(null);
    const u = URL.createObjectURL(new Blob([preview.bytes.slice().buffer], { type: preview.mime === 1 ? "image/webp" : "image/jpeg" }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [preview]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    try {
      setSource(await loadBitmap(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg bg-ink/[0.03] p-3">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <label className="cursor-pointer rounded-full bg-ion/10 px-3 py-1 text-ion hover:bg-ion/20">
          Photo or file
          <input type="file" accept="image/*" capture="environment" className="sr-only" disabled={disabled} onChange={(e) => void pick(e.target.files?.[0])} aria-label="Attach an image" />
        </label>
        <button type="button" disabled={disabled} onClick={() => setSource(sampleRdtImage(true))} className="btn-tonal rounded-full px-3 py-1">
          Use the sample (malaria RDT)
        </button>
        <select value={budget} onChange={(e) => setBudget(e.target.value as ImageBudget)} disabled={disabled} className="rounded-md bg-ink/[0.045] px-2 py-1 font-mono text-[11px] text-ink outline-none focus:bg-ink/[0.08]" aria-label="Image size budget">
          {(Object.keys(IMAGE_BUDGETS) as ImageBudget[]).map((b) => (
            <option key={b} value={b}>
              {IMAGE_BUDGETS[b].label}
            </option>
          ))}
        </select>
        {source && (
          <button type="button" disabled={disabled} onClick={() => setSource(null)} className="font-mono text-[11px] text-mute hover:text-alarm">
            remove
          </button>
        )}
      </div>
      {error && <p className="font-mono text-[11px] text-alarm">{error}</p>}
      {preview && url && (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="Image to sign" className="h-20 w-auto rounded" />
          <p className="font-mono text-[11px] text-mist">
            {preview.width}×{preview.height} · {(preview.bytes.length / 1024).toFixed(1)} KB · {preview.mime === 1 ? "WebP" : "JPEG"} q{Math.round(preview.quality * 100)} · re-encoded on this device
          </p>
        </div>
      )}
    </div>
  );
}
