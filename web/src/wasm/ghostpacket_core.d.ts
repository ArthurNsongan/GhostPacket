/* tslint:disable */
/* eslint-disable */

/**
 * Fountain decoder (receiver side of the optical channel).
 */
export class FountainRx {
    free(): void;
    [Symbol.dispose](): void;
    frame(): Uint8Array;
    ingest(droplet: Uint8Array | number[]): any;
    constructor();
    reset(): void;
    stats(): any;
}

/**
 * Fountain encoder (emitter side of the optical channel).
 */
export class FountainTx {
    free(): void;
    [Symbol.dispose](): void;
    dropletLen(): number;
    droplet(seed: number): Uint8Array;
    k(): number;
    constructor(frame: Uint8Array | number[], session: number, block_size: number);
    nextDroplet(): Uint8Array;
}

/**
 * Hann-windowed FFT magnitude (dBFS) for the spectrogram.
 */
export class Spectrum {
    free(): void;
    [Symbol.dispose](): void;
    compute(samples: Float32Array | number[]): Float32Array;
    constructor(size: number);
}

/**
 * Crate version, for the UI footer and the MCP inspector.
 */
export function core_version(): string;

export function crc32(data: Uint8Array | number[]): number;

/**
 * Full verification (structure, CRC32, LZ4, schema, Ed25519).
 * `trusted_hex` is an array of 64-char hex public keys; empty = TOFU mode.
 */
export function decode_frame(frame: Uint8Array | number[], trusted_hex: any): any;

/**
 * Serializes, compresses and signs a document draft.
 * Returns metadata plus `frame: Uint8Array`.
 */
export function encode_document(draft: any, signing_seed: Uint8Array | number[], flags: number): any;

/**
 * Copy of `frame` with one bit flipped (US-03 integrity demo).
 */
export function flip_bit(frame: Uint8Array | number[], byte_idx: number, bit_idx: number): Uint8Array;

/**
 * Burst duration in seconds.
 */
export function fsk_burst_seconds(frame_len: number, mode: number): number;

/**
 * Finds and decodes one burst. Returns metadata plus `frame: Uint8Array`.
 */
export function fsk_demodulate(samples: Float32Array | number[], sample_rate: number, mode: number): any;

/**
 * PCM burst for `frame`. `mode`: 0 = robust (15 ms), 1 = fast (6 ms).
 */
export function fsk_modulate(frame: Uint8Array | number[], sample_rate: number, mode: number): Float32Array;

/**
 * Adds white Gaussian noise at `snr_db` (deterministic for a given seed).
 */
export function inject_awgn(samples: Float32Array | number[], snr_db: number, seed: number): Float32Array;

/**
 * Field-by-field dissection for the hex inspector (never fails).
 */
export function inspect_frame(frame: Uint8Array | number[]): any;

/**
 * Deterministic optical loss decision for droplet `index`.
 */
export function is_dropped(seed: number, index: number, drop_pct: number): boolean;

/**
 * Public key and fingerprint for a 32-byte signing seed.
 */
export function key_info(seed: Uint8Array | number[]): any;

/**
 * Protocol bounds, so the UI never hard-codes them.
 */
export function limits(): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_fountainrx_free: (a: number, b: number) => void;
    readonly __wbg_fountaintx_free: (a: number, b: number) => void;
    readonly __wbg_spectrum_free: (a: number, b: number) => void;
    readonly core_version: () => [number, number];
    readonly crc32: (a: number, b: number) => number;
    readonly decode_frame: (a: number, b: number, c: any) => [number, number, number];
    readonly encode_document: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly flip_bit: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly fountainrx_frame: (a: number) => [number, number, number, number];
    readonly fountainrx_ingest: (a: number, b: number, c: number) => [number, number, number];
    readonly fountainrx_new: () => number;
    readonly fountainrx_reset: (a: number) => void;
    readonly fountainrx_stats: (a: number) => [number, number, number];
    readonly fountaintx_droplet: (a: number, b: number) => [number, number];
    readonly fountaintx_dropletLen: (a: number) => number;
    readonly fountaintx_k: (a: number) => number;
    readonly fountaintx_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly fountaintx_nextDroplet: (a: number) => [number, number];
    readonly fsk_burst_seconds: (a: number, b: number) => [number, number, number];
    readonly fsk_demodulate: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly fsk_modulate: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly inject_awgn: (a: number, b: number, c: number, d: number) => [number, number];
    readonly inspect_frame: (a: number, b: number) => [number, number, number];
    readonly is_dropped: (a: number, b: number, c: number) => number;
    readonly key_info: (a: number, b: number) => [number, number, number];
    readonly limits: () => [number, number, number];
    readonly spectrum_compute: (a: number, b: number, c: number) => [number, number];
    readonly spectrum_new: (a: number) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
