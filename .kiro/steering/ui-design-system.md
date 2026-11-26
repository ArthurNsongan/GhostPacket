---
inclusion: fileMatch
fileMatchPattern: ["apps/*/src/**/*.ts", "apps/*/src/**/*.tsx", "apps/*/src/**/*.css", "packages/ghostpacket-ui/src/**/*.tsx", "packages/ghostpacket-ui/styles/*.css"]
---

# "Midnight Atelier" visual system (V5, playful haunt)

Full reference: #[[file:UI_DESIGN_GUIDELINES.md]]
Halloween layer: #[[file:HALLOWEEN_REDESIGN_PLAN.md]]

Art direction: an October campaign for a luxury house, with a playful haunt on top. Surfaces stay editorial; Haunted Mode adds friendly Kiro-style ghosts, bats, a 3D ghost and pumpkin and fun click sounds — cartoon-spooky, never frightening, never blocking content. No cobwebs, no gothic blackletter, no neon.

## Where styles live
- `packages/ghostpacket-ui/styles/ghostpacket.css`: Tailwind `@theme` tokens, self-hosted fonts, panels, buttons, atmosphere, animations. Each app's `src/app/globals.css` only imports Tailwind, declares its `@source` paths and imports this file.
- `packages/ghostpacket-ui/styles/haunted.css`: palettes per `data-theme` (`haunted` | `clean`) and per `data-app` (`portal` | `clinic` | `tontine`), moon, emblem light.
- `packages/ghostpacket-ui/src/palette.ts`: the same tokens resolved to RGB for Canvas 2D (`PAL`, `rgba`, `mix`, `watchPalette()`). Canvas code never hard-codes a colour.
- `<html data-theme data-app>` is set before first paint by `themeBootScript(app)` (`ghostpacket-sdk/theme`).

## Typography (self-hosted `@fontsource-variable`, no network call)
- **Fraunces** (`font-serif`, `.display`, `.display-gothic`): titles and wordmarks. Weight ~340, `SOFT 50`. The accent word in `<em>` uses the italic with `SOFT 100, WONK 1`: that is the only "witchy" touch.
- **Geist** (`font-sans`): all interface text, labels, buttons. `.panel-title` = Geist 550, 10.5 px, uppercase, 0.16em tracking.
- **Geist Mono** (`font-mono`, tabular nums): only real values (Hz, dB, ms, bytes, hex, fingerprints, IDs). Not for sentences or labels.

## Tokens (OKLCH, Haunted)
| Tailwind class | Value | Meaning |
|---|---|---|
| `void` | `oklch(0.14 0.02 300)` | aubergine-black background |
| `panel` / `panel-2` | `oklch(0.17 …)` / `oklch(0.21 …)` | panels, raised surfaces |
| `ink` / `mist` / `mute` | bone ivory / lilac grey / dim grey | text levels |
| `accent` | candlelight amber (portal), copper (clinic), gold (tontine) | the single brand accent: CTA, italics, active tab, app links |
| `phosphor` | mist green `oklch(0.85 0.12 170)` | signal only: acoustic channel, SYNC LOCK, resolved blocks, `ED25519 VERIFIED` |
| `ion` | moon silver `oklch(0.8 0.03 290)` | optical QR channel, key fingerprints |
| `amber` | candle amber | soft warnings |
| `alarm` | garnet `oklch(0.62 0.2 15)` | loss, `CRC32_MISMATCH`, `INVALID_SIGNATURE`, replay, "Curse 1 bit" |

Class names are functional: a colour change happens in the CSS files, never in components. Green never decorates: it means "verified / signal".

## Selection and states: never an outline
- Active nav, tab or option = tonal background + `font-medium` (`navPillClass`, `TabBar`). No `ring-*`, no accent `border-*`, no focus ring.
- Buttons: `.cta-ember` (one primary per view), `.btn-tonal` (secondary), `.btn-accent` (row actions such as "Prescribe"), or `bg-{tone}/10 hover:bg-{tone}/20` for channel actions.
- Inputs: `bg-ink/[0.045]`, focus = `bg-ink/[0.08]`. Alerts and status boxes: tinted background only.
- Keyboard focus (`:focus-visible`) = underline + slight brightening, defined globally.
- `.panel` hover: a warm candle glow inside the panel (`--mx`/`--my` set by `AppFrame`), not a lit border.

## Decoration (Haunted Mode only, `haunt-only`)
- At rest: a pale moon, a candle glow from below, film grain, 4 resident bats and 3 Ghostlings (`GhostCrew`, GSAP, shy: they slip away from the pointer).
- On click: a tiny bat flock from the pointer, a GSAP jelly squish and a fun sound (`HauntedFun` → `funSfx`: boo, giggle, bat, pop, whoosh, chime).
- On events, through `spectral()`: `transmit` sends a bat swarm and makes the ghosts race, `verified` makes them hop, `drop` turns a bat into sparks, `rejected` / `replay` scatters the bats, scares the ghosts and turns the moon garnet (`.blood-moon`, 1.6 s, no lightning).
- Portal hero: `SpookyScene3D` (three.js loaded on demand, paused off screen).
- Kiro violet `--color-spectre` is for ghost glow only, never a status.
- Emblems (`SpectralEmblem`) are fine-line monochrome drawings (lantern, plague-doctor mask, wax seal) whose only light follows the audio level and the verdict.
- Clean Field Mode hides every decorative layer; `prefers-reduced-motion` stops drift, reveals, stamps, pulses and bats.

## Rules
- New screens reuse `AppFrame`, `FormKit` (`TabBar`, `TextField`, `NumberField`, `Stat`, `Panel`, `Hero`) and `AirTransfer`.
- Layout: generous spacing, editorial hero (open, not boxed), bento grids for figures, `.rise` for scroll-driven entrances.
- Animations in CSS (`transform` / `opacity`); DSP rendering in Canvas 2D through `requestAnimationFrame`, never React state per sample.
- UI sounds come from `ui-sfx` only (`sfx()` for protocol cues, `funSfx()` for clicks), are on by default in Haunted Mode, and are silenced while the modem or the microphone runs.
- UI language is English. Micro-copy stays restrained ("Summon the full demo", "Curse 1 bit", "Cryptographic seal intact", "Corrupted spirit rejected").
