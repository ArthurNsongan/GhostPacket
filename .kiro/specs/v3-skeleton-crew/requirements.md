# Requirements — GhostPacket V3 "Skeleton Crew"

## Introduction
V3 enters the Kiroween 2026 **Skeleton Crew** category: one lean, reusable air-gap skeleton (`crates/ghostpacket-core`, `packages/ghostpacket-sdk`, `packages/ghostpacket-ui`) powering several distinct applications (`apps/portal`, `apps/ghost-clinic`, `apps/ghost-tontine`). It also brings the "Gothic Lantern & Ectoplasm" redesign with a Haunted / Clean Field mode switch. Sources: `UPGRADE_PLAN_V3.md`, `HALLOWEEN_REDESIGN_PLAN.md`.

High-speed transports (GPKT v2, ChromaCrypt, acoustic OFDM, ultrasonic, WebRTC LAN) are specified separately in `.kiro/specs/high-speed-transports/` once their phase starts.

## Requirements

### Requirement 1 — Monorepo skeleton
**User story:** As a judge, I want to see one skeleton reused by several apps, so that the Skeleton Crew claim is verifiable in the code.

#### Acceptance criteria
1. THE SYSTEM SHALL be an npm workspace with `packages/ghostpacket-sdk`, `packages/ghostpacket-ui` and one folder per app under `apps/`, sharing one lockfile.
2. THE SYSTEM SHALL keep all cryptography, compression, DSP, FEC and fountain logic in `crates/ghostpacket-core`, reached only through `packages/ghostpacket-sdk/src/wasm-bridge.ts`.
3. Every app SHALL depend on `ghostpacket-sdk` and `ghostpacket-ui`, SHALL import them by package name only, and SHALL NOT import the WASM glue or another workspace by relative path; `scripts/kiroween-audit.mjs` SHALL fail otherwise.
4. WHEN `npm run wasm` rebuilds the core, THE SYSTEM SHALL refresh the WASM and capture worklet in every app's `public/`.
5. THE SYSTEM SHALL keep the portal behaviour of V2 unchanged (30/30 site checks) after the restructure.
6. THE SYSTEM SHALL keep producing the standalone `ghostpacket-sdk` package build (`npm run build:sdk`) and its Node and browser tests.

### Requirement 2 — Two distinct applications
**User story:** As a judge, I want two genuinely different products built from the same skeleton, so that reuse is shown, not claimed.

#### Acceptance criteria
1. THE SYSTEM SHALL provide `apps/ghost-clinic` (rural clinic: patient records, prescriptions, pharmacy hand-over) and `apps/ghost-tontine` (savings group: members, contribution rounds, receipts, one-time vouchers).
2. Each app SHALL keep its own local records offline (patients or members) and SHALL issue signed GPKT documents of its own types.
3. Each app SHALL send documents over sound and light and SHALL receive and verify them with the shared components.
4. Each app SHALL refuse a document presented twice (local anti-replay) and SHALL queue verified proofs for opt-in sync to a `ghostpacket-verifier`.
5. THE SYSTEM SHALL deploy the apps under `/clinic/` and `/tontine/` next to the portal on the same GitHub Pages site, each with its own offline service worker scope.

### Requirement 3 — Haunted / Clean Field redesign
**User story:** As a judge I want a memorable Halloween identity; as a field user I want a calm, readable interface.

#### Acceptance criteria
1. THE SYSTEM SHALL offer a header switch between `Haunted Mode` (default) and `Clean Field Mode`, remembered locally, applied through `data-theme` on `<html>`.
2. WHILE in Clean Field Mode, THE SYSTEM SHALL hide decorative layers (bats, moon, cobwebs, ambience) and keep every functional colour and state.
3. THE SYSTEM SHALL give each app its own accent and emblem through `data-app` (portal: Jack-o'-Lantern, clinic: plague-doctor mask, tontine: wax seal and key).
4. THE SYSTEM SHALL drive the lantern from the live audio level and switch it to ectoplasm on `ED25519 VERIFIED` and to crimson on rejection.
5. THE SYSTEM SHALL synthesize all spooky sounds with Web Audio (no audio file), off by default, and SHALL mute them while a microphone listens or a modem burst plays.
6. THE SYSTEM SHALL honour `prefers-reduced-motion`, keep WCAG AA text contrast, and make no network call for fonts or sounds.
