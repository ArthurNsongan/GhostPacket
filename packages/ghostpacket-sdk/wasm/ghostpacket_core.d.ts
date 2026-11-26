/* tslint:disable */
/* eslint-disable */

/**
 * Receiver: camera image → matrix → droplet → wide fountain.
 */
export class ChromaRx {
    free(): void;
    [Symbol.dispose](): void;
    decodedMap(): Uint8Array;
    frame(): Uint8Array;
    /**
     * Feeds a droplet directly (virtual loopback without pixels).
     */
    ingest(droplet: Uint8Array | number[]): any;
    constructor();
    /**
     * Bytes known so far (unknown blocks zero), for progressive image reveal only.
     */
    partial(): Uint8Array;
    reset(): void;
    /**
     * Reads one RGBA camera image. Never throws on an unreadable image:
     * `found` is false with an `errorCode` (CHROMA_NOT_FOUND, CHROMA_UNCORRECTABLE…).
     */
    scan(rgba: Uint8Array | number[], width: number, height: number): any;
}

/**
 * Emitter: splits a (v1 or v2) frame into wide-fountain droplets, one per matrix.
 */
export class ChromaTx {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * `GRID × GRID` palette indices (0..8, bits r g b) of the matrix for droplet `seed`.
     */
    cells(seed: number): Uint8Array;
    droplet(seed: number): Uint8Array;
    k(): number;
    constructor(frame: Uint8Array | number[], session: number);
}

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
 * Palette index → [r, g, b] for the renderer.
 */
export function chroma_palette(): Uint8Array;

/**
 * Crate version, for the UI footer and the MCP inspector.
 */
export function core_version(): string;

export function crc32(data: Uint8Array | number[]): number;

/**
 * Full verification (structure, CRC32, decryption, LZ4, schema, keyring, Ed25519).
 * `trusted_hex` is an array of 64-char hex public keys; empty = TOFU mode.
 * `passphrase` opens encrypted frames.
 */
export function decode_frame(frame: Uint8Array | number[], trusted_hex: any, passphrase?: string | null): any;

/**
 * Serializes, compresses and signs a document draft.
 * With `passphrase` and a fresh 16-byte `salt`, the payload is encrypted
 * (ChaCha20-Poly1305, FLAG_ENCRYPTED). Returns metadata plus `frame: Uint8Array`.
 */
export function encode_document(draft: any, signing_seed: Uint8Array | number[], flags: number, passphrase?: string | null, salt?: Uint8Array | number[] | null): any;

/**
 * Like `encode_document`, but builds a GPKT v2 frame (payload up to 128 KB).
 */
export function encode_document_v2(draft: any, signing_seed: Uint8Array | number[], flags: number, passphrase?: string | null, salt?: Uint8Array | number[] | null): any;

/**
 * Fingerprint of a 64-char hex Ed25519 public key (keyring / identity QR).
 * Rejects strings that are not a valid curve point.
 */
export function fingerprint_of(public_key_hex: string): string;

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
export function inspect_frame(frame: Uint8Array | number[], passphrase?: string | null): any;

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

export function ofdm_burst_seconds(frame_len: number, sample_rate: number): number;

/**
 * Finds and decodes one OFDM burst. Returns metadata plus `frame: Uint8Array`.
 */
export function ofdm_demodulate(samples: Float32Array | number[], sample_rate: number): any;

/**
 * PCM burst (32-carrier DQPSK OFDM, ≈ 4 kbit/s) for a frame up to 16 KB.
 */
export function ofdm_modulate(frame: Uint8Array | number[], sample_rate: number): Float32Array;

/**
 * Public key and fingerprint stored in a vault (shown on the unlock screen).
 */
export function vault_identity(vault_bytes: Uint8Array | number[]): any;

/**
 * Opens a vault; `VAULT_INVALID` on a wrong passphrase or any altered byte.
 */
export function vault_open(vault_bytes: Uint8Array | number[], passphrase: string): Uint8Array;

/**
 * Seals a 32-byte signing seed under a passphrase (≥ 10 bytes) with a fresh 16-byte salt.
 */
export function vault_seal(seed: Uint8Array | number[], passphrase: string, salt: Uint8Array | number[]): Uint8Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_chromarx_free: (a: number, b: number) => void;
    readonly __wbg_chromatx_free: (a: number, b: number) => void;
    readonly __wbg_fountainrx_free: (a: number, b: number) => void;
    readonly __wbg_fountaintx_free: (a: number, b: number) => void;
    readonly __wbg_spectrum_free: (a: number, b: number) => void;
    readonly chroma_palette: () => [number, number];
    readonly chromarx_decodedMap: (a: number) => [number, number];
    readonly chromarx_frame: (a: number) => [number, number, number, number];
    readonly chromarx_ingest: (a: number, b: number, c: number) => [number, number, number];
    readonly chromarx_new: () => number;
    readonly chromarx_partial: (a: number) => [number, number];
    readonly chromarx_reset: (a: number) => void;
    readonly chromarx_scan: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly chromatx_cells: (a: number, b: number) => [number, number, number, number];
    readonly chromatx_droplet: (a: number, b: number) => [number, number];
    readonly chromatx_k: (a: number) => number;
    readonly chromatx_new: (a: number, b: number, c: number) => [number, number, number];
    readonly core_version: () => [number, number];
    readonly crc32: (a: number, b: number) => number;
    readonly decode_frame: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly encode_document: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly encode_document_v2: (a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly fingerprint_of: (a: number, b: number) => [number, number, number, number];
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
    readonly inspect_frame: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly is_dropped: (a: number, b: number, c: number) => number;
    readonly key_info: (a: number, b: number) => [number, number, number];
    readonly limits: () => [number, number, number];
    readonly ofdm_burst_seconds: (a: number, b: number) => number;
    readonly ofdm_demodulate: (a: number, b: number, c: number) => [number, number, number];
    readonly ofdm_modulate: (a: number, b: number, c: number) => [number, number, number, number];
    readonly spectrum_compute: (a: number, b: number, c: number) => [number, number];
    readonly spectrum_new: (a: number) => [number, number, number];
    readonly vault_identity: (a: number, b: number) => [number, number, number];
    readonly vault_open: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly vault_seal: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
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
