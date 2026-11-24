# Requirements — GhostPacket core system

## Introduction
GhostPacket syncs a short signed document between two nearby devices with no network, over sound (4-FSK) or light (fountain QR). This document refines US-01 to US-04 from the brief (`ghostpacket.md`) and adds US-05 (field mode) and US-06 (zero-secret audit).

**US-02 clarification**: the "160 bytes/characters" limit in the brief refers to USSD. For GhostPacket the physical bound is a **complete binary frame of at most 512 bytes**, with a compressed payload target of 150 to 300 bytes for the presets.

## Requirements

### Requirement 1 — Instant execution (US-01)
**User story:** As a judge, I want to run a complete scenario in 1 click from the deployed web app, so that I can check that the engine really works.

#### Acceptance criteria
1. WHEN the judge clicks "Summon the full demo", THE SYSTEM SHALL chain encoding and signing, noisy acoustic transmission, lossy optical transmission, Ed25519 verification and a 1-bit tamper test with no further interaction.
2. WHEN the 1-click demo runs, THE SYSTEM SHALL finish the scenario in under 30 seconds.
3. THE SYSTEM SHALL run the 1-click demo with no microphone, no camera and no browser permission.
4. WHILE the demo runs, THE SYSTEM SHALL show the current step and the elapsed time.

### Requirement 2 — Strict physical bounds (US-02)
**User story:** As the protocol engine, I want every payload to respect a fixed bound, so that transmission stays short on slow channels.

#### Acceptance criteria
1. THE SYSTEM SHALL produce frames of at most 512 bytes (76 bytes of overhead + payload N, 1 ≤ N ≤ 436).
2. IF a serialized and compressed document exceeds 436 bytes, THEN THE SYSTEM SHALL refuse to encode it with code `PAYLOAD_TOO_LARGE`.
3. IF a text field exceeds its bound (64 bytes, 120 for the note), THEN THE SYSTEM SHALL refuse to encode it with `FIELD_TOO_LONG`.
4. THE SYSTEM SHALL encode the three field presets with a payload between 150 and 300 bytes.

### Requirement 3 — Integrity check (US-03)
**User story:** As a receiver, I want any altered data to be rejected with an explicit message, so that I never accept a forged document.

#### Acceptance criteria
1. WHEN any single bit of a valid frame is flipped, THE SYSTEM SHALL reject the frame.
2. IF the recomputed CRC32 differs from the stored CRC32, THEN THE SYSTEM SHALL reject with `CRC32_MISMATCH` and show both values.
3. IF the Ed25519 signature does not match, THEN THE SYSTEM SHALL reject with `INVALID_SIGNATURE`.
4. WHEN a frame is rejected, THE SYSTEM SHALL show a stable `SCREAMING_SNAKE_CASE` code and an English message.

### Requirement 4 — Offline resilience and fallback (US-04)
**User story:** As a field user, I want the app to keep working with no external service, so that I am never blocked.

#### Acceptance criteria
1. THE SYSTEM SHALL make no network call to encode, transmit or verify.
2. IF the microphone or camera is denied or unavailable, THEN THE SYSTEM SHALL switch to the virtual loopback automatically and say so, without interrupting the scenario.
3. IF `BarcodeDetector` is not available, THEN THE SYSTEM SHALL decode QR codes with `jsQR`.
4. THE SYSTEM SHALL load the WASM module and the fonts from the app's own origin, with no CDN.

### Requirement 5 — Real field mode (US-05)
**User story:** As a tontine treasurer, I want to send a receipt from my computer to a phone in airplane mode, so that I can hand over proof with no network.

#### Acceptance criteria
1. WHEN the user picks the field emitter role, THE SYSTEM SHALL send the frame through the speaker (robust FSK mode, 15 ms per symbol) and show the fountain QR stream full screen.
2. WHEN the user picks the field receiver role, THE SYSTEM SHALL listen to the microphone and/or film with the rear camera until a valid frame is rebuilt.
3. WHEN a frame is rebuilt in field mode, THE SYSTEM SHALL show the document, the issuer's `GPKT-XXXX-XXXX` fingerprint and the verification status.

### Requirement 6 — Zero-secret audit (US-06)
**User story:** As a maintainer, I want an automatic audit, so that no secret and no external tool file gets published.

#### Acceptance criteria
1. THE SYSTEM SHALL contain no API key and no secret in `web/src` and `mcp-server/src`.
2. THE SYSTEM SHALL generate the emitter's signing key in the browser (`crypto.getRandomValues`) and never transmit it.
3. WHEN a Kiro agent finishes a task, THE SYSTEM SHALL run the `kiroween-audit` hook (git, licence, secrets, panics, WASM size, tests).

## Global criteria
- Median time of local WASM operations < 500 ms (encode and verify < 15 ms).
- 100 % of the constraint tests (length, checksum, state transitions) pass through the Kiro hooks.
- No secret or API key on the client side.
