# GhostPacket — UI/UX Design Guidelines ("Midnight Atelier", V4)

> **Art direction**: an October campaign for a luxury house meets a precision lab instrument. Editorial typography, a single warm accent, deep aubergine night, a pale moon and candlelight.
>
> **Golden rule**: **classy first, spooky second.** Halloween comes through **light, typography, micro-copy and event-driven motion** — never through clichés (no cobwebs, no gothic blackletter, no clipart pumpkins, no neon).

Source of truth in code: `packages/ghostpacket-ui/styles/ghostpacket.css` (tokens, fonts, shared classes) and `packages/ghostpacket-ui/styles/haunted.css` (themes and per-app accents). Canvas drawings read the same tokens through `packages/ghostpacket-ui/src/palette.ts`.

---

## 1. Colour — *Aubergine night, candlelight, mist and garnet*

OKLCH tokens, 3 surface levels, WCAG AA text contrast.

| Tailwind token | Haunted value | Role |
|---|---|---|
| `void` | `oklch(0.14 0.02 300)` | Page background (aubergine black, never `#000`) |
| `panel` | `oklch(0.17 0.02 300)` | Panels |
| `panel-2` | `oklch(0.21 0.022 300)` | Raised surfaces, selects |
| `ink` | `oklch(0.94 0.015 80)` | Primary text (bone ivory) |
| `mist` | `oklch(0.74 0.02 300)` | Secondary text |
| `mute` | `oklch(0.58 0.02 300)` | Labels, metadata |
| `accent` | portal `oklch(0.78 0.14 65)` · clinic `oklch(0.76 0.11 45)` · tontine `oklch(0.83 0.12 85)` | **The single brand accent**: primary CTA, italic accent words, active tab, app links |
| `phosphor` | `oklch(0.85 0.12 170)` | **Signal only**: acoustic channel, `SYNC LOCK`, resolved blocks, `ED25519 VERIFIED` |
| `ion` | `oklch(0.8 0.03 290)` | Moon silver: optical QR channel, key fingerprints |
| `alarm` | `oklch(0.62 0.2 15)` | Garnet: lost frames, `CRC32_MISMATCH`, `INVALID_SIGNATURE`, replay, *Curse 1 bit* |

### Proportion rule (80 / 15 / 5)
- **80 %** aubergine surfaces with 3.5 % film grain.
- **15 %** ivory and grey typography.
- **5 %** colour: one warm accent per screen, plus green/garnet only when they carry a verdict.

Clean Field Mode keeps the same roles on a neutral graphite base with higher contrast and no decoration.

---

## 2. Typography — *Editorial serif × modern grotesk*

Self-hosted variable fonts (`@fontsource-variable`, no network call):

| Role | Font | Use |
|---|---|---|
| Display / wordmarks | **Fraunces** (opsz, SOFT, WONK axes) | `.display`: weight ~340, `SOFT 50`, `letter-spacing -0.028em`. The accent word in `<em>` uses the italic with `SOFT 100, WONK 1` — the discreet "witchy" touch. `.display-gothic` (wordmarks): opsz 144, SOFT 100, WONK 1. |
| Interface | **Geist** | Buttons, tabs, forms, body copy, `.panel-title` (550, 10.5 px, uppercase, 0.16em). |
| Telemetry | **Geist Mono** (`tabular-nums`, slashed zero) | Only real values: Hz, dB, ms, bytes, hex, fingerprints, IDs. |

Scale: hero `clamp(2.8rem, 6vw, 5.4rem)` at line-height 0.98; section titles `clamp(2rem, 3.4vw, 2.8rem)`; KPI figures Geist Mono 1.4–1.7 rem.

---

## 3. Components & states

- **Selection without outlines**: the active nav item, tab or option gets a tonal background and `font-medium`. No `ring-*`, no accent borders, no focus ring.
- **Buttons**: `.cta-ember` (candle-wax amber pill, a sheen sweeps across on hover; one per view), `.btn-tonal` (secondary), `.btn-accent` (row actions), `bg-{tone}/10` for channel actions.
- **Inputs**: tonal fill `bg-ink/[0.045]`, focus brightens the fill.
- **Keyboard focus**: underline + slight brightening (`:focus-visible`, global).
- **Panels**: tonal gradient, 1 px neutral hairline, inner top highlight; on hover a warm **candle glow inside the panel** follows the pointer.
- **Alerts**: tinted background only (`bg-alarm/10`, `bg-amber/10`, `bg-phosphor-dim`).

---

## 4. Motion (60 FPS, event-driven)

- **At rest**: slow drift of a candle glow from below and a moon veil from above (26 s), film grain, a pale gibbous moon.
- **Transmit**: a small bat swarm crosses the screen (`BatSwarmLayer`; no resident bats).
- **Lost frame**: one bat turns into amber sparks; in the Ether Conduit the orb dissolves into garnet embers.
- **Rejection / replay**: Blood Moon — the moon turns garnet and the mist reddens for 1.6 s; the seal cracks with a short shake and chromatic split.
- **Verified**: the seal stamps in with a spring and a mist-green ripple.
- **Scroll**: `.rise` entrances (fade, 18 px, blur → sharp) via `animation-timeline: view()` where supported.
- **Emblems**: fine-line lantern / plague-doctor mask / wax seal; only their light reacts to the audio level and the verdict.
- `prefers-reduced-motion: reduce` turns off drift, entrances, shakes, stamps, pulses and bats.

---

## 5. Layout

- Editorial hero, open on the background (not boxed), with an example sealed document beside it.
- Bento grids for figures and app entry points.
- Generous spacing: `gap-5` between panels, `p-5`–`p-7` inside.

### Thematic micro-copy (restrained)
- **GhostPacket** — *signed documents over sound and light*
- `Summon the full demo` · `Haunt the channel` · `Curse 1 bit`
- `Cryptographic seal intact` / `Corrupted spirit rejected`

---

## 6. Kiro integration

Loaded through `.kiro/steering/ui-design-system.md` (`fileMatch` on app sources and `packages/ghostpacket-ui`), so every generated component inherits these rules.
