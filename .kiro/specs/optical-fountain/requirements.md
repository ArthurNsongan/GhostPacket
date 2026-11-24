# Requirements — Channel B, fountain-coded optical stream

## Introduction
Channel B loops QR codes holding Luby Transform droplets. The receiver films the screen and rebuilds the GPKT frame, even when it misses part of the images, without ever answering the emitter.

## Requirements

### Requirement 1 — Droplets
#### Acceptance criteria
1. THE SYSTEM SHALL split the frame into K blocks of 16 bytes (the last block zero-padded), with 1 ≤ K ≤ 64.
2. THE SYSTEM SHALL emit droplets `[GQ][session u16][K u8][block size u8][frame length u16][seed u32][XOR of blocks][CRC16]`, so 30 bytes for 16-byte blocks.
3. THE SYSTEM SHALL derive each droplet's degree and indices from an `xorshift64*` PRNG seeded with (session, seed), identical on both sides.
4. THE SYSTEM SHALL encode each droplet as 60 uppercase hexadecimal characters (alphanumeric QR, version 3, error correction M).

### Requirement 2 — Degree distribution
#### Acceptance criteria
1. THE SYSTEM SHALL draw the degree with 20 % d = 1, 35 % d = 2, 20 % d = 3 and 25 % d ∈ [max(4, K/3), max(4, K/2)].

### Requirement 3 — Decoding
**User story:** As a receiver, I want to see the blocks resolve in a cascade, so that I understand the progress.

#### Acceptance criteria
1. IF a droplet has an invalid CRC16, THEN THE SYSTEM SHALL ignore it with `DROPLET_CRC_MISMATCH` and leave the state unchanged.
2. IF a droplet belongs to another session, THEN THE SYSTEM SHALL answer `DROPLET_SESSION_MISMATCH`.
3. WHEN an already received droplet comes back, THE SYSTEM SHALL count it as a duplicate without processing it again.
4. WHEN a reduced equation has a single unknown block left, THE SYSTEM SHALL resolve that block and propagate it to the pending droplets (peeling decoder).
5. WHEN peeling stalls while resolved + pending ≥ K, THE SYSTEM SHALL attempt Gauss-Jordan elimination over GF(2).
6. THE SYSTEM SHALL report after each droplet: resolved blocks (mask), new blocks, cascade depth, resolution by elimination, counters, completion.
7. THE SYSTEM SHALL bound memory to 256 pending equations and 4096 seen seeds.

### Requirement 4 — Robustness
#### Acceptance criteria
1. WHILE 30 % of the QR frames are lost, THE SYSTEM SHALL rebuild the frame for 100 seeds out of 100 within 4K displayed images.
2. WHILE 40 % (resp. 50 %) of the QR frames are lost, THE SYSTEM SHALL rebuild the frame for 100 seeds out of 100 within 5K (resp. 6K) images.
3. WHEN the frame is rebuilt, THE SYSTEM SHALL pass it to the full GPKT verification.
4. THE SYSTEM SHALL work when the receiver starts in the middle of the stream.

### Requirement 5 — Capture
#### Acceptance criteria
1. WHERE `BarcodeDetector` is available, THE SYSTEM SHALL use it; otherwise THE SYSTEM SHALL use `jsQR`.
2. WHILE the camera is unavailable, THE SYSTEM SHALL decode the QR codes rendered in a virtual canvas (loopback).
