---
inclusion: always
---

# GhostPacket — Product

## Problem
In low-coverage areas (markets, rural clinics, savings groups, disaster zones), two nearby devices need to exchange a short document and **prove it is authentic** with no Internet, no server and no Bluetooth pairing.

## Solution
GhostPacket turns a structured document into an **Ed25519-signed binary frame of at most 512 bytes**, then sends it over one of two one-way physical channels:
- **Channel A (sound)**: continuous-phase 4-FSK modem, speaker → microphone.
- **Channel B (light)**: Luby Transform fountain codes shown as a burst of QR codes, screen → camera.

The receiver rebuilds the frame, checks CRC32 then Ed25519, and shows either the document or an **explicit rejection**.

## Personas
- **Tontine treasurer** (Dakar): hands a member a signed contribution receipt, offline.
- **Rural clinician**: sends a verifiable prescription to the nearby pharmacy.
- **Aid distributor**: issues an offline, tamper-proof relief voucher.
- **Kiroween judge**: must see the whole system work in **under 30 seconds, in 1 click, with no microphone or camera**.

## Non-negotiable product rules
1. The full demo runs in 1 click in under 30 s thanks to the virtual loopback (no hardware needed).
2. Any altered data is rejected with a readable error code (`CRC32_MISMATCH`, `INVALID_SIGNATURE`, …).
3. No network call at runtime, no secret or API key in the client.
4. Local operations (encode, verify, FFT) answer in under 500 ms (median).
5. If the microphone or camera is unavailable, the app falls back to the virtual loopback on its own.

## Language
Everything a judge sees or reads is in English: UI, error messages, `.kiro/` documents, README. Field presets keep their authentic Senegalese place and person names.

## Tone and visual identity
"Spectral Signal Lab" theme: dark background, ectoplasm green, oscilloscope traces. The name *GhostPacket* evokes a packet that crosses the air with no wire.
