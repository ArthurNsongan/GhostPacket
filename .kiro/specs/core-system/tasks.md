# Implementation plan — Core system

- [x] 1. Repository hygiene
  - [x] 1.1 `.gitignore` keeping `.kiro/` visible and excluding external tools
  - [x] 1.2 `git init -b main`, MIT licence
  - _Requirements: 6.1_

- [x] 2. Kiro foundation
  - [x] 2.1 Steering `product`, `tech`, `structure`, `wasm-determinism`, `ui-design-system`
  - [x] 2.2 Specs `core-system`, `binary-protocol`, `acoustic-fsk`, `optical-fountain`, `judge-demo-ui`
  - [x] 2.3 Hooks `fuzz-noise-channel`, `wasm-no-panic-guard`, `ts-typecheck-on-save`, `kiroween-audit`
  - [x] 2.4 `.kiro/settings/mcp.json` (copied by the user from `mcp-server/kiro-mcp.json`, since agents cannot write `.kiro/settings/`)
  - _Requirements: 6.3_

- [x] 3. Rust core
  - [x] 3.1 `error.rs` stable codes, English messages
  - [x] 3.2 Protocol, schema, crypto (see spec `binary-protocol`)
  - [x] 3.3 FEC + FSK (see spec `acoustic-fsk`)
  - [x] 3.4 LT fountain (see spec `optical-fountain`)
  - [x] 3.5 Deterministic channel simulator
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3_

- [x] 4. WASM bridge and fallback
  - [x] 4.1 `wasm-bridge.ts`: local loading, timing, typed errors
  - [x] 4.2 Automatic microphone/camera → loopback fallback
  - _Requirements: 4.1, 4.2, 4.3, 4.4_

- [x] 5. User interface (see spec `judge-demo-ui`)
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.2, 5.3_

- [ ] 6. Verification and submission
  - [x] 6.1 Rust suite + type check + static build
  - [x] 6.2 1-click demo timed under 30 s (≈ 15 s, headless Chrome)
  - [x] 6.3a Field receiver in Chrome with fake microphone (drift + echo + noise) and fake camera (blurred QR codes)
  - [ ] 6.3 Physical PC ↔ phone test
  - [x] 6.4 Deployment: https://arthurnsongan.github.io/GhostPacket/ (gh-pages branch), checked in headless Chrome
  - [ ] 6.5 3-minute video, Devpost submission
  - _Requirements: 1.2, 5.1, 5.2_
