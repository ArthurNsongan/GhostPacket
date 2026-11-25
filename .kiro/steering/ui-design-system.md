---
inclusion: fileMatch
fileMatchPattern: ["apps/*/src/**/*.ts", "apps/*/src/**/*.tsx", "apps/*/src/**/*.css", "packages/ghostpacket-ui/src/**/*.tsx"]
---

# "Spectral Telemetry" visual system

Full reference: #[[file:UI_DESIGN_GUIDELINES.md]]
V3 redesign ("Gothic Lantern & Ectoplasm"): #[[file:HALLOWEEN_REDESIGN_PLAN.md]]

## V3: Haunted / Clean Field modes
- `<html data-theme="haunted" | "clean" data-app="portal" | "clinic" | "tontine">`, set before first paint by `themeBootScript(app)` (`ghostpacket-sdk/theme`).
- Palettes and per-app accents live in `packages/ghostpacket-ui/styles/haunted.css`, which overrides the `@theme` variables below. Components keep the functional class names; app accents use `text-accent`, `ring-accent`, `bg-accent-soft`.
- Decorative layers carry `haunt-only` and are hidden in Clean Field Mode: `BatSwarmLayer`, `BloodMoonAtmosphere`, cobwebs, ambience. Under `prefers-reduced-motion` they stop moving.
- Emblems are fine-line SVG (`SpectralEmblem`): a carved lantern for the portal, a plague-doctor mask for the clinic, a wax seal and skeleton key for the tontine. They are never emoji or clipart. Their light follows the audio level, turns ectoplasm on verify and crimson on rejection.
- Cinzel Decorative (`display-gothic`) is for wordmarks and short titles only. Sentences stay in Instrument Serif.
- Decoration reacts to protocol events through `spectral()` (`transmit`, `verified`, `rejected`, `replay`, `drop`, `synced`), never to document content.
- Sound cues come from `ui-sfx` only. They are off by default, never play right before a real burst, and are silenced by the modem counter.
- New app screens reuse `AppFrame`, `FormKit` (`TabBar`, `TextField`, `NumberField`, `Stat`, `Panel`, `Hero`) and `AirTransfer`.

## Tokens (defined in each app's `src/app/globals.css`, `@theme` block)
| Tailwind class | Hex | Meaning |
|---|---|---|
| `void` | `#07080B` | background (`--bg-abyss`) |
| `panel` / `panel-2` | `#0D0F14` / `#141720` | panels, raised cards |
| `ink` | `#F3EFE6` | primary text (bone ivory) |
| `mist` / `mute` | `#9BA3B4` / `#5C6475` | secondary text / technical labels |
| `phosphor` | `#5EF2C6` | ectoplasm: signal, SYNC LOCK, resolved blocks, `ED25519 VERIFIED` |
| `amber` | `#F59E0B` | candlelight amber: 1-click demo CTA, soft warnings |
| `ion` | `#A78BFA` | amethyst: optical QR channel |
| `alarm` | `#F43F5E` | crimson: loss, `CRC32_MISMATCH`, `INVALID_SIGNATURE`, "Curse 1 bit" |

Class names (`phosphor`, `ion`, `amber`, `alarm`) are functional: a colour change happens in `@theme`, not in components.

## V2 components
| Component | Role |
|---|---|
| `AppShell` | glass header, 4-page nav, `AIR-GAP READY` / `OFFLINE · AIR-GAP ACTIVE` badge, UI SFX toggle, Kiro Telemetry drawer, audio-reactive sigil (`effects.onLevel`), border spotlight (`--mx`/`--my` on `.panel::before`) |
| `EtherConduit` | 60 FPS canvas bridge: real waveform + droplet orbs, lost ones shatter into crimson embers |
| Blood Moon | `effects.bloodMoon()` adds `.blood-moon` to `<html>` for 1.4 s on any rejection (`ResultCard`) |
| `TamperLab`, `FrameInspector` (`onCurseByte`) | attack buttons and click-any-byte, layer chips ✓ ✗ · |
| `FountainGridCanvas` | domino cascade (35 ms stagger), `CASCADE ×N` and `GAUSS GF(2)` badges |
| `CryptLedger`, `IdentityCard`, `MessageComposer`, `GpktVerifier`, `KiroTelemetry` | V2 features |

UI sounds (`ui-sfx.ts`) are off by default and muted while the microphone listens, so they can never jam the modem.

## Rules
- Every glow carries technical information; no decorative neon.
- Fonts are self-hosted with `@fontsource` (no network call, product rule 3): `Instrument Serif` (titles), `Plus Jakarta Sans` (UI), `JetBrains Mono` + `tabular-nums` (telemetry).
- Animations in CSS (`transform`/`opacity` only); DSP rendering in Canvas 2D through `requestAnimationFrame`, never through React state per sample.
- `prefers-reduced-motion: reduce` turns off drift, shake, stamp and pulses.
- UI language is English. Thematic micro-copy stays restrained ("Summon the full demo", "Curse 1 bit", "Cryptographic seal intact", "Corrupted spirit rejected"), with no Halloween clichés.
