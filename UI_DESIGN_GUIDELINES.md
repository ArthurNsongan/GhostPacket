# GhostPacket — UI/UX Design Guidelines ("Spectral Telemetry")

> **Kiroween 2026 art direction**: **Neo-Gothic Signal Lab** — a precision lab instrument (*Teenage Engineering / Linear*) meets dark editorial elegance (*A24 sci-fi*) and a refined, mysterious, living Halloween atmosphere.
>
> **Golden rule**: **zero cheap clichés** (no clipart pumpkins, no aggressive neon orange, no unreadable gothic fonts). Halloween comes through **spectral light, editorial typography, cryptographic seals, micro-copy and fluid 60 FPS physical animation**.

---

## 1. Colour palette — *Obsidian, Ectoplasm & Candlelight*

Layered dark system with strong contrast (**WCAG AA+**), 3 surface depth levels and functional light accents:

| CSS token | Hex / RGBA | Exact role |
|---|---|---|
| `--bg-abyss` | `#07080B` | Main background (midnight obsidian, never flat `#000000`) |
| `--bg-crypt` | `#0D0F14` | Main panels (Emitter, Channel, Receiver) |
| `--bg-velvet` | `#141720` | Raised cards, input fields, inactive grid blocks |
| `--bg-glass` | `rgba(13, 15, 20, 0.72)` | Floating bars with `backdrop-filter: blur(14px)` |
| `--border-hairline` | `rgba(243, 239, 230, 0.08)` | Ultra-thin 1px borders |
| `--border-highlight` | `rgba(243, 239, 230, 0.14)` | Top specular highlight (`inset 0 1px 0`) |
| `--ink-bone` | `#F3EFE6` | Primary text (**bone ivory** — warmer and richer than `#FFFFFF`) |
| `--ink-mist` | `#9BA3B4` | Secondary text & descriptions |
| `--ink-ash` | `#5C6475` | Technical labels, units, metadata |
| `--accent-ectoplasm` | `#5EF2C6` | **Primary signal**: FFT spectrogram, FSK lock, resolved LT blocks, `ED25519 VERIFIED` badge |
| `--accent-ectoplasm-dim` | `rgba(94, 242, 198, 0.14)` | Soft halo & background of verified badges |
| `--accent-ember` | `#F59E0B` → `#E87A3E` | **Candlelight / molten amber**: main CTA (*1-click demo*), carrier energy, a classy Halloween touch |
| `--accent-amethyst` | `#A78BFA` | **Spectral mist**: optical Fountain QR channel, subtle ambient halos |
| `--accent-crimson` | `#F43F5E` | **Broken seal / alert**: lost frames (30 %), `CRC32_MISMATCH`, `INVALID_SIGNATURE`, *Curse 1 bit* button |

### Proportion rule (70 / 20 / 10)
- **70 %**: obsidian & slate surfaces (`--bg-abyss`, `--bg-crypt`) with a subtle grain texture (2 % opacity).
- **20 %**: ivory & mist typography (`--ink-bone`, `--ink-mist`) + 1px borders.
- **10 %**: functional spectral lights (`--accent-ectoplasm`, `--accent-ember`, `--accent-crimson`) — **every glow carries a real technical meaning** (never gratuitous neon).

---

## 2. Typography — *Editorial Gothic × Instrument Precision*

High-end typographic trio (self-hosted with `@fontsource`, no network call):

| Role | Font | Use & character |
|---|---|---|
| **Display / hero titles** | **`Instrument Serif`** (Regular + *Italic*) | *GhostPacket* logo, major section titles, status quotes (*"Cryptographic seal intact"*). Brings editorial class and neo-gothic subtlety. |
| **UI / interface** | **`Plus Jakarta Sans`** (or **`Space Grotesk`**) | Buttons, tabs, forms, document cards (tontine, prescription). Readable, geometric and contemporary. |
| **Telemetry / protocol** | **`JetBrains Mono`** (`font-variant-numeric: tabular-nums`) | Hex inspector, `1600 Hz` frequencies, `12.0 dB` SNR, `8.4 ms` latency, Ed25519 fingerprints. No width jumps during animations. |

### Scale & rhythm
- Main title: `Instrument Serif`, `clamp(2rem, 3.5vw, 3rem)`, `letter-spacing: -0.02em`, with one keyword in amber/ectoplasm *italics*.
- Instrument micro-labels: `JetBrains Mono`, `11px`, `uppercase`, `letter-spacing: 0.12em`, colour `--ink-ash`.
- KPI figures (compression, latency, blocks): `JetBrains Mono`, `20px–28px`, `tabular-nums`.

---

## 3. Animations & micro-interactions (60 FPS, tactile & atmospheric)

**Animation stack**: CSS keyframes on `transform`/`opacity` for UI transitions + **HTML5 Canvas 2D (`requestAnimationFrame`)** for real-time DSP (no React lag).

### 3.1 Living atmosphere (background)
- **Slow spectral mist**: two very diffuse radial orbs (`opacity: 0.09`, `--accent-ectoplasm` on the left, `--accent-amethyst` on the right, an `--accent-ember` hint in the centre) drifting on a slow `18s` cycle in pure CSS (`transform: translate3d`).
- **Subtle film grain**: SVG `feTurbulence` overlay at `opacity: 0.025` (`pointer-events: none`) for a premium smoked-glass / anodized-metal look.
- **Border spotlight**: when hovering instrument cards, a soft glow follows the cursor on the `1px` border (Linear / Raycast effect).

### 3.2 GhostPacket signature animations
1. **Central signal conduit (Emitter → Receiver)**:
   - An animated SVG bridge visually links the two panels.
   - **Channel A (acoustic)**: a live sine wave whose frequency follows the active FSK carrier (`1600`–`2800 Hz`) and fills with crackle when the user raises the white-noise (SNR) slider.
   - **Channel B (optical)**: a stream of glowing violet/ectoplasm droplets travelling right; when a frame falls into the **30 % simulated loss**, the droplet turns crimson and **dissolves into sparks** mid-flight with a `DROP` micro-badge.
2. **Phosphor-afterglow FFT spectrogram**:
   - Canvas rendering with a high-end CRT oscilloscope phosphor trail (gradient `#07080B` → `#0D4A3E` → `#5EF2C6` → `#F3EFE6` peak).
   - Fine annotated sight lines on the 4 carriers `f0..f3` + a pulsing **`SYNC LOCK`** indicator that locks with a sharp flash when the Barker preamble is detected.
3. **LT fountain grid — "belief propagation" cascade**:
   - The `K` blocks appear as numbered dark glass tiles (`B0`..`B15`).
   - Direct resolution (degree 1): quick spring 3D flip (`rotateX`) + ectoplasm halo.
   - **Cascade effect (peeling)**: when a block unlocks several pending droplets, a light wave runs across the unlocked tiles like dominoes (`stagger: 35ms`) with a `CASCADE ×3` counter.
4. **Ed25519 cryptographic seal (the "wow" moment)**:
   - **Success (`ED25519 VERIFIED`)**: a minimal geometric seal stamps in with a snappy spring (`stiffness: 420, damping: 24`), followed by a concentric ectoplasm ripple.
   - **1-bit curse (`CURSED / TAMPERED`)**: horizontal micro-shake (`±4px`, `180ms`), brief RGB chromatic split (controlled glitch), the corrupted byte lights up crimson in the hex inspector and the seal cracks with the exact error (`CRC32_MISMATCH` or `INVALID_SIGNATURE`).
5. **Main "1-click demo" CTA**:
   - Elegant pill button with an amber/obsidian gradient, a subtle slowly rotating shiny border (slow conic-gradient) and an integrated progress bar showing the live steps (`1. Sign & LZ4` → `2. FSK Audio` → `3. Fountain QR` → `4. Ed25519 Verified`).

### 3.3 Accessibility & performance
- Native `@media (prefers-reduced-motion: reduce)` support: turns off ambient drift, shakes and particles, while keeping clear states and telemetry.
- All CSS animations use only `transform` and `opacity` (GPU-composited, no reflow).

---

## 4. Layout & ergonomics (Dual-Canvas + field mode)

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ [Sigil] GhostPacket  |  Mode: [Virtual Lab | Real Air-Gap]  |  WASM: 6.2 ms  │
│         [ ✨ Summon the full demo (1 click · < 20s) ]        [⚡ Curse 1 bit] │
├──────────────────────────┬───────────────────────┬───────────────────────────┤
│  EMITTER                 │   HAUNT THE CHANNEL   │   RECEIVER                │
│                          │                       │                           │
│  Presets:                │  ── Animated conduit ►│  FFT spectrogram 60 FPS   │
│  [Tontine][Rx][Voucher]  │                       │  [SYNC LOCK · 14.2 dB]    │
│                          │  Audio noise (SNR):   │                           │
│  LZ4 compression:        │  ====●====== 12 dB    │  Fountain grid (16/16)    │
│  612 B → 218 B (-64%)    │                       │  [■][■][■][■][■][■][■][■] │
│                          │  Optical QR loss:     │  [■][■][■][■][■][■][■][■] │
│  [ Animated fountain QR ]│  ======●==== 30 %     │  Drops: 9 | Cascades: 4   │
│  10 FPS · Seed #A4F2     │                       │                           │
│                          │  [Integrity test]     │  ┌─────────────────────┐  │
│  [▶ Send FSK audio]      │  Flip bit #42         │  │ ✦ ED25519 VERIFIED  │  │
│                          │                       │  │ Document rebuilt    │  │
│                          │                       │  └─────────────────────┘  │
├──────────────────────────┴───────────────────────┴───────────────────────────┤
│  FRAME INSPECTOR (interactive hex)                                           │
│  [47 50 4B 54 Sync] [01 Ver] [07 Flags] [00 8E Len] [LZ4...] [CRC32] [Ed25519]│
└──────────────────────────────────────────────────────────────────────────────┘
```

### Thematic micro-copy (subtle, classy, memorable)
- Title / subtitle: **GhostPacket** — *Air-gap cryptographic séance · signed documents over sound and light*
- 1-click button: **`Summon the full demo`**
- Channel controls: **`Haunt the channel`** (white audio noise / 30 % optical loss)
- Integrity button (US-03): **`Curse 1 bit`** (immediately shows `CRC32_MISMATCH` / `INVALID_SIGNATURE` detection)
- PC ↔ phone mode: **`Field mode PC ↔ phone`**
- Verification badge: **`Cryptographic seal intact`** / **`Corrupted spirit rejected`**

---

## 5. Kiro integration (automatic steering)

This guide is loaded through the steering file **`.kiro/steering/ui-design-system.md`**:
```yaml
---
inclusion: fileMatch
fileMatchPattern: ["web/src/**/*.ts", "web/src/**/*.tsx", "web/src/**/*.css"]
---
```
So every component generated or edited under `web/src/` automatically inherits this art direction, the exact tokens, the typography and the 60 FPS animation rules.

### Implementation status
Implemented: palette tokens, self-hosted typography, spectral mist and grain, ember CTA with rotating highlight, phosphor spectrogram with carrier markers and `SYNC LOCK`, fountain grid with flash on newly resolved blocks, stamped/cracked seal, shake + chromatic split on rejection, crimson flipped byte in the inspector, `prefers-reduced-motion`.  
Not implemented (deliberately, to keep the demo lean): the animated SVG conduit with dissolving droplets, the cursor-following border spotlight and per-tile domino stagger.
