# Requirements — GPKT binary protocol

## Introduction
The GPKT frame carries a compressed field document, protected by CRC32 and signed with Ed25519. It is identical on both physical channels.

## Requirements

### Requirement 1 — Frame format
**User story:** As a channel developer, I want a bit-exact format, so that emitter and receiver agree without negotiation.

#### Acceptance criteria
1. THE SYSTEM SHALL write, big-endian: `GPKT` preamble (4 B), version `0x01` (1 B), flags (1 B), length N (u16), payload (N B), CRC32 (4 B), Ed25519 signature (64 B).
2. THE SYSTEM SHALL define the flags as: bit 0 LZ4, bit 1 FSK, bit 2 fountain, bit 3 demo, bits 4 to 7 zero.
3. THE SYSTEM SHALL compute the CRC32 (IEEE) over bytes `0 .. 8+N`.
4. THE SYSTEM SHALL sign bytes `0 .. 12+N` (header, payload and CRC32).
5. IF a caller requests the LZ4 bit or a reserved bit, THEN THE SYSTEM SHALL refuse with `INVALID_FLAGS` (the LZ4 bit is decided by the encoder).

### Requirement 2 — Compact payload
**User story:** As an emitter, I want a 150 to 300 byte payload, so that the acoustic transmission lasts a few seconds.

#### Acceptance criteria
1. THE SYSTEM SHALL serialize the document with `postcard` (varints, no field names).
2. THE SYSTEM SHALL compress it as an LZ4 block prefixed with the decompressed size (u32 LE), and SHALL keep the compressed form only if it is shorter.
3. THE SYSTEM SHALL include the issuer's public key in the signed document, filled in by the encoder from the signing seed.
4. THE SYSTEM SHALL produce identical bytes for identical inputs.

### Requirement 3 — Ordered verification
**User story:** As a receiver, I want verification in a fixed order, so that I get the most precise error and nothing is allocated before validation.

#### Acceptance criteria
1. IF the frame is shorter than 77 or longer than 512 bytes, THEN THE SYSTEM SHALL reject with `FRAME_TOO_SHORT` or `FRAME_TOO_LARGE`.
2. IF the first 4 bytes are not `GPKT`, THEN THE SYSTEM SHALL reject with `INVALID_PREAMBLE`.
3. IF the version is not `0x01`, THEN THE SYSTEM SHALL reject with `UNSUPPORTED_VERSION`; IF a reserved bit is set, THEN THE SYSTEM SHALL reject with `INVALID_FLAGS`.
4. IF `76 + N` differs from the received size, THEN THE SYSTEM SHALL reject with `LENGTH_MISMATCH`.
5. IF the recomputed CRC32 differs, THEN THE SYSTEM SHALL reject with `CRC32_MISMATCH { expected, actual }`.
6. IF the declared decompressed size exceeds 4096 bytes, THEN THE SYSTEM SHALL reject with `DECOMPRESSED_TOO_LARGE` before any allocation.
7. IF the document is unreadable or out of bounds, THEN THE SYSTEM SHALL reject with `SCHEMA_DECODE_FAILED`, `FIELD_TOO_LONG` or `TOO_MANY_ITEMS`.
8. IF a non-empty trusted keyring does not contain the issuer's key, THEN THE SYSTEM SHALL reject with `UNTRUSTED_ISSUER`.
9. IF strict Ed25519 verification fails, THEN THE SYSTEM SHALL reject with `INVALID_SIGNATURE`.

### Requirement 4 — Inspection
**User story:** As a judge, I want to see each field of the frame and which one is broken, so that I understand the rejection.

#### Acceptance criteria
1. THE SYSTEM SHALL split any frame, even an invalid one, into fields `{name, offset, length, valid}`.
2. WHEN the CRC32 does not match, THE SYSTEM SHALL mark the `crc32` field invalid and show the stored and computed values.

### Requirement 5 — Issuer fingerprint
#### Acceptance criteria
1. THE SYSTEM SHALL show the `GPKT-XXXX-XXXX` fingerprint made of the first 4 bytes of SHA-256(public key).
