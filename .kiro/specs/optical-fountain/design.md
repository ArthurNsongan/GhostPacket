# Design — Optical fountain codes

## Droplet
```text
Offset  Size    Field
0       2       Magic "GQ"
2       2       Session (u16 BE)
4       1       K
5       1       Block size (8..64, default 16)
6       2       Frame length (u16 BE, ≤ 512)
8       4       Seed (u32 BE)
12      B       XOR of the selected blocks
12+B    2       CRC-16/CCITT-FALSE of bytes 0..12+B
```
30 bytes ⇒ 60 uppercase hexadecimal characters ⇒ 29×29-module QR (alphanumeric version 3-M, capacity 61).

## PRNG and indices
- `splitmix64(session << 32 | seed)` seeds `xorshift64*`.
- Bounded draws use the **high 32 bits**: `((x >> 32) · n) >> 32`. The low bits of `xorshift64*` are correlated; a first version with `x % n` left one block never covered on some sessions (bug found by the fuzz test, seed 9).
- Indices are drawn without replacement into a `u64` mask (K ≤ 64).

## Degree distribution
| Degree | Probability | Role |
|---|---|---|
| 1 | 20 % | starts peeling |
| 2 | 35 % | carries cascades |
| 3 | 20 % | |
| max(4, K/3) .. max(4, K/2) | 25 % | dense droplets: cover forgotten blocks, make elimination possible early |

The 25/45/20/10 distribution from the initial plan needed 1.47 K received droplets on average and failed on some seeds: for K ≈ 20, a block often stays uncovered (coupon-collector effect). The dense "spike" brings the average down to about 1.23 K.

## Decoder
```mermaid
flowchart TD
    R[Droplet] --> V{CRC16 + session}
    V -->|invalid| X[Error, state unchanged]
    V --> D{Seed already seen?}
    D -->|yes| DUP[Duplicate]
    D --> RED[Reduce by known blocks]
    RED -->|degree 1| RES[Resolve + cascade over pending equations]
    RED -->|degree ≥ 2| PEND[Pending queue ≤ 256]
    RED -->|degree 0| DROP[Redundant]
    RES --> G{Incomplete and resolved + pending ≥ K?}
    PEND --> G
    G -->|yes| GJ[Gauss-Jordan GF(2) on u64 masks]
    G -->|no| OUT[DropletStep]
    GJ --> OUT
```

## Browser validation of the camera path
Chrome gets a fake camera (`--use-file-for-fake-video-capture`): a 640×480 Y4M at 8 FPS of blurred QR codes (3×3 blur) on a dark background. The path `getUserMedia` → `jsQR` (BarcodeDetector is missing in headless mode) → `FountainRx` rebuilds the 20 blocks of the voucher and shows `ED25519 VERIFIED` in 3.6 s.

## Measured results (100 seeds, receiver joins mid-stream)
| Preset | K | Loss | Received (avg) | Shown (avg) | Worst case shown |
|---|---|---|---|---|---|
| Tontine | 19 | 30 % | 23.7 (1.25 K) | 34.2 | 60 (6.0 s at 10 FPS) |
| Prescription | 22 | 30 % | 27.6 (1.25 K) | 39.7 | 71 |
| Voucher | 20 | 30 % | 24.4 (1.22 K) | 35.3 | 62 |
| Tontine | 19 | 40 % | 23.9 | 39.9 | 86 |
| Tontine | 19 | 50 % | 23.4 | 46.9 | 86 |

At 12 FPS and 30 % loss, a transmission takes about 3 s on average.

## WASM API
| Class | Methods |
|---|---|
| `FountainTx(frame, session, blockSize)` | `k()`, `dropletLen()`, `droplet(seed)`, `nextDroplet()` |
| `FountainRx()` | `ingest(bytes) → DropletStep`, `frame()`, `stats()`, `reset()` |
| `is_dropped(seed, index, pct)` | deterministic simulated loss |
