---
inclusion: always
---

# GhostPacket — Product

## Problem
In low-coverage areas (markets, rural clinics, savings groups, disaster zones), two nearby devices need to exchange a short document and **prove it is authentic** with no Internet, no server and no Bluetooth pairing.

## Solution
GhostPacket turns a structured document into an **Ed25519-signed binary frame** (GPKT v1, at most 512 bytes; GPKT v2 up to 128 KB for a document with a photo), then sends it over one of two one-way physical channels:
- **Channel A (sound)**: continuous-phase 4-FSK modem, speaker → microphone.
- **Channel B (light)**: Luby Transform fountain codes shown as a burst of QR codes, screen → camera.
- **V3 high-speed modes** for larger frames: an OFDM chord over sound (≈ 4 kbit/s, ≤ 16 KB) and ChromaCrypt color matrices over light (≈ 36 kbit/s at 15 FPS, ≤ 128 KB).

The receiver rebuilds the frame, checks CRC32 then Ed25519, and shows either the document or an **explicit rejection**.

## Personas
- **Tontine treasurer** (Dakar): hands a member a signed contribution receipt, offline.
- **Rural clinician**: sends a verifiable prescription to the nearby pharmacy.
- **Aid distributor**: issues an offline, tamper-proof relief voucher.
- **Program back office**: once back online, collects the proofs from every field device and catches a voucher redeemed on two offline devices (double spend).
- **Integrating developer**: embeds the `ghostpacket-sdk` package in their own app.

## V3 apps (Skeleton Crew)
- **GhostClinic** (`/clinic/`): the nurse keeps the ward on the device, signs prescriptions (no patient name in the frame, optional E2EE) and hands them to the pharmacy phone. The pharmacy dispenses once.
- **GhostTontine** (`/tontine/`): the treasurer runs members and rounds, hands each member a signed receipt and issues single-use aid vouchers, which are paid out once at the pay-out desk.
- Both apps are built only from the skeleton (`ghostpacket-core`, `ghostpacket-sdk`, `ghostpacket-ui`). Each offers a virtual hand-over, so a judge needs one device and no permission.
- **Kiroween judge**: must see the whole system work in **under 30 seconds, in 1 click, with no microphone or camera**.

## Non-negotiable product rules
1. The full demo runs in 1 click in under 30 s thanks to the virtual loopback (no hardware needed).
2. Any altered data is rejected with a readable error code (`CRC32_MISMATCH`, `INVALID_SIGNATURE`, …). A valid signature alone never releases medicine or money: the apps redeem only documents of the expected type, without the DEMO flag, from a pinned issuer, and only once (append-only ledger that fails closed).
3. No network call at runtime, no secret or API key in the client. The only exception is opt-in: the proof outbox uploads verified frames to a `ghostpacket-verifier` URL that the user (or the integrating app) types in; with no URL set, nothing is sent. The URL must be `https://`, or `http://` on localhost only, and a verifier token is kept in memory, never stored.
4. Local operations (encode, verify, FFT) answer in under 500 ms (median).
5. If the microphone or camera is unavailable, the app falls back to the virtual loopback on its own.

## Language
Everything a judge sees or reads is in English: UI, error messages, `.kiro/` documents, README. Field presets keep their authentic Senegalese place and person names.

## Tone and visual identity
"Spectral Signal Lab" theme: dark background, ectoplasm green, oscilloscope traces. The name *GhostPacket* evokes a packet that crosses the air with no wire.
