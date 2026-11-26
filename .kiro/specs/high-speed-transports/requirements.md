# Requirements — High-speed transports, GPKT v2 and persistent issuer identity

## Introduction
V1 frames (≤ 512 bytes) fit a receipt or a prescription, not a photo. This spec adds the transports of `UPGRADE_PLAN_V3.md` §2 that carry larger signed documents:
- GPKT v2 frames up to 128 KB with an image document type;
- ChromaCrypt, a color matrix with a wide fountain code, over screen → camera;
- an acoustic OFDM modem over speaker → microphone.

It also adds a passphrase-sealed identity vault, so that an issuer's fingerprint survives a reload and a receiver's pin stays valid.

Phase 3 (requirements 5–9) adds the round ledger of GhostTontine, Chimera Turbo (light and sound feeding one decoder), Ultrasonic Whisper, the WebRTC LAN link signaled over the air, and end-to-end encryption for images in the high-speed lab.

## Requirements

### Requirement 1 — GPKT v2 and image documents
**User story:** As a rural clinician, I want to attach a photo of a rapid test to a prescription, so that the pharmacy or a specialist sees the evidence.

#### Acceptance criteria
1. THE SYSTEM SHALL encode version 0x02 frames that are identical to v1 except for a u32 BE payload length, with a payload of at most 128 KB (frame ≤ 131 150 bytes). V1 frames SHALL stay byte-for-byte unchanged.
2. THE SYSTEM SHALL verify v1 and v2 frames in the same order: size → preamble → version/flags → length → CRC32 → decrypt → bounded LZ4 → schema → keyring → Ed25519.
3. THE SYSTEM SHALL bound the declared length, the v2 frame size (131 150 bytes) and the decompressed size (136 KB) before any allocation.
4. THE SYSTEM SHALL provide an `ImageDocument` (doc type 0x05): title, subject reference, caption, related document id, MIME type (WebP, JPEG, PNG), width, height and image bytes of at most 64 KB. It SHALL check the container magic bytes and the dimensions (1..4096).
5. WHEN an image document is verified, THE SYSTEM SHALL report the SHA-256 of the image.
6. THE SYSTEM SHALL re-encode a user image on the device to a budget (Micro 4 KB, Standard 15 KB, High 48 KB) with the browser's own encoder, and SHALL show the result before signing.
7. THE SYSTEM SHALL display a received image only after the whole frame has been verified.

### Requirement 2 — ChromaCrypt optical transport
#### Acceptance criteria
1. THE SYSTEM SHALL draw a 44 × 44 matrix of 8 colors (3 bits per cell) with four finder patterns and a calibration strip. Each matrix SHALL carry 525 bytes protected by three interleaved Reed-Solomon codewords (32 parity bytes each).
2. THE SYSTEM SHALL split any frame into wide-fountain droplets (K ≤ 512, block ≤ 1024 bytes, CRC32 per droplet) and SHALL rebuild it from any sufficient subset.
3. THE SYSTEM SHALL locate the matrix in a camera image, correct moderate perspective with a homography, learn the colors from the calibration strip, and tolerate white-balance shift, reduced contrast and sensor noise.
4. WHILE 30 % of the matrices are lost, THE SYSTEM SHALL rebuild a 16 KB frame on average within 1.15 × K received matrices.
5. THE SYSTEM SHALL reject unreadable images, foreign sessions and hostile droplet headers with explicit codes (`CHROMA_NOT_FOUND`, `CHROMA_UNCORRECTABLE`, `DROPLET_SESSION_MISMATCH`, `DROPLET_INVALID`), never with a panic.

### Requirement 3 — Acoustic OFDM
#### Acceptance criteria
1. THE SYSTEM SHALL modulate frames up to 16 KB on 32 subcarriers (≈ 1.5–7.4 kHz at 48 kHz) with differential QPSK, a cyclic prefix and Reed-Solomon (255, 223), at about 4 kbit/s.
2. THE SYSTEM SHALL find the burst with a matched-filter chirp and SHALL follow a sampling-clock offset of ±300 ppm over a 33 s burst.
3. THE SYSTEM SHALL decode at 12 dB SNR and above, with room echo inside the cyclic prefix, with a receiver 30 dB quieter, and with hard clipping.
4. THE SYSTEM SHALL keep sound effects silent while an OFDM burst plays or the microphone listens.

### Requirement 4 — Persistent issuer identity
**User story:** As a pharmacist, I want to pin my clinic's key once, so that every later prescription from it is accepted without a new ceremony.

#### Acceptance criteria
1. THE SYSTEM SHALL seal a 32-byte signing seed in a 101-byte vault (PBKDF2-HMAC-SHA256 210 000 iterations, ChaCha20-Poly1305, fresh 16-byte salt). The vault's public key SHALL be authenticated data, and a passphrase of at least 10 bytes SHALL be required.
2. IF the passphrase is wrong, the vault is altered or its public key is swapped, THEN THE SYSTEM SHALL answer `VAULT_INVALID`.
3. THE SYSTEM SHALL store only the sealed vault, in the issuer app's own storage namespace, and SHALL show its fingerprint before unlocking.
4. WHEN an issuer app starts, THE SYSTEM SHALL offer to create, to unlock, or to continue with a session key for the demo.

### Requirement 5 — Round ledger (LedgerBatchDelta)
**User story:** As a tontine treasurer, I want to broadcast the whole round to every member phone in the room at once, so that each member can check that their contribution is on the signed list.
#### Acceptance criteria
1. THE SYSTEM SHALL provide a `LedgerBatchDelta` document (doc type 0x06): group, treasurer, currency, round, 1 to 64 entries (member ≤ 64 B, amount, 8-byte receipt id) and a note.
2. IF the list is empty, has more than 64 entries or repeats a receipt id, THEN THE SYSTEM SHALL refuse it (`LEDGER_BATCH_INVALID`, `TOO_MANY_ITEMS`).
3. THE SYSTEM SHALL use a GPKT v1 frame when the ledger fits in 512 bytes and a v2 frame otherwise.
4. WHEN a member phone verifies a round ledger from a pinned treasurer, THE SYSTEM SHALL keep it once (anti-replay) and SHALL list the receipts of the wallet that the ledger confirms.
### Requirement 6 — Chimera Turbo
**User story:** As a judge, I want to cover the camera or jam the sound in the middle of an image transfer and see it finish anyway.
#### Acceptance criteria
1. THE SYSTEM SHALL send the same wide-fountain droplets as ChromaCrypt matrices and as OFDM bursts, each burst carrying whole droplets back to back ("bundle", ≤ 16 KB), with sound seeds disjoint from matrix seeds.
2. THE SYSTEM SHALL feed droplets from both channels into one decoder, counting a corrupt droplet of a bundle without dropping the others.
3. WHILE one channel is blocked, THE SYSTEM SHALL keep the droplets already received and SHALL complete with the other channel.
4. THE SYSTEM SHALL bound bundles to 16 KB and refuse truncated or malformed bundles (`DROPLET_INVALID`).
### Requirement 7 — Ultrasonic Whisper
**User story:** As a clinician, I want my key to reach the pharmacist's phone without a QR or an audible screech.
#### Acceptance criteria
1. THE SYSTEM SHALL modulate frames of at most 256 bytes with the 4-FSK modem moved to 17.6–19.6 kHz (data tones 18.0–19.2 kHz, 5 ms symbols, 400 bit/s), and SHALL refuse sample rates under 44.1 kHz.
2. THE SYSTEM SHALL keep the energy under 16 kHz at least 30 dB below the signal.
3. THE SYSTEM SHALL decode at 10 dB SNR at 44.1 and 48 kHz.
4. THE SYSTEM SHALL carry a signed identity card (label only) and SHALL let the receiver pin the key after the fingerprint is compared.
### Requirement 8 — WebRTC LAN link
**User story:** As a field worker on a shared hotspot without Internet, I want to send a large signed file in milliseconds once the devices are paired over the air.
#### Acceptance criteria
1. THE SYSTEM SHALL open a WebRTC DataChannel with no ICE server (host candidates only), no signaling server and no network call outside the local network.
2. THE SYSTEM SHALL compact the offer and the answer to a short code (ICE credentials, DTLS SHA-256 fingerprint, DTLS role, at most 4 host candidates) carried by one QR code or one OFDM burst.
3. THE SYSTEM SHALL parse a received code field by field against strict patterns and SHALL rebuild the SDP from the validated fields only.
4. THE SYSTEM SHALL bound each message to one GPKT v2 frame (131 150 bytes) and SHALL verify every frame received in the core.
### Requirement 9 — Encrypted images in the high-speed lab
#### Acceptance criteria
1. THE SYSTEM SHALL let the sender seal an image frame with the optional ChaCha20-Poly1305 encryption on every transport of the lab.
2. WHEN an encrypted frame arrives without the passphrase, THE SYSTEM SHALL answer `PASSPHRASE_REQUIRED` and SHALL let the receiver enter the shared passphrase to decrypt and verify.
