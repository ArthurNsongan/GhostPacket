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

## Phase 3: round ledger, Chimera Turbo, Ultrasonic Whisper, WebRTC LAN
| Module | Content |
|---|---|
| `schema.rs` | `DocumentBody::LedgerBatchDelta` appended last (doc type 0x06): 1..=64 `LedgerEntry { member, amount_minor, receipt_id }`, duplicate receipt ids refused |
| `fountain_wide.rs` | `WideEncoder::bundle` (droplets back to back, ≤ 16 KB), `split_bundle` (length from each header, no copy), `WideDecoder::ingest_bundle` (bad droplets counted, not fatal), `SOUND_SEED_BASE = 0x8000_0000` |
| `fsk.rs` | `FskMode::Ultrasonic` (code 2): same Barker-13 + Goertzel + RS modem on a second tone plan, 5 ms symbols, 2.5 ms window, frames ≤ 256 B, ≥ 44.1 kHz |
| SDK `chimera-turbo.ts` | virtual run (both lanes in real time, live sabotage), field emitter (matrices + OFDM bundles on the speaker) |
| SDK `lan-link.ts` | `LanLink` (offer / answer / accept / send), compact code parser and SDP rebuild, QR text scanner |
| SDK `ledger-batch.ts` | `sealCompact` (v1 if it fits, else v2), totals |
| UI | `VirtualBroadcast` (any acoustic mode over the virtual air), `ChimeraTurboLab`, `LanLinkPanel` (virtual and field), `WhisperIdentity`; `AirSender` / `AirReceiver` gain Chimera Turbo and the ultrasonic mode; `SpectrogramCanvas` bands (FSK, OFDM, ultrasonic) |

### Decisions
| Topic | Choice | Rejected | Reason |
|---|---|---|---|
| Chimera over sound | whole wide droplets in an OFDM burst (bundle of 2) | RS blocks of the frame over OFDM, a new code | one decoder and one droplet format; every droplet keeps its own CRC32, so a burst that decodes with one bad droplet still counts |
| Ultrasonic modem | the 4-FSK modem on a 17.6–19.6 kHz tone plan | chirp spread spectrum, OFDM above 17 kHz | reuses the tested Barker sync, timing tracker and RS; 400 Hz spacing stays orthogonal over a 2.5 ms window |
| Ultrasonic payload | a signed identity card (custom message, title "Identity card") | an unsigned key string | the signature proves possession of the key; the label is still checked by comparing the fingerprint |
| LAN signaling | compact text (≈ 200 characters) rebuilt into a data-channel SDP | the full SDP, deflated | a smaller QR, and only validated fields reach `setRemoteDescription` (no SDP injection) |
| LAN answer path | QR code or one OFDM burst | a camera on both sides | a PC without a usable webcam still hears the phone's answer |
| LAN and product rule 3 | allowed: user-initiated, host candidates only, no ICE / signaling server | STUN for NAT traversal | nothing leaves the local network; frames are verified as on any other channel |
| Round ledger anti-replay | the ledger's own doc id, in the member's "receipts" scope | one ledger entry per receipt | the receipts are already individual documents; the ledger is a signed summary |

### Wire formats
```text
Bundle     [droplet 1][droplet 2]…  each = [GW][session][K][block][total][seed][data][CRC32], ≤ 16 KB in total
LAN code   GPLAN1|o or a|ice-ufrag|ice-pwd|SHA-256 fingerprint (64 hex)|actpass, active or passive|candidate,candidate…
           candidate = "<foundation> 1 udp <priority> <address or mDNS name> <port> typ host" (≤ 4)
Ultrasonic same as 4-FSK: [lead][Barker-13 17.6 / 19.6 kHz][guard 3][RS header][RS data][tail], data tones 18.0 / 18.4 / 18.8 / 19.2 kHz
```

### Bounds
| Constant | Value |
|---|---|
| `MAX_LEDGER_ENTRIES` | 64 |
| `MAX_BUNDLE_BYTES` | 16 KB (one OFDM frame) |
| `ULTRASONIC_MAX_FRAME` / `ULTRASONIC_MIN_SAMPLE_RATE` | 256 B / 44 100 Hz |
| LAN code / candidates / message | ≤ 1024 characters / ≤ 4 host candidates / ≤ 131 150 B |

### Measured (Rust tests, MCP benchmark, headless Chrome E2E)
| Measure | Value |
|---|---|
| Chimera Turbo, 10.6 KB E2EE image, camera covered for the first 6 s, 30 % matrices lost, 15 dB | rebuilt in 8.0 s, 17–21 droplets by light and 4–6 by sound, K = 22 |
| Ultrasonic identity card (155 B), 15 dB | 3.6 s burst, ≈ 340 bit/s effective, 4 / 4 decoded; tests pass at 10 dB at 44.1 and 48 kHz |
| Ultrasonic leakage under 16 kHz | more than 30 dB below the signal (test) |
| WebRTC LAN, virtual (two peers in one page) | codes of 195–197 characters, link open in 2.2–3.2 s, 10.6 KB delivered in 7–15 ms |
| Round ledger, 4 contributions | 352 B, GPKT v1; 20 contributions need v2 (test) |
| WASM size | 285 KB gzip (budget 350 KB) |

### Limits
- Ultrasonic Whisper depends on the hardware: many laptop speakers and some phone microphones roll off above 18 kHz. It is best-effort and untested on real devices so far; the identity QR stays the reference ceremony.
- The sound lane of Chimera Turbo is slow (≈ 0.7 droplet per second): it keeps a transfer alive while the camera is blocked, it does not make it much faster.
- WebRTC LAN needs both devices on the same Wi-Fi or hotspot, and mDNS host candidates must resolve between them (some managed networks block it). A neighbour who answers first gets the frame, which is still signed and optionally encrypted.
- Not done: IndexedDB storage (localStorage is used), X25519 key agreement (passphrase-based E2EE only), Supabase backend (replaced by `ghostpacket-verifier`).
