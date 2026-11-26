---
inclusion: fileMatch
fileMatchPattern: ["apps/*/src/**/*.ts", "apps/*/src/**/*.tsx", "apps/*/src/**/*.css", "packages/ghostpacket-ui/src/**/*.tsx", "packages/ghostpacket-ui/styles/*.css"]
---

# "Midnight Atelier" visual system (V6, haunted graveyard)

Full reference: #[[file:UI_DESIGN_GUIDELINES.md]]
Halloween layer: #[[file:HALLOWEEN_REDESIGN_PLAN.md]]

Art direction: an October campaign for a luxury house, set in a haunted graveyard. Surfaces stay editorial; Haunted Mode (the default) puts a 3D misty graveyard behind every page and adds lurking spectres, bats and ghostly click sounds — eerie but playful, never a real jump scare, never blocking content. No cobwebs, no gothic blackletter, no neon.

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

## Decoration (Haunted Mode only, `haunt-only`; Haunted is the default)
- Backdrop: `HauntedBackdrop3D` (three.js loaded on demand) draws a misty graveyard under a huge moon behind every page (tombstones, dead trees, jack-o'-lanterns, translucent spectres, wisps, bats); pointer parallax, camera walks in on scroll; paused in hidden tabs; one still frame under reduced motion. It sets `.backdrop-3d` on `<html>`: the CSS moon hides and `.panel` becomes smoked glass.
- Spectres: `GhostCrew` (GSAP). Tall, tattered, see-through, glowing green pupils (red when angry). They flicker, dissolve when the pointer comes close — always when they cover a control, so they never block a click — and sometimes stare; clicked, they lunge ("Boo.") and vanish.
- On click: a tiny bat flock from the pointer, a GSAP jelly squish and a sound (`HauntedFun` → `funSfx`: moan, giggle, whisper, bat, pop, whoosh, chime).
- On events, through `spectral()`: `transmit` → bat swarm, spectres stir and follow; `verified` → spectres retreat, wisps turn mist green; `drop` → a bat turns into sparks; `rejected` / `replay` → blood moon (CSS + 3D), red fog, red eyes, ghosts close in.
- Kiro violet `--color-spectre` is for ghost glow only, never a status.
- Clean Field Mode hides every decorative layer; `prefers-reduced-motion` stops drift, reveals, stamps, pulses, ghosts and bats.

## Rules
- New screens reuse `AppFrame`, `FormKit` (`TabBar`, `TextField`, `NumberField`, `Stat`, `Panel`, `Hero`) and `AirTransfer`.
- Layout: generous spacing, editorial hero (open, not boxed), bento grids for figures, `.rise` for scroll-driven entrances.
- Animations in CSS (`transform` / `opacity`); DSP rendering in Canvas 2D through `requestAnimationFrame`, never React state per sample.
- UI sounds come from `ui-sfx` only (`sfx()` for protocol cues, `funSfx()` for clicks), are on by default in Haunted Mode, and are silenced while the modem or the microphone runs.
- UI language is English. Micro-copy stays restrained ("Summon the full demo", "Curse 1 bit", "Cryptographic seal intact", "Corrupted spirit rejected").
