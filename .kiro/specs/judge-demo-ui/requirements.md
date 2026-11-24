# Requirements — Judge demo UI (Dual-Canvas)

## Introduction
The "Spectral Signal Lab" UI shows the emitter, the channel and the receiver on one page, and lets a judge check the whole system in one click with no hardware.

## Requirements

### Requirement 1 — 1-click demo
#### Acceptance criteria
1. WHEN the judge clicks "Summon the full demo", THE SYSTEM SHALL chain signing, noisy 4-FSK sound, lossy fountain QR, verification and a 1-bit curse.
2. WHILE the demo runs, THE SYSTEM SHALL show the active step, the elapsed time and a "Stop" button.
3. WHEN the demo ends, THE SYSTEM SHALL show the total duration and the result of each channel.
4. THE SYSTEM SHALL finish the demo with default settings (10 dB, 30 % loss, 12 FPS) in under 30 s.

### Requirement 2 — Emitter column
#### Acceptance criteria
1. THE SYSTEM SHALL offer the three presets (Dakar Tontine Receipt, Ndiob Rural Clinic Prescription, Kaolack Flood Relief Voucher) and JSON editing of the document.
2. WHEN the document changes, THE SYSTEM SHALL re-encode the frame and show the JSON, postcard, payload and frame sizes against the 512-byte limit.
3. IF encoding fails, THEN THE SYSTEM SHALL show the error code (`FIELD_TOO_LONG`, `PAYLOAD_TOO_LARGE`, …).
4. THE SYSTEM SHALL show the QR code of the current droplet.

### Requirement 3 — Channel column
#### Acceptance criteria
1. THE SYSTEM SHALL offer an SNR slider (0–25 dB), a loss slider (0–60 %) and a frame-rate slider (4–20 FPS).
2. THE SYSTEM SHALL show the time-domain trace of the acoustic channel and the history of QR frames (received, lost, unreadable, duplicate).
3. WHEN the judge clicks "Curse 1 bit", THE SYSTEM SHALL flip one payload bit and show the rejection.

### Requirement 4 — Receiver column
#### Acceptance criteria
1. THE SYSTEM SHALL show an FFT spectrogram (computed in WASM) with 1200 to 3200 Hz markers and a `SYNC LOCK` light that turns on as soon as the preamble is locked.
2. THE SYSTEM SHALL show the K fountain blocks, their cascade resolution and any use of Gauss elimination.
3. WHEN a frame is verified, THE SYSTEM SHALL show `ED25519 VERIFIED`, the issuer fingerprint and the document.
4. WHEN a frame is rejected, THE SYSTEM SHALL show `REJECTED · <CODE>` and the message, without showing the document.

### Requirement 5 — Frame inspector
#### Acceptance criteria
1. THE SYSTEM SHALL show every byte of the frame coloured by field, with the validity of each field.
2. WHEN a bit has been flipped, THE SYSTEM SHALL highlight the affected byte in red.

### Requirement 6 — Field mode
#### Acceptance criteria
1. THE SYSTEM SHALL offer an emitter role (speaker, full-screen QR) and a receiver role (microphone, rear camera).
2. IF a hardware permission is denied, THEN THE SYSTEM SHALL return to the virtual lab with an explanatory banner.

### Requirement 7 — Accessibility and identity
#### Acceptance criteria
1. THE SYSTEM SHALL honour `prefers-reduced-motion`.
2. THE SYSTEM SHALL expose ARIA labels on canvases, tabs and sliders.
3. THE SYSTEM SHALL apply the visual system of `.kiro/steering/ui-design-system.md`, with self-hosted fonts and English copy.
