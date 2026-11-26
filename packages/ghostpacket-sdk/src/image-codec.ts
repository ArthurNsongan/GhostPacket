// Client-side progressive image codec: any user image (file or camera capture)
// is downscaled and re-encoded by the browser's own encoder (WebP, else JPEG)
// until it fits a size budget, so it can ship inside a signed GPKT v2 frame.
// No compression code of ours: the browser encodes, the Rust core signs.
import { IMAGE_MIME } from "./types";

export type ImageBudget = "micro" | "standard" | "high";
export const IMAGE_BUDGETS: Record<ImageBudget, { bytes: number; maxSide: number; label: string }> = {
  micro: { bytes: 4 * 1024, maxSide: 320, label: "Micro · 4 KB" },
  // 15 KB: with the document fields and the frame overhead it still fits one OFDM burst (≤ 16 KB).
  standard: { bytes: 15 * 1024, maxSide: 640, label: "Standard · 15 KB" },
  high: { bytes: 48 * 1024, maxSide: 1024, label: "High · 48 KB" },
};

export interface EncodedImage {
  bytes: Uint8Array;
  mime: number;
  width: number;
  height: number;
  quality: number;
}

function canvasFor(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((r) => canvas.toBlob((b) => r(b), type, quality));
}

/** Decodes a File/Blob into a bitmap (EXIF orientation applied by the browser). */
export async function loadBitmap(source: Blob): Promise<ImageBitmap> {
  if (source.size > 25 * 1024 * 1024) throw new Error("Image file larger than 25 MB");
  return createImageBitmap(source, { imageOrientation: "from-image" });
}

/**
 * Re-encodes `source` to fit `budget`: tries decreasing qualities, then smaller
 * sizes. Prefers WebP; falls back to JPEG where the browser cannot encode WebP.
 */
export async function encodeImage(source: ImageBitmap | HTMLCanvasElement, budget: ImageBudget): Promise<EncodedImage> {
  const { bytes: max, maxSide } = IMAGE_BUDGETS[budget];
  let scale = Math.min(1, maxSide / Math.max(source.width, source.height));
  for (let attempt = 0; attempt < 7; attempt++) {
    const w = Math.max(16, Math.round(source.width * scale));
    const h = Math.max(16, Math.round(source.height * scale));
    const canvas = canvasFor(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D unavailable");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    for (const q of [0.82, 0.7, 0.58, 0.46, 0.34, 0.24]) {
      for (const type of ["image/webp", "image/jpeg"]) {
        const blob = await toBlob(canvas, type, q);
        // Some browsers silently return PNG for an unsupported type.
        if (!blob || blob.type !== type) continue;
        if (blob.size <= max) {
          return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: type === "image/webp" ? IMAGE_MIME.webp : IMAGE_MIME.jpeg, width: w, height: h, quality: q };
        }
        break; // WebP worked but is too big: lower the quality before trying JPEG.
      }
    }
    scale *= 0.72;
  }
  throw new Error(`Image does not fit ${IMAGE_BUDGETS[budget].label}`);
}

/**
 * Sample clinical image for demos with no camera: a malaria rapid diagnostic
 * test cassette (control + test lines), drawn on a canvas.
 */
export function sampleRdtImage(positive = true): HTMLCanvasElement {
  const c = canvasFor(640, 360);
  const g = c.getContext("2d");
  if (!g) return c;
  const bg = g.createLinearGradient(0, 0, 640, 360);
  bg.addColorStop(0, "#d9d4c7");
  bg.addColorStop(1, "#b9b2a3");
  g.fillStyle = bg;
  g.fillRect(0, 0, 640, 360);
  // Cassette.
  g.fillStyle = "#f4f2ee";
  g.strokeStyle = "#9a958a";
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(70, 110, 500, 140, 28);
  g.fill();
  g.stroke();
  // Sample well and result window.
  g.fillStyle = "#e3ded3";
  g.beginPath();
  g.arc(150, 180, 30, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.fillStyle = "#fbfaf7";
  g.fillRect(260, 150, 230, 60);
  g.strokeRect(260, 150, 230, 60);
  // Lines: C (control) always, T (test) if positive.
  g.fillStyle = "#b0263f";
  g.fillRect(430, 152, 9, 56);
  if (positive) {
    g.globalAlpha = 0.75;
    g.fillRect(350, 152, 9, 56);
    g.globalAlpha = 1;
  }
  g.fillStyle = "#4a463f";
  g.font = "bold 20px sans-serif";
  g.fillText("C", 427, 236);
  g.fillText("T", 347, 236);
  g.fillText("S", 143, 236);
  g.font = "16px sans-serif";
  g.fillText("Malaria Pf/Pan RDT · PAT-0815 · Ndiob", 160, 290);
  // Mild sensor noise so the codec has realistic texture.
  const img = g.getImageData(0, 0, 640, 360);
  let x = 12345;
  for (let i = 0; i < img.data.length; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    const n = (x & 15) - 8;
    img.data[i] = Math.max(0, Math.min(255, (img.data[i] ?? 0) + n));
    img.data[i + 1] = Math.max(0, Math.min(255, (img.data[i + 1] ?? 0) + n));
    img.data[i + 2] = Math.max(0, Math.min(255, (img.data[i + 2] ?? 0) + n));
  }
  g.putImageData(img, 0, 0);
  return c;
}
