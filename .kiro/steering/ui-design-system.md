---
inclusion: fileMatch
fileMatchPattern: ["web/src/**/*.ts", "web/src/**/*.tsx", "web/src/**/*.css"]
---

# "Spectral Telemetry" visual system

Full reference: #[[file:UI_DESIGN_GUIDELINES.md]]

## Tokens (defined in `web/src/app/globals.css`, `@theme` block)
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

## Rules
- Every glow carries technical information; no decorative neon.
- Fonts are self-hosted with `@fontsource` (no network call, product rule 3): `Instrument Serif` (titles), `Plus Jakarta Sans` (UI), `JetBrains Mono` + `tabular-nums` (telemetry).
- Animations in CSS (`transform`/`opacity` only); DSP rendering in Canvas 2D through `requestAnimationFrame`, never through React state per sample.
- `prefers-reduced-motion: reduce` turns off drift, shake, stamp and pulses.
- UI language is English. Thematic micro-copy stays restrained ("Summon the full demo", "Curse 1 bit", "Cryptographic seal intact", "Corrupted spirit rejected"), with no Halloween clichés.
