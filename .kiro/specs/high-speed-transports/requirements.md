# Requirements — High-speed transports, GPKT v2 and persistent issuer identity

## Introduction
V1 frames (≤ 512 bytes) fit a receipt or a prescription, not a photo. This spec adds the transports of `UPGRADE_PLAN_V3.md` §2 that carry larger signed documents:
- GPKT v2 frames up to 128 KB with an image document type;
- ChromaCrypt, a color matrix with a wide fountain code, over screen → camera;
- an acoustic OFDM modem over speaker → microphone.

It also adds a passphrase-sealed identity vault, so that an issuer's fingerprint survives a reload and a receiver's pin stays valid.

Ultrasonic pairing and the WebRTC LAN transport of the plan are out of scope for this iteration (see design.md).

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
