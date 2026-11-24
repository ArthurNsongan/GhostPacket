# Requirements — Channel A, 4-FSK acoustic modem

## Introduction
Channel A carries a GPKT frame from one device's speaker to another device's microphone, with no return channel.

## Requirements

### Requirement 1 — Modulation
**User story:** As an emitter, I want a clean audible signal that a phone microphone can read.

#### Acceptance criteria
1. THE SYSTEM SHALL modulate continuous-phase 4-FSK, 2 bits per symbol (Gray coding), on 1600, 2000, 2400 and 2800 Hz.
2. THE SYSTEM SHALL precede the data with a Barker-13 preamble (+1 = 3200 Hz, −1 = 1200 Hz) followed by 3 guard symbols at 1200 Hz.
3. THE SYSTEM SHALL offer two modes: robust (15 ms per symbol, 133 bit/s) and fast (6 ms per symbol, 333 bit/s).
4. THE SYSTEM SHALL apply a raised-cosine ramp to the first and last symbol of the burst (no audible click).
5. THE SYSTEM SHALL use the actual sample rate of the `AudioContext` (8 to 192 kHz).

### Requirement 2 — Protection
#### Acceptance criteria
1. THE SYSTEM SHALL send the frame length in a Reed-Solomon header (2 bytes + 4 parity bytes).
2. THE SYSTEM SHALL split the frame into blocks of at most 239 bytes, each followed by 16 Reed-Solomon GF(256) parity bytes, so 8 bytes can be corrected per block.
3. IF a block holds more errors than can be corrected, THEN THE SYSTEM SHALL reject with `FEC_UNCORRECTABLE`.

### Requirement 3 — Demodulation
**User story:** As a receiver, I want to find the burst anywhere in a noisy recording.

#### Acceptance criteria
1. THE SYSTEM SHALL locate the preamble by Barker correlation on the Goertzel 3200/1200 Hz contrast, in two passes (grid of Ts/8, then 1 sample).
2. IF no correlation peak exceeds 0.55, THEN THE SYSTEM SHALL answer `FSK_NO_PREAMBLE`.
3. IF the recording stops before the preamble is complete, THEN THE SYSTEM SHALL answer `FSK_TOO_SHORT`.
4. IF the preamble is locked but the burst is not complete yet, THEN THE SYSTEM SHALL answer `FSK_INCOMPLETE` with the sync offset, so that the receiver can show `SYNC LOCK` and keep listening.
5. THE SYSTEM SHALL decide each symbol as the argmax of the 4 Goertzel energies over a centred window (5 ms in fast mode, 12.5 ms in robust mode).
6. THE SYSTEM SHALL report the sync offset, the preamble score, the mean and minimum symbol SNR and the number of corrected bytes.
7. IF the input holds more than 48000 × 40 samples, THEN THE SYSTEM SHALL refuse it with `TOO_MANY_SAMPLES`.

### Requirement 4 — Robustness
#### Acceptance criteria
1. WHILE the SNR is at least 10 dB, THE SYSTEM SHALL decode 100 % of the test bursts (3 presets, several seeds, gain 0.25–1, 0–500 ms of leading silence).
2. WHILE the SNR is between 6 and 8 dB, THE SYSTEM SHALL decode at least 95 % of the test bursts.
3. IF the input is pure noise, THEN THE SYSTEM SHALL never output a frame.
4. WHILE the receiver clock drifts by up to ±300 ppm and the room adds two echoes (up to 7 ms at 0.6 and 20 ms at 0.4), THE SYSTEM SHALL decode the frame at 12 dB SNR by tracking symbol timing (early-late gate).

### Requirement 5 — Spectrogram
#### Acceptance criteria
1. THE SYSTEM SHALL compute a 1024-point magnitude spectrum (dBFS) with a Hann window for display at 60 FPS.
