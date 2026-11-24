# Design — 4-FSK acoustic modem

## Parameters
| Parameter | Robust (field) | Fast (demo) |
|---|---|---|
| Symbol duration Ts | 15 ms | 6 ms |
| Analysis window Tw | 12.5 ms (1.25 ms margin) | 5 ms (0.5 ms margin) |
| Bit rate | 133 bit/s | 333 bit/s |
| Data carriers | 1600 / 2000 / 2400 / 2800 Hz | same |
| Sync carriers | 1200 / 3200 Hz | same |
| 296 B frame (tontine, 1354 symbols) | ≈ 20.3 s | ≈ 8.1 s |
| 350 B frame (prescription, 1570 symbols) | ≈ 23.6 s | ≈ 9.4 s |

**Orthogonality**: Δf · Tw = 400 Hz × 5 ms = 2 and 400 Hz × 12.5 ms = 5 whole cycles. Neighbouring tones fall on a zero of the Goertzel detector, whatever the sample rate. The margin absorbs short echoes; the timing tracker below absorbs clock drift.

## Burst
```text
symbols: [lead@1200, ramp][B1..B13 Barker][G G G @1200][24-symbol header][data][tail@1200, ramp]
header : RS(6,2) of the u16 BE length
data   : for each block ≤ 239 B: 4 symbols per byte of (block ‖ 16 RS parity bytes)
Gray   : 00→1600, 01→2000, 11→2400, 10→2800 Hz
```
Synthesis: continuous `f64` phase accumulator across symbols (CPFSK), amplitude 0.7. Symbol k starts at `round(k · Ts · Fs)`, with no cumulative drift.

## Demodulation
```mermaid
flowchart LR
    S[f32 PCM] --> C["Ts/8 grid: contrast r = (E3200 − E1200)/(E3200 + E1200)"]
    C --> K[Barker correlation by lookup]
    K --> F[Fine pass ±Ts/3, 1-sample step]
    F --> P[Plateau centre ⇒ t0]
    P --> H[24 symbols ⇒ RS(6,2) ⇒ length]
    H --> D[RS(n, n−16) blocks, early-late timing tracking]
    D --> R[Frame + metrics]
```
- The score is normalized to [−1, 1], so microphone gain does not matter.
- Plateau: every window position inside the symbols gives the same score. Its centre aligns the window with the middle of the symbol.
- Symbol SNR = 10·log10(E_max / mean of the 3 others).

## Clock tracking (early-late gate)
Two devices never share the same audio clock. Without correction, a 300 ppm drift moves the window by 0.3 ms per second, several milliseconds by the end of a robust burst. A first "air" test showed `FEC_UNCORRECTABLE` failures from ±300 ppm with no echo, and from ±100 ppm with echo.

For each symbol, the reader measures the energy of the decided tone on two windows shifted by ± the margin. If the symbol arrives late, the early window spills into the previous symbol and loses energy, and the other way round. The cumulative offset is corrected by `0.35 × (L − E)/(L + E) × margin` on every symbol.

| Mode | Fs | Drift | Dry / room (3 and 9 ms) / hall (7 and 20 ms), 12 dB |
|---|---|---|---|
| Robust | 48 kHz, 44.1 kHz | −300 to +300 ppm | 100 % (≤ 5 bytes corrected by RS) |
| Fast | 48 kHz | −300 to +300 ppm | 100 % (≤ 5 bytes corrected by RS) |

Test: `survives_clock_drift_and_room_echo` in `tests/noise_fsk_fuzz.rs`.

## Browser validation of the microphone path
Chrome gets a fake microphone (`--use-file-for-fake-audio-capture`) fed with a robust burst of the prescription (350 B), with 100 ppm drift, two echoes and noise at 15 dB. The path `getUserMedia` → AudioWorklet → ring buffer → `fsk_demodulate` shows `SYNC LOCK` after about 3 s, then `ED25519 VERIFIED` after 26.3 s (the burst lasts ≈ 23.6 s).

## Reed-Solomon
GF(256), polynomial 0x11D, α = 2, first root α⁰, systematic encoding. Decoding: syndromes, Berlekamp-Massey, Chien search, Forney. Shortened codes (n < 255) are supported: an error located outside the codeword gives `FEC_UNCORRECTABLE`.

## Measured results (`cargo test --release --test noise_fsk_fuzz -- --nocapture`)
| Mode | Fs | SNR | Success |
|---|---|---|---|
| Fast | 48 kHz | 20, 15, 12, 10 dB | 100 % |
| Fast | 48 kHz | 8, 6 dB | 100 % |
| Robust | 44.1 kHz | 15, 10 dB | 100 % |

The Goertzel processing gain (≈ Tw·Fs/2 = 120 in fast mode, about 21 dB) explains the margin: at 6 dB wideband SNR, the per-symbol SNR stays around 25 dB.

## WASM API
| Function | Role |
|---|---|
| `fsk_modulate(frame, fs, mode)` | `Float32Array` PCM |
| `fsk_demodulate(samples, fs, mode)` | metrics + `frame` |
| `fsk_burst_seconds(len, mode)` | burst duration |
| `inject_awgn(samples, snrDb, seed)` | deterministic noise |
| `new Spectrum(1024).compute(samples)` | 512 magnitudes in dBFS |
