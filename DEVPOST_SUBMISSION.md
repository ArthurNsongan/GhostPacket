# GhostPacket: Devpost submission (ready to paste)

**Category:** Skeleton Crew · **Live demo:** https://arthurnsongan.github.io/GhostPacket/ · **Code:** https://github.com/ArthurNsongan/GhostPacket (MIT)

---

## Tagline
Signed documents over sound and light, with no network.

## 30-second pitch
When the network drops in a rural clinic or a savings group, two phones can still trade a document and prove who signed it. GhostPacket seals a receipt, a prescription or a clinical photo into an Ed25519-signed frame and sends it through the air: speaker to microphone, or screen to camera. The receiver verifies it, or rejects it with the exact reason. A voucher is paid once, even offline. Open the link, click *Launch the 20 s simulation*: no microphone, no camera, no install.

## Inspiration
In Senegal, a tontine treasurer collects cash at the market and a nurse in Ndiob writes prescriptions for the pharmacy next door. Paper receipts get forged, and data plans run out. We wanted proof of authenticity that needs nothing but the speaker, screen and camera every phone already has, and that still works when the network does not.

## What it does
- **Seals** a document (receipt, prescription, aid voucher, free message, photo, or a whole savings round) into a GPKT frame: postcard + LZ4, CRC32, Ed25519. GPKT v1 is ≤ 512 bytes; v2 carries up to 128 KB, enough for a clinical photo. Optional ChaCha20-Poly1305 encryption under a shared passphrase.
- **Sends** it through the air:
  - sound: a 4-FSK modem (133–333 bit/s), a 32-subcarrier OFDM chord (≈ 4 kbit/s) and an Ultrasonic Whisper at 17.6–19.6 kHz for key exchange;
  - light: fountain-coded QR codes and ChromaCrypt, 8-color matrices with a wide fountain code (a 12 KB photo in ≈ 2.8 s with 30 % of the matrices lost);
  - both at once: **Chimera Turbo** feeds one decoder from light and sound, so covering the camera or jamming the speaker slows a transfer but never restarts it;
  - a **WebRTC LAN link** paired over the air (QR or OFDM), with no server at all.
- **Verifies** in a fixed order (size, preamble, version, length, CRC32, decryption, bounded decompression, schema, keyring, strict Ed25519) and rejects with a readable code: `CRC32_MISMATCH`, `INVALID_SIGNATURE`, `UNTRUSTED_ISSUER`, `DECRYPTION_FAILED`, …
- **Redeems once:** an append-only ledger refuses a voucher or prescription presented twice (`REPLAY DETECTED`). When the network returns, proofs sync to a Rust verifier that catches a voucher paid on two offline phones.

## Skeleton Crew architecture
One skeleton, three apps:
- `crates/ghostpacket-core`: Rust compiled to WebAssembly (285 KB gzip). All crypto, compression, DSP, FEC and fountain codes live here, and nowhere else.
- `packages/ghostpacket-sdk`: a TypeScript SDK (MIT) that wraps the core, Web Audio, the camera, the ledger, the keyring and the outbox. It works from a plain `<script type="module">`.
- `packages/ghostpacket-ui`: a shared React kit (sender, receiver, virtual hand-over, high-speed lab, result card, ledger).
- Built only from it: **GhostClinic** (ward, prescriptions with no patient name in the frame, clinical photos, dispense once), **GhostTontine** (members, receipts, one signed round ledger broadcast to every member phone, single-use aid vouchers) and the **portal** (simulation, tamper lab, PC ↔ phone test).
- `crates/ghostpacket-verifier` reuses the same core on the server, so the cloud runs exactly the browser's verification.

## How we built it with Kiro
- **Specs first:** 9 EARS specs (`.kiro/specs/`), from the binary protocol to the high-speed transports. Each design doc records the measured numbers and the decisions that came out of failing tests.
- **Steering:** 5 files. `wasm-determinism` forbids panics, hidden randomness and unbounded allocation in the Rust core; `ui-design-system` carries the "Midnight Atelier" visual rules for every component.
- **Hooks:** 4. Channel fuzzing on every codec save, a no-panic guard, a type check on save, and a full audit when the agent stops.
- **MCP:** `ghostpacket-inspector` loads the same `.wasm` as the browser to decode frames (with a passphrase for E2EE frames), benchmark every channel, and check compliance.
- **Custom agent:** `dsp-security-auditor`, a read-only reviewer that audited every phase before release.
- **Real bugs caught before release:**
  - the fuzz hook found weak low bits in `xorshift64*`, which left a fountain block uncovered on some sessions;
  - a spec test found the FSK modem failing at ±100 ppm of clock drift with room echo, which led to an early-late timing tracker (now ±300 ppm);
  - the OFDM fuzz suite found a clock tracker that drifted out of the cyclic prefix at ±300 ppm;
  - the auditor found decrypted titles written to the ledger, a stripe image that stalled the ChromaCrypt reader, and LAN pairing codes that accepted public IP addresses.

## Challenges we ran into
- **Clocks never agree.** Two devices drift by up to 300 ppm, which shifts a 4-FSK window by milliseconds over a 20 s burst. We needed symbol timing tracking for FSK and slip-rate tracking for OFDM.
- **Cameras miss frames.** Fountain codes let the receiver rebuild a frame from any large enough subset; tuning the degree distribution took the overhead from 1.6 × K to about 1.1 × K.
- **Colors lie.** ChromaCrypt calibrates its 8 colors from a strip inside every matrix, because white balance and screen tint change from phone to phone.
- **A valid signature is not enough.** Anyone can sign a voucher with a fresh key, so redemption also requires a pinned issuer, the right document type, no demo flag and a single use.
- **Zero panic in WASM.** A panic kills the instance, so every bound is checked before allocation and the crate has no `unwrap`; a hook enforces it.

## Accomplishments we're proud of
- The whole system runs in one click in a browser tab, offline after the first visit.
- 104 Rust tests (including channel fuzzing), 16 SDK tests in Node and 11 in Chrome, and 66 end-to-end browser checks (36 for the apps, 30 for the portal), all green.
- Two real apps, not a demo screen, built only from the shared skeleton.

## What we learned
Writing the spec and its acceptance criteria before the DSP code made the failures concrete: each bug above first showed up as a failing test that the spec asked for.

## What's next: outliving the hackathon
- Field measurements with real phones in a clinic and a tontine meeting (speaker, microphone and camera vary a lot above 18 kHz and in sunlight).
- IndexedDB storage and X25519 key agreement instead of a shared passphrase.
- Packaging `ghostpacket-sdk` on npm, and a self-hosting guide for the verifier, so NGOs can drop signed offline documents into their own apps.

## Built with
`kiro` · `rust` · `webassembly` · `wasm-bindgen` · `typescript` · `react` · `nextjs` · `tailwindcss` · `web-audio-api` · `webrtc` · `canvas` · `threejs` · `gsap` · `ed25519` · `chacha20-poly1305` · `reed-solomon` · `fountain-codes` · `ofdm` · `github-pages`

## Links
- Live demo: https://arthurnsongan.github.io/GhostPacket/ (GhostClinic `/clinic/`, GhostTontine `/tontine/`)
- Repository: https://github.com/ArthurNsongan/GhostPacket
- Kiro artifacts: https://github.com/ArthurNsongan/GhostPacket/tree/main/.kiro
- Demo video: _add the YouTube / Vimeo link once uploaded_
