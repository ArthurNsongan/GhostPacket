# Design — High-speed transports, GPKT v2 and persistent issuer identity

## Modules (all in `crates/ghostpacket-core`, panic-free, bounded)
| Module | Content |
|---|---|
| `protocol.rs` | `Layout` per version (header length, payload, frame and decompression bounds); `encode_frame_v2_with`; one verification path for v1 and v2 |
| `schema.rs` | `DocumentBody::ImageDocument` appended after `CustomMessage` (postcard variant index 4, doc type 0x05); bytes (de)serialized as a byte string (a `Uint8Array` in JS) and capped at 64 KB while decoding |
| `fountain_wide.rs` | LT code for frames ≤ 131 150 B: K ≤ 512, block 64–1024 B, 512-bit masks, CRC32 per droplet, peeling + Gauss-Jordan |
| `chroma.rs` | ChromaCrypt matrix: encoder, renderer (tests), decoder (finder search, homography, calibrated palette, RS) |
| `ofdm.rs` | OFDM modem: chirp sync, DQPSK, cyclic prefix, RS(255,223) interleaved, clock-slip tracker |
| `vault.rs` | identity vault on top of `encryption.rs` (`seal_with` / `open_with`, explicit PBKDF2 count) |

## Decisions
| Topic | Choice | Rejected | Reason |
|---|---|---|---|
| v2 framing | same layout as v1, u32 length | separate attachment block with its own hash | one verification path, CRC32 and the signature already cover every byte; the image hash is reported, not trusted |
| Image placement | inside the signed document | detached blob keyed by SHA-256 | nothing to fetch separately offline; the frame is self-contained |
| Image codec | the browser's WebP/JPEG encoder, quality and size search to a budget | a codec in Rust | the core signs and bounds; re-implementing an image encoder in WASM would cost size for no security gain |
| ChromaCrypt cells | 8 RGB-cube colors, 3 bits | 8 colors × 4 patterns (5 bits, plan) | patterns need several pixels per cell and fail first under blur; colors alone are calibrated per image |
| Matrix size | 44 × 44, 3 RS codewords | larger grids | still readable at ≈ 10 camera pixels per cell from a phone screen at arm's length |
| Fountain degrees | 5 % d=1, 10 % d=2, 85 % dense (3..K/3, ≤ 48) + elimination | ideal soliton | the soliton needed 1.6 × K at K ≈ 30 (measured); dense + elimination needs ≈ 1.05–1.15 × K |
| OFDM modulation | DQPSK in time per subcarrier | coherent QPSK with pilots | no channel estimate: the room's gain and phase per frequency cancel between symbols |
| OFDM timing | smoothed slip rate from the residual phase slope, integrated; window moved by whole samples; reference rotated | none / early-late | integrating half of the measured rate let ±300 ppm drift out of the CP (first failing test) |
| Vault KDF | PBKDF2-SHA256 210k | 40k (frames) | a vault can be copied and attacked offline; unlocked once per session (~0.5 s in WASM) |

## Wire formats
```text
GPKT v2  [GPKT 4][0x02][flags][N u32 BE][payload N][CRC32][Ed25519 64]          N ≤ 131 072
Wide droplet [GW][session 2][K 2][block 2][total 4][seed 4][data block][CRC32 4]
Vault    [GPKV][0x01][public key 32][salt 16][ChaCha20-Poly1305(seed) 32][tag 16]  = 101 B
OFDM     [chirp 1.2→7.2 kHz 43 ms][gap 256][reference][2 header symbols][data][tail]
         symbol = 128 CP + 512 samples; header RS(16,4) of u32 length; data RS(255,223)
```

## Bounds
| Constant | Value |
|---|---|
| `MAX_FRAME_SIZE_V2` | 131 150 B |
| `MAX_DECOMPRESSED_BYTES_V2` | 136 KB |
| `MAX_IMAGE_BYTES` | 64 KB |
| `WIDE_MAX_K` / `WIDE_MAX_BLOCK` / pending | 512 / 1024 B / 2·K |
| ChromaCrypt image | ≤ 4096 × 4096 px, length checked before reading |
| `OFDM_MAX_FRAME` | 16 KB (≈ 33 s at 48 kHz, under `MAX_SAMPLES`) |

## Measured (tests, MCP benchmark, headless Chrome)
| Measure | Value |
|---|---|
| ChromaCrypt, 12.2 KB frame, 30 % lost | K = 25, 41.8 shown / 26.5 received, 2.8 s at 15 FPS ≈ 36 kbit/s |
| ChromaCrypt scan of one 312 px matrix (WASM, Node) | 0.8 ms |
| OFDM, 12.3 KB frame, 15 dB SNR | 23.9 s burst, 4.2 kbit/s, 0 failures; 45 ms to demodulate |
| OFDM fuzz | 12 / 15 / 20 dB, echo at 1 / 2.2 / 6.3 ms, ±100 / ±300 ppm on 16 KB, −30 dB, clipping at 0.35 |
| Wide fountain, 30 % loss, 40 sessions | mean received < 1.15 × K at 16 KB and 64 KB |
| WASM size | 280 KB gzip (budget 350 KB) |

## Integration
- SDK: `wasm-bridge.ts` (`encodeV2`, `vault*`, `chromaTx/chromaRx`, `ofdm*`); `chroma-engine.ts` (draw, broadcast, camera scanner, loopback); `image-codec.ts` (budgets, sample RDT image); `identity.ts` (vault storage); `audio-engine.ts` (`AcousticMode = "robust" | "fast" | "ofdm"`); `sdk.ts` (`sealImage`, `transmitChroma`, `receiveChroma`).
- UI: `AirSender` / `AirReceiver` offer only the modes a frame fits; `VirtualHandover` uses ChromaCrypt for frames over 512 B; `ImageAttach`; `SpectralImageReveal`; `HighSpeedLab` (portal Simulation: virtual; Test: field); `GhostProvider persistent` + `IdentityGate`.
- Clinic: a photo linked to the prescription (`IMG-xxxx → RX-xxxxx`), shown at the pharmacy after verification, never "dispensed".
- Verifier: accepts v2 frames (≤ 131 150 B) and summarizes images in its JSON (size, SHA-256).
- MCP: `inspect_frame_hex` takes `passphrase` and has `encrypted` and `image` samples; `run_channel_benchmark` takes `image_kb` for OFDM and ChromaCrypt.

## Not in this iteration
- **Ultrasonic Whisper** (17.5–19.8 kHz): many phone microphones and laptop speakers roll off above 16 kHz. It needs field measurements before a modem design.
- **WebRTC QR-signaled LAN**: needs a shared hotspot and two live devices to test, and opens a network path that product rule 3 currently excludes.
- **Chimera Turbo** (ChromaCrypt and OFDM feeding one decoder): the two transports use different codes (wide fountain vs RS blocks). A shared droplet format over OFDM is the next step.
