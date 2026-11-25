# Requirements — GhostPacket platform V2

## Introduction
V2 turns the single-page demo into a four-page product deployed on GitHub Pages: free-form signed messages, optional end-to-end encryption, an anti-replay ledger, a trusted keyring, an SDK for third-party apps, an offline service worker, and a dual-channel "Chimera race". Source: `UPGRADE_PLAN_V2.md`.

## Requirements

### Requirement 1 — Four-page site
**User story:** As a judge, I want a clear site structure, so that I can understand, try and test GhostPacket quickly.

#### Acceptance criteria
1. THE SYSTEM SHALL serve four static routes: `/` (Home), `/how-it-works/`, `/simulation/` and `/test/`, with a persistent navigation bar.
2. THE SYSTEM SHALL keep the WASM core and the session signing key loaded across client-side navigation.
3. WHEN the judge follows "Launch the 20 s simulation" from Home, THE SYSTEM SHALL open `/simulation/` and start the 1-click demo, finishing in under 20 s.
4. THE SYSTEM SHALL answer every route and prefetch request on GitHub Pages without a 404.

### Requirement 2 — Custom messages (doc type 0x04)
**User story:** As a user, I want to send my own words, so that GhostPacket is not limited to the three presets.

#### Acceptance criteria
1. THE SYSTEM SHALL encode `CustomMessage { sender ≤ 48 B, title ≤ 60 B, message ≤ 240 B }` with doc type 0x04.
2. THE SYSTEM SHALL guarantee that any message within these bounds, encrypted or not, fits in a 512-byte frame.
3. IF a field exceeds its bound, THEN THE SYSTEM SHALL refuse with `FIELD_TOO_LONG` and show live byte counters before encoding.
4. WHEN a custom message is verified, THE SYSTEM SHALL show its plaintext, sender, channel and Ed25519 status.

### Requirement 3 — Optional end-to-end encryption
**User story:** As a clinician, I want to encrypt a prescription played aloud in a waiting room, so that bystanders cannot read it.

#### Acceptance criteria
1. WHEN encryption is on, THE SYSTEM SHALL encrypt the payload with ChaCha20-Poly1305 under a key and nonce derived by PBKDF2-HMAC-SHA256 (40,000 iterations) from the passphrase and a fresh 16-byte random salt, and SHALL set flag bit 4 (`0x10`).
2. THE SYSTEM SHALL pass the 8-byte frame header as associated data and SHALL keep CRC32 and the Ed25519 signature over the ciphertext.
3. IF an encrypted frame is verified without a passphrase, THEN THE SYSTEM SHALL answer `PASSPHRASE_REQUIRED`; IF the passphrase is wrong or the ciphertext altered, THEN `DECRYPTION_FAILED`, with no plaintext.
4. IF encryption is on and the passphrase is empty, THEN THE SYSTEM SHALL not produce a frame (never fall back to plaintext).
5. THE SYSTEM SHALL normalize passphrases to Unicode NFC on both sides.
6. THE SYSTEM SHALL wipe derived keys and decrypted plaintext from WASM memory when they are dropped.

### Requirement 4 — Tamper lab
#### Acceptance criteria
1. WHEN the judge clicks any byte of the frame inspector, THE SYSTEM SHALL flip one of its bits and show which layer caught it (structure, CRC32, ChaCha20-Poly1305, decode, keyring, Ed25519).
2. THE SYSTEM SHALL offer one-click attacks: curse payload (`CRC32_MISMATCH`), curse signature (`INVALID_SIGNATURE`), forge with a rogue key (`UNTRUSTED_ISSUER`), wrong passphrase (`DECRYPTION_FAILED`, encrypted frames only), and a restore button.

### Requirement 5 — Anti-replay ledger
**User story:** As an aid distributor, I want a voucher presented twice to be refused, so that it cannot be redeemed twice offline.

#### Acceptance criteria
1. WHEN a frame is verified, THE SYSTEM SHALL record (issuer fingerprint, document id, signed timestamp, channel, time) in local storage.
2. WHEN the same document is verified again, THE SYSTEM SHALL show `REPLAY DETECTED · ALREADY REDEEMED` with the first redemption.
3. THE SYSTEM SHALL never store message text or decrypted content in the ledger.

### Requirement 6 — Trusted keyring
#### Acceptance criteria
1. THE SYSTEM SHALL show the emitter's identity QR `GPKT-KEY:<label>:<public key hex>`.
2. WHEN the receiver scans or pastes an identity, THE SYSTEM SHALL validate the key as an Ed25519 point and pin it.
3. WHILE strict mode is on, THE SYSTEM SHALL reject frames from unpinned issuers with `UNTRUSTED_ISSUER`.

### Requirement 7 — SDK
#### Acceptance criteria
1. THE SYSTEM SHALL provide `GhostPacketSDK` with `sealMessage`, `verifyFrame`, `transmitAcoustic`, `receiveAcoustic`, `transmitOptical`, `receiveOptical`, `exportGpktFile` and `importGpktFile`.
2. THE SYSTEM SHALL document integration snippets (vanilla JS, React, offline-to-cloud sync, Rust) and the `.gpkt` wire format.
3. WHEN a `.gpkt` file is dropped on the verifier, THE SYSTEM SHALL verify it locally (≤ 512 bytes) without uploading it.

### Requirement 8 — Offline guarantee
#### Acceptance criteria
1. THE SYSTEM SHALL register a same-origin service worker that caches the four pages, the WASM, the worklet and hashed assets.
2. WHEN the device is offline after a first visit, THE SYSTEM SHALL load the simulation from cache and show `OFFLINE · AIR-GAP ACTIVE`.

### Requirement 9 — Chimera dual-channel race
#### Acceptance criteria
1. WHEN the race starts, THE SYSTEM SHALL send the same frame over sound and light at the same time.
2. WHEN the judge jams the audio (−25 dB SNR) or blocks the camera (85 % loss) mid-flight, THE SYSTEM SHALL let the other channel finish and verify, and SHALL report the winner.
3. WHEN the second channel delivers the same document, THE SYSTEM SHALL flag it as a replay.

### Requirement 10 — Field robustness
#### Acceptance criteria
1. THE SYSTEM SHALL skip demodulation while the microphone only hears room noise (adaptive energy squelch).
2. WHILE the audio device runs above 50 kHz, THE SYSTEM SHALL decimate capture and synthesize playback at ≤ 48 kHz.
3. THE SYSTEM SHALL send field frames without the DEMO flag.
4. WHEN a droplet from a new session arrives, THE SYSTEM SHALL reset the fountain decoder and keep that droplet.

### Requirement 11 — Haunted precision UI
#### Acceptance criteria
1. THE SYSTEM SHALL show the Ether Conduit (live waveform, droplet orbs that shatter when lost), a Blood Moon alert on rejection, border spotlight, audio-reactive sigil, cascade badges and optional UI sounds (off by default, muted while the microphone listens).
2. THE SYSTEM SHALL show a Kiro Telemetry drawer with live WASM latencies, binary size, test count and the `.kiro/` architecture.
3. THE SYSTEM SHALL honour `prefers-reduced-motion`.
