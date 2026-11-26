# GhostPacket — Halloween Redesign Plan

## V6 — "Midnight Atelier, haunted graveyard" (current)

V6 keeps the V4 interface rules (typography, single warm accent, selection without outlines) and turns the V5 playful layer spookier. Haunted Mode is the default (the theme key moved to `ghostpacket.theme.v6`, so every visitor starts haunted once).

| V5 | V6 |
|---|---|
| 3D ghost + pumpkin in the portal hero | **Full-page 3D backdrop** on every app (`HauntedBackdrop3D`, three.js on demand): misty graveyard under a huge moon, tombstones and crosses, dead trees, lit jack-o'-lanterns, translucent spectres with glowing eyes fading in and out between the graves, will-o'-the-wisps, bats circling the moon. The camera follows the pointer and walks into the graveyard on scroll. Panels become smoked glass over it |
| Cute, round ghosts with blush | **Spectres** (`GhostCrew`): tall, tattered, see-through, hollow slanted eyes with glowing green pupils, a wailing mouth. They lurk, flicker like apparitions, dissolve when the pointer comes close (always when they sit on a control), sometimes stay and stare; clicked, they lunge at you with "Boo." / "I see you" and vanish |
| Protocol: race, hop, scared | transmit → spectres stir and follow the signal; verified → they retreat and the wisps turn mist green; rejected / replay → blood moon, red fog, red eyes, the ghosts close in |
| Cartoon "woo" and giggle | Ghost **moan** with crypt echo, faint echoing giggle, a "shhh" whisper when a ghost dissolves; buttons still pop, links whoosh, toggles squeak |

---

## V5 — "Midnight Atelier, playful haunt"

V5 keeps the V4 typography, palette and selection rules and adds a playful, cartoon-spooky layer (fun, never frightening). Everything is Haunted Mode only, off under `prefers-reduced-motion`, and hidden in Clean Field Mode.

| V4 | V5 |
|---|---|
| No resident bats | 4 resident bats in the sky + a tiny flock released from the pointer on every click (`BatSwarmLayer`, above the panels, `pointer-events: none`) |
| No ghosts | **Ghostlings** (`GhostCrew`): 3 friendly Kiro-style ghosts (Kiro violet glow `--color-spectre`). GSAP idle bob, wandering, eyes that follow the pointer; shy (they usually slip away from the cursor, so they never block reading or clicking); click → "Boo!", twirl, giggle, poof, reappear. React to `transmit` (race along), `verified` (happy hop), `rejected` / `replay` (scared, faint) |
| CSS-only motion | **GSAP** (`HauntedFun`): jelly squish on every click, magnetic primary CTA, page titles rising word by word (SplitText, reverted after the intro) |
| 2D only | **3D hero** (`SpookyScene3D`, three.js loaded on demand): a ghost floating over a glowing carved pumpkin, bats in orbit, fireflies, pointer parallax; click the ghost (twirl + boo) or the pumpkin (pop + flare). Paused off screen and in hidden tabs |
| SFX off by default, protocol cues only | SFX **on by default**; fun click cues `funSfx()` in `ui-sfx`: `boo` (cartoon ghost), `giggle`, `bat` (toggles, tabs), `pop` (buttons), `whoosh` (links), `chime`. Still synthesized, still silenced while the modem or the microphone runs |

---

## V4 — "Midnight Atelier"

V4 keeps the V3 architecture (Haunted / Clean Field modes, per-app identity, `spectral()` events, procedural sound engine) and replaces its look, which had become too costume-like:

| V3 | V4 |
|---|---|
| Cinzel Decorative + Instrument Serif + Plus Jakarta Sans + JetBrains Mono | **Fraunces** (soft, "wonky" italic accent) + **Geist** + **Geist Mono** |
| Four competing accents (ectoplasm, pumpkin, violet, crimson) + a different colour per app | **One warm accent** per app (amber, copper, gold); mist green = verified only; garnet = errors; violet replaced by moon silver |
| Cobwebs on every card, wrought-iron gate, lightning flash, 6 resident bats | Moon, candle glow and grain at rest; bats only on `transmit`; Blood Moon on rejection, no lightning |
| Filled, gold-stroked emblems | Fine-line monochrome emblems, only the light glows |
| Accent outlines for selection, lit borders under the cursor | Tonal fills + weight for selection; a candle glow inside the panel under the cursor |
| Three identical `globals.css` | One shared `ghostpacket-ui/styles/ghostpacket.css` |

Reference: `UI_DESIGN_GUIDELINES.md`. The V3 plan below is kept for history; where it conflicts with V4, V4 wins.

---

## V3 — "Gothic Lantern & Ectoplasm" (superseded)

> **Art Direction**: **Classy AND Scary** — inspired by *Tim Burton x A24 Gothic Cinema x Castlevania x Teenage Engineering*. Features carved pumpkins, animated bat swarms, a glowing moon & Blood Moon eclipse, hairline architectural cobwebs, and procedural spooky Web Audio sound effects — while maintaining crisp readability and high-precision telemetry.
>
> **Dual-Mode Switch**: Every app includes a one-click header toggle between **`Haunted Mode`** (default for Kiroween) and **`Clean Field Mode`** (restrained high-contrast layout for real rural clinics and tontines).

---

## 1. Visual System (`packages/ghostpacket-ui`)

### 1.1 Color Tokens ("Midnight Crypt, Pumpkin Flame & Ectoplasm")
- `--bg-crypt-void`: `#06050A` (deep nocturnal violet-obsidian canvas)
- `--bg-tombstone`: `#0E0C15` (instrument panels with subtle 2.5% film grain)
- `--bg-velvet-dark`: `#171422` (elevated surfaces, inputs, unsolved Fountain tiles)
- `--flame-pumpkin`: `#FF7A18` -> `#F59E0B` (candlelight flicker, primary CTAs, carved lantern eyes)
- `--glow-ectoplasm`: `#5EF2C6` (active FSK/OFDM/ChromaCrypt signals, `ED25519 VERIFIED`, resolved blocks)
- `--mist-witch`: `#A855F7` -> `#6B21A8` (lunar mist, optical channel, spectral bats)
- `--blood-moon`: `#E11D48` -> `#991B1B` (integrity alerts, `CRC32_MISMATCH`, `INVALID_SIGNATURE`, `REPLAY_DETECTED`, dropped droplets)
- `--ink-parchment`: `#F5EFE6` (warm bone-parchment text, WCAG AA+ contrast)

### 1.2 Per-App Spooky Identity (Showcasing Skeleton Crew Flexibility)
| App | Theme Variant | Signature Accent | Animated Emblem |
|---|---|---|---|
| `apps/portal` (*The Haunted Telegraph*) | Spectral Signal Lab | Pumpkin Flame `#FF7A18` + Ectoplasm `#5EF2C6` | Audio-reactive carved **Jack-o'-Lantern** SVG |
| `apps/ghost-clinic` (*The Apothecary's Ward*) | Neo-Gothic Apothecary | Elixir Emerald `#34D399` + Bone Parchment `#F5EFE6` | Geometric **Plague Doctor Mask** & ectoplasm vial SVG |
| `apps/ghost-tontine` (*The Midnight Vault*) | Haunted Ledger & Crypt | Candlelight Gold `#F59E0B` + Deep Plum `#9333EA` | Animated **Wax Seal & Skeleton Key** SVG |

---

## 2. Typography (100% Self-Hosted via `@fontsource`, Zero Network Calls)
- **Gothic Display**: `Cinzel Decorative` (monumental engraved titles) paired with `Instrument Serif Italic` (dramatic status subtitles).
- **UI & Forms**: `Plus Jakarta Sans` (high legibility for medical records, financial ledgers, and controls).
- **Protocol / Hex / Telemetry**: `JetBrains Mono` with `font-variant-numeric: tabular-nums`.

---

## 3. Signature Spooky Components & 60 FPS Animations

1. **`LanternGuardian.tsx` (Audio-Reactive Carved Pumpkin)**:
   - Fine-line obsidian & gold vector Jack-o'-Lantern (no flat emoji).
   - Organic `candle-flicker` idle animation; eyes and grin pulse live with FFT energy during acoustic transmission; shifts to calm ectoplasm green on `ED25519 VERIFIED`; flares crimson with tremor on `CURSED / REJECTED`.
2. **`BatSwarmLayer.tsx` (Animated Spectral Bats)**:
   - Lightweight Canvas/SVG silhouettes with smooth wing-flap physics (`pointer-events: none`).
   - Ambient slow drift across the moonlit hero; directional swarm bursts from Emitter to Receiver along the *Ether Conduit* when transmitting; bats dissolve into ember sparks on simulated 30% optical frame drops; celebratory/alarm burst on `Summon Demo` or `Curse 1 Bit`.
3. **`BloodMoonAtmosphere.tsx` (Moon, Eclipse, Lightning & Wrought-Iron Silhouette)**:
   - Pale misty full moon + ultra-subtle gothic iron gate footer silhouette (`opacity: 0.07`).
   - On any cryptographic rejection or replay alert: a crisp `120 ms` hairline lightning flash triggers a `1.6 s` **Blood Moon Crimson Eclipse** before smoothly fading back to midnight obsidian.
4. **`CobwebPanel.tsx` (Architectural Cobweb Cards + Cursor Spotlight)**:
   - Instrument cards featuring delicate `0.6px` silver geometric cobwebs in upper corners (`opacity: 0.14`) illuminated subtly by a pointer-tracking radial spotlight on the `1px` specular border.
5. **`SpectralImageReveal.tsx` (Haunted Mirror Progressive Materialization)**:
   - During **ChromaCrypt** image transfers, incoming blocks progressively burn through animated spectral fog until the full clinical/custom image locks in clear with the stamped **Ed25519 Wax Seal**.
6. **Reduced Motion**: Full support for `@media (prefers-reduced-motion: reduce)` and `Clean Field Mode`.

---

## 4. Procedural Spooky Sound Engine (`packages/ghostpacket-sdk/src/sound/haunted-sfx.ts`)

100% pure **Web Audio API synthesis** (0 KB audio files, 0 network calls, works offline). Controlled via header toggles (`Spooky SFX: ON/OFF` and `Crypt Ambience: ON/OFF`).

| Trigger | Web Audio Synthesis | Effect |
|---|---|---|
| **Crypt Ambience** (optional, `-28 dB`) | Detuned `55 Hz` + `55.6 Hz` low-passed drone + LFO-swept pink-noise night wind | Subtle cinematic tension |
| **Start Transmission (`Summon`)** | Spectral **Theremin** vibrato glide (`310 -> 620 Hz` + delay) + filtered bat-wing whoosh | Iconic haunted launch |
| **Preamble Lock (`SYNC LOCK`)** | FM metallic bell chime (`880 Hz` + inharmonic partials) | Midnight clock strike |
| **Dropped Frame (30% Loss)** | Soft `25 ms` bandpass crackle (`2.4 kHz`) | Signal spark lost in ether |
| **Verified (`ED25519 VERIFIED`)** | Luminous gothic organ fifth chord + crisp wax-seal stamp thump | Majestic confirmation |
| **Tampered / Rejected (`CURSED`)** | Dissonant **tritone (*Diabolus in Musica*)** + `42 Hz` rolling thunder rumble (`1.1 s`) | Unforgettable spooky warning |
| **Replay Alert (`REPLAY_DETECTED`)** | Double low funeral bell toll (`146 Hz`) | Solemn double-spend alert |
| **Cloud Sync Complete** | Soft ascending ethereal chime arpeggio | Packets synced to cloud |

> **Critical Acoustic Safety Rule**: `HauntedSfxEngine` automatically mutes (`autoDuck = 0`) whenever a real microphone (`MicReceiver`) is active or a real speaker burst (`FSK` / `OFDM` / `Ultrasonic`) is playing in **Field / Test Mode**, guaranteeing zero interference with physical acoustic decoding.

---

## 5. Implementation Steps (Integrated into V3 Phase 4)

1. Install `@fontsource/cinzel-decorative` and create `packages/ghostpacket-ui/styles/haunted.css` with theme tokens (`data-app="portal" | "clinic" | "tontine"` and `data-theme="haunted" | "clean"`).
2. Build `packages/ghostpacket-sdk/src/sound/haunted-sfx.ts` with all 8 procedural Web Audio synthesizers and automatic modem ducking.
3. Build reusable spooky components (`LanternGuardian`, `BatSwarmLayer`, `BloodMoonAtmosphere`, `CobwebPanel`, `SpectralImageReveal`, `HauntedControls`) inside `packages/ghostpacket-ui`.
4. Apply across `apps/portal`, `apps/ghost-clinic`, and `apps/ghost-tontine`, verifying 60 FPS animations, WCAG AA contrast, zero network calls, and zero microphone interference.
