// Where the WASM binary and the capture worklet are served from.
// - In the Next.js site, NEXT_PUBLIC_BASE_PATH is inlined at build time.
// - In the standalone SDK (no `process` global), the access throws and the SDK
//   entry (`index.ts`) configures URLs relative to its own module instead.
// Apps can override both with `configureAssets`.

function nextBasePath(): string | null {
  try {
    return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  } catch {
    return null;
  }
}

const base = nextBasePath();

export interface AssetConfig {
  /** URL (or bytes) of `ghostpacket_core_bg.wasm`. Undefined: the wasm-bindgen default next to the glue. */
  wasm?: string | URL | BufferSource;
  /** URL of `capture-processor.js` (AudioWorklet for the microphone). */
  workletUrl?: string;
}

const config: AssetConfig = {
  wasm: base === null ? undefined : `${base}/wasm/ghostpacket_core_bg.wasm`,
  workletUrl: base === null ? undefined : `${base}/worklets/capture-processor.js`,
};

/** Overrides asset locations. Call before `GhostPacketSDK.load()`. */
export function configureAssets(c: AssetConfig): void {
  if (c.wasm !== undefined) config.wasm = c.wasm;
  if (c.workletUrl !== undefined) config.workletUrl = c.workletUrl;
}

export function assets(): Readonly<AssetConfig> {
  return config;
}
