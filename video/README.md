# Demo video pipeline

Scripted recording and editing of the GhostPacket demo video. Every shot is replayed from code, so a UI change only needs a new run, not a new screen recording.

| Step | Command | Output |
|---|---|---|
| 0. Build the site | `node scripts/build-pages.mjs --base /GhostPacket` | `pages-out/` (or record the live site with `--live`) |
| 1. Narration | `node video/narrate.mjs [--voice "Microsoft David Desktop"] [--rate 2]` | `video/work/voice/<scene>.wav` + durations |
| 2. Recording | `node video/capture.mjs [--only 07-chimera] [--live <url>]` | `video/work/clips/<scene>.mp4` (1920×1080, 30 fps) |
| 3. Editing | `node video/assemble.mjs [--only …] [--no-burn]` | `video/out/ghostpacket-demo.mp4`, `…-subtitled.mp4`, `….srt` |

Shortcuts from `video/`: `npm run all`, `npm run smoke` (two scenes, about 40 s).

## How it works
- **Shot list:** `scenes.mjs`. Each scene has its narration and its actions: open a page, click a button by its text, type into a field by its `aria-label`, wait for a result. A scene without `path` continues on the page of the previous scene.
- **Recording** (`lib/cdp.mjs`, `lib/recorder.mjs`): a Chrome window with GPU acceleration is parked off-screen (x = −2400), the page is emulated at 1920×1080, and CDP screencast frames (about 55 per second) are turned into a constant 30 fps clip. A drawn cursor and real mouse moves show where each click happens; the hover effects and spectres react to them. `GP_VIDEO_HEADLESS=1` uses headless SwiftShader instead (about 5 frames per second, only for machines without a GPU).
- **Length:** each clip holds until its narration ends. `speed` in a scene speeds up long real-time waits (Chimera Turbo plays at ×1.35).
- **Title cards:** `cards/card.html` (Midnight Atelier palette, Fraunces and Geist from `node_modules/@fontsource-variable`), parameters in the scene's `card`.
- **Editing:** fades between scenes, voice 0.35 s after each cut, loudness normalized to −14 LUFS, captions cut at sentence boundaries (≤ 44 characters), soft subtitles in the MP4 and a burned-in copy.

## Replacing the placeholder voice
The narration is a Windows voice (SAPI, offline). To use a real voice, record each scene's text from `scenes.mjs` and save it as `video/voice/<scene id>.wav` (for example `video/voice/03-one-click.wav`). Run `narrate.mjs` again (it keeps your recordings and measures them), then `capture.mjs` and `assemble.mjs`: clip lengths follow the new durations.

## Real footage
Files dropped in `video/footage/` replace a scene (their own sound is kept at 25 % under the narration):
- `field.mp4`: a laptop sending to a phone over sound or light (scene `09-field`, skipped if absent);
- `kiro.mp4`: a screen recording of the Kiro IDE (specs, hooks, MCP) instead of the `10-kiro` card.

Any resolution or frame rate works; the editor scales and pads it to 1920×1080 at 30 fps.

## Requirements
Node ≥ 20, Google Chrome, ffmpeg and ffprobe in `PATH` (tested with ffmpeg 8.1), Windows PowerShell for the placeholder voice. Generated files (`video/work/`, `video/out/`, footage, recordings) are not committed.
