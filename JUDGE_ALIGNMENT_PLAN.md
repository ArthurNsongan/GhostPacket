# GhostPacket — Judge Realignment Plan (Kiroween 2026 Final Polish)

> **Status (Nov 24, 2026): done.** Telemetry ops use the real timing names (`encode_v2`, `chroma_scan`, `chroma_ingest_bundle`, `ofdm_modulate`, `ofdm_demodulate`); next-tap hints name the tamper lab explicitly, because the apps have no "Restore intact frame" button.

> **Purpose**: Surgical pre-submission alignment of the GhostPacket codebase and documentation against the official Kiroween 2026 judge expectations (**Vivek Velso**, **Floor Mesters**, **Sameer Ali**), the **30-Second Test**, **"Make Kiro Impossible to Miss"**, and **zero-regression E2E safety** (`portal.mjs` 30/30 + `apps.mjs` 36/36 + `kiroween-audit.mjs --full`).

---

## 1. Gap Analysis Against Official Judge Expectations

| Judge / Criteria | Current State | Targeted Realignment |
|---|---|---|
| **Floor Mesters (UX, Kiro)**<br>*"Scare me, then make it easy… a ghost that guides me or an error message that makes me laugh. If I smile and still know what to tap next, you've won me over."* | `GhostCrew` and `HauntedFun` already add playful ghosts and tactile clicks, **but** `ResultCard.tsx` shows the same serious subtitle (`"Corrupted spirit rejected"`) for every error and gives no recovery hint, and no ghost guides first-time visitors toward the 1-click demo. | 1. Code-specific witty Haunted Mode error quips + **explicit "what to tap next" recovery hints** in `ResultCard.tsx` (sober clinical/financial text in Clean Field Mode).<br>2. Subtle non-blocking **Ghost Guide whisper** next to the primary CTA on `HomeView.tsx` that dismisses on click.<br>3. Prominent 1-click session-key entry alongside the persistent vault in `GhostClinic` & `GhostTontine`. |
| **The 30-Second Test**<br>*Could a stranger understand what it does, who it is for, and why it matters in 30 seconds?* | `HomeView.tsx` hero paragraph (lines 70–77) still describes V1 only (`512 bytes`, `4-FSK`, `QR`), omitting V3 breakthroughs (**12 KB clinical photos in 2.8 s over ChromaCrypt**, **4.2 kbps OFDM**, **E2EE**, **offline-to-cloud verifier**). | Rewrite the 2-sentence hero summary and update the Bento stats in `HomeView.tsx` so a stranger grasps **What, Who, and Full V3 Scope** in under 15 seconds while keeping `"Launch the 20 s simulation"` intact for E2E. |
| **Vivek Velso (AWS Hero)** & **"Make Kiro Impossible to Miss"**<br>*"I wouldn't have imagined building this before Kiro."* | Kiro Telemetry exists in a header drawer, but the Home page itself does not prominently showcase Kiro's role, specs, hooks, MCP tools, or the real bugs caught by Kiro. | Add an unmissable **"Built with Kiro"** section on `HomeView.tsx` (with a 1-click button opening the live `KiroTelemetry` drawer) detailing the **9 EARS specs**, **5 steering guardrails**, **4 hooks**, **MCP inspector**, **`dsp-security-auditor` custom agent**, and the real DSP/crypto bugs they caught; add V3 OFDM/ChromaCrypt ops to `KiroTelemetry.tsx`. |
| **Sameer Ali (coding.kitty)**<br>*Open-source tools & apps that outlive the hackathon and help a specific community.* | `ghostpacket-sdk` (MIT, bundler-free), `ghostpacket-verifier`, and **Clean Field Mode** already exist, but their post-hackathon reusability for rural clinics and savings groups is understated on Home and in `README.md`. | Highlight **MIT open-source `ghostpacket-sdk`** + **1-click Clean Field Mode** directly in the SDK/Community section of `HomeView.tsx` and `README.md`. |
| **Documentation Accuracy (`README.md`)** | Five stale V1/V2 remnants remain in `README.md`:<br>- Line 88 claims Ultrasonic & WebRTC LAN are *"Not in this iteration"* even though both are built and E2E-tested.<br>- Repo tree (lines 143–153) omits `apps/ghost-clinic/` and `apps/ghost-tontine/`.<br>- Line 121 says `82` core tests instead of `91` (`104` total Rust tests).<br>- Line 250 says `seven specs` instead of `nine specs`.<br>- Line 233 says `set root directory to web` (legacy folder). | Synchronize `README.md` 100% with the actual V3 monorepo, update the opening lines for the 30-second test, and prepare `DEVPOST_SUBMISSION.md` with ready-to-paste Devpost copy and "Built With" tags. |

---

## 2. Hard Invariants (Must NOT Break Any Test or Rule)

1. **Preserve all E2E text probes** checked by `scripts/e2e/portal.mjs` and `scripts/e2e/apps.mjs`:
   - Keep exact button/link texts: `"Launch the 20 s simulation"`, `"Summon the full demo"`, `"This device sends"`, `"Write a message"`, `"Send over QR"`, `"Curse payload"`, `"Curse signature"`, `"Forge rogue key"`, `"Wrong passphrase"`, `"Restore intact frame"`, `"Start race"`, `"Jam audio"`, `"Create and seal the key"`, `"Unlock"`.
   - Keep exact machine error codes and alert strings: `CRC32_MISMATCH`, `INVALID_SIGNATURE`, `UNTRUSTED_ISSUER`, `DECRYPTION_FAILED`, `INVALID_PREAMBLE`, `ED25519 VERIFIED`, `REPLAY DETECTED · ALREADY REDEEMED`.
2. **Skeleton Crew Architecture Rule**:
   - No crypto or DSP logic in `apps/*`; apps import only `ghostpacket-sdk/*` and `ghostpacket-ui/*`.
3. **Zero External Requests & Zero Secrets**:
   - Self-hosted fonts/assets only; `0` runtime network calls; `.kiro/` remains 100% tracked by Git.

---

## 3. Step-by-Step Implementation Tasks

### Phase 1 — Mischievous UX & Clear Next Steps (`packages/ghostpacket-ui`)
- [x] **1.1 Witty Haunted Error Messages + Next-Tap Hints (`packages/ghostpacket-ui/src/ResultCard.tsx`)**:
  - Add a pure helper `errorFlavor(code: string, haunted: boolean): { headline: string; nextTap: string }` reactive to `currentTheme()`:
    - `CRC32_MISMATCH`:
      - Haunted: `"Nice try, poltergeist — that bit didn't belong here."`
      - Clean: `"Frame corrupted in transit (checksum mismatch)."`
      - Next tap: `"Next: tap 'Restore intact frame' or re-transmit the packet."`
    - `INVALID_SIGNATURE`:
      - Haunted: `"Impostor ghost! That cryptographic wax seal is a fake."`
      - Clean: `"Signature verification failed."`
      - Next tap: `"Next: tap 'Restore intact frame' or request a frame signed by the real issuer."`
    - `UNTRUSTED_ISSUER`:
      - Haunted: `"Stranger danger in the graveyard — unknown signer."`
      - Clean: `"Signer is not in your trusted keyring."`
      - Next tap: `"Next: pin this issuer via Identity QR, or switch off Strict Keyring."`
    - `DECRYPTION_FAILED` / `PASSPHRASE_REQUIRED`:
      - Haunted: `"Wrong spell! Even the spirits won't whisper without the right passphrase."`
      - Clean: `"Cannot decrypt payload with the provided passphrase."`
      - Next tap: `"Next: enter the sender's passphrase and verify again."`
    - `INVALID_PREAMBLE` / `UNSUPPORTED_VERSION` / default:
      - Haunted: `"Pure ectoplasm static — the GPKT header is broken."`
      - Clean: `"Malformed frame header."`
      - Next tap: `"Next: tap 'Restore intact frame' or re-scan cleanly."`
  - For `replay?.status === "replay"` (keeping `REPLAY DETECTED · ALREADY REDEEMED` verbatim):
    - In Haunted Mode, show a playful sub-headline: `"Deja-boo! This document already walked out of the crypt once."` alongside the exact redemption timestamp and `"Next: issue a fresh document ID — duplicates are never paid twice."`
- [x] **1.2 Non-Blocking Ghost Guide Whisper (`packages/ghostpacket-ui/src/GhostGuide.tsx` or `HomeView.tsx`)**:
  - Add a compact, accessible Haunted Mode callout with the mini `Ghostling` SVG pointing to `"Launch the 20 s simulation"`:
    *"Psst… tap above to watch sound & light deliver a signed receipt in 15 s (no mic or camera needed)."*
  - Automatically hides in `Clean Field Mode` and under `prefers-reduced-motion`, never intercepts pointer events over buttons, and dismisses once clicked.

### Phase 2 — 30-Second Test & "Make Kiro Impossible to Miss" (`apps/portal`)
- [x] **2.1 Upgrade Hero & Bento Stats (`apps/portal/src/components/HomeView.tsx`)**:
  - Update hero lead paragraph to clearly state **What it does, Who it helps (rural clinics, tontines, aid teams), and V3 capabilities** (512-byte receipts up to **12 KB clinical photos** over **4-FSK / 4.2 kbps OFDM sound** and **Fountain QR / 8-color ChromaCrypt light**, optional **ChaCha20-Poly1305 E2EE**, offline-to-cloud anti-replay sync).
  - Update `STATS` to spotlight **`≈ 2.8 s`** (*"12 KB clinical photo over ChromaCrypt at 30 % frame loss"*), `≈ 1 ms` Ed25519 sign, `±300 ppm` acoustic drift/echo survival, and `${BUILD_INFO.wasmGzipKb} KB` WASM core.
- [x] **2.2 Add "Built with Kiro" Showcase Section (`apps/portal/src/components/HomeView.tsx` + `AppShell.tsx`)**:
  - Add a dedicated editorial card on `HomeView.tsx`: **"Built end-to-end with Kiro"** showing:
    - Why a solo hackathon build could ship a Rust/WASM codec, 8-color optical matrix, 32-subcarrier OFDM modem, native Rust sync server, SDK, and 2 offline apps.
    - Concrete Kiro artifacts: **9 EARS specs**, **5 steering files** (`0` panics guardrail), **4 v1 hooks**, **`ghostpacket-inspector` MCP server**, and **`dsp-security-auditor` custom agent** (listing the real PRNG bias, `±100 ppm` clock drift, and verifier bugs caught).
    - Direct button to open the live **`Kiro Telemetry`** drawer right from the Home page.
  - Emphasize **Sameer Ali's "Outlives the Hackathon"** angle in the SDK card: MIT open-source `ghostpacket-sdk`, zero-bundler browser support, and 1-click **Clean Field Mode** for real rural deployments.
- [x] **2.3 Update `KiroTelemetry.tsx` Live Ops**:
  - Include `chroma_encode`, `chroma_decode`, `ofdm_modulate`, and `ofdm_demodulate` in the live latency table so V3 high-speed transports appear when exercised.

### Phase 3 — Documentation Sync & Devpost Package (`README.md` + `DEVPOST_SUBMISSION.md`)
- [x] **3.1 Synchronize `README.md`**:
  - Rewrite the opening 10 lines to pass the **30-second stranger test** effortlessly (What, Who, Why, Live Links, Built with Kiro summary).
  - Document Ultrasonic Whisper pairing and WebRTC QR-signaled LAN link accurately (remove obsolete line 88 disclaimer).
  - Add `apps/ghost-clinic/` and `apps/ghost-tontine/` to the Repository Layout block.
  - Update test counts (`91` core + `13` verifier = `104` Rust tests; `9` EARS specs) and replace legacy `web/` deploy note with `npm run build:pages -- --base /GhostPacket`.
- [x] **3.2 Create `DEVPOST_SUBMISSION.md`**:
  - Ready-to-paste Devpost fields: *Tagline*, *30-Second Elevator Pitch*, *Inspiration*, *What It Does*, *Skeleton Crew Architecture*, *How We Built It With Kiro* (naming Specs, Steering, Hooks, Custom Agent, MCP), *Challenges We Ran Into*, *What's Next (Outliving the Hackathon)*, and *Built With* tags (`kiro`, `rust`, `webassembly`, `typescript`, `nextjs`, `threejs`, `gsap`, `web-audio-api`, `tailwindcss`).

### Phase 4 — Full Verification & Re-Deploy Before Recording Video
- [x] Run `npm run typecheck` across all workspaces.
- [x] Run `node scripts/kiroween-audit.mjs --full` (verify 100% PASS, 0 secrets, 0 panics, `.kiro/` tracked).
- [x] Build merged GitHub Pages output: `npm run build:pages -- --base /GhostPacket`.
- [x] Run headless Chrome suites:
  - `node scripts/e2e/portal.mjs` (verify 30/30 PASS, 0 console errors, 0 external calls, 0 404).
  - `node scripts/e2e/apps.mjs` (verify 36/36 PASS).
- [x] Deploy updated site (`node scripts/deploy-gh-pages.mjs`) so the live URL matches every frame of the 3-minute demo video.
