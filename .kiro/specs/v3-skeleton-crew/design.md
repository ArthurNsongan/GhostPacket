# Design — GhostPacket V3 "Skeleton Crew"

## Skeleton and apps
```text
                    crates/ghostpacket-core  (Rust → WASM, the only crypto / DSP code)
                                │ wasm-pack → packages/ghostpacket-sdk/wasm
          ┌─────────────────────┴─────────────────────┐
 packages/ghostpacket-sdk                    packages/ghostpacket-ui
 wasm-bridge · transports · keyring ·        GhostContext · spectrogram · fountain grid ·
 ledger · outbox · storage · sfx             conduit · inspector · seal · theme layers
          └───────────────┬───────────────┬───────────┘
                    apps/portal     apps/ghost-clinic     apps/ghost-tontine
                    /GhostPacket/   /GhostPacket/clinic/  /GhostPacket/tontine/
```

## Decisions
| Topic | Choice | Rejected | Reason |
|---|---|---|---|
| Workspaces | npm workspaces, one root lockfile | pnpm, Turborepo | nothing extra to install; Node ≥ 23.6 is already required |
| Package format inside the repo | packages ship TypeScript source; apps compile it with `transpilePackages` | prebuilt `dist` per package | one build step, instant edits, same code in every app |
| Imports | subpath exports `ghostpacket-sdk/<module>`, `ghostpacket-ui/<Component>` | one barrel per package | Next tree-shakes per file; the SDK barrel (`index.ts`) sets `import.meta.url` asset URLs that only the standalone build needs |
| Standalone SDK | `scripts/build-sdk.mjs` → `packages/ghostpacket-sdk/dist` with its own `package.json` | publishing the source package | consumers without TypeScript get plain ES modules |
| Runtime assets | `scripts/sync-app-assets.mjs` copies the `.wasm` and worklet into each app's `public/` before `dev`/`build` (git-ignored) | committing one copy per app | one source of truth: `packages/ghostpacket-sdk/wasm` |
| Tailwind | each app's global CSS has `@source` lines for both packages | a shared preset package | Tailwind v4 scans only the app folder by default |
| Session state | `GhostProvider` in `ghostpacket-ui/GhostContext` (core, session key, SDK); each app wraps its layout | per-app copies | AppShell stays portal-specific (navigation, telemetry) |
| Monorepo root for Turbopack | `turbopack.root` = repo root | default | packages live outside the app folder |

## Moves (git history kept with `git mv`)
| From | To |
|---|---|
| `web/src/lib/*` (except `build-info.ts`) | `packages/ghostpacket-sdk/src/` |
| `web/src/wasm/*` | `packages/ghostpacket-sdk/wasm/` |
| `web/public/worklets/capture-processor.js` | `packages/ghostpacket-sdk/assets/` |
| `sdk/{package.json,README.md,test,examples}` | `packages/ghostpacket-sdk/` |
| 13 generic components | `packages/ghostpacket-ui/src/` |
| rest of `web/` | `apps/portal/` |

`web/public/wasm/*.wasm` and the `web/` and `sdk/` lockfiles left the index: the `.wasm` is now copied at build time, and the root lockfile replaces both.

## Audit
`scripts/kiroween-audit.mjs` gains "Skeleton Crew: every app is built on the shared packages". It checks that each `apps/*/package.json` depends on both packages, and that no app source imports `ghostpacket_core` or `../apps/` / `../packages/` by path. The secret scan now walks `packages/*/src` and `apps/*/src`; the type check runs in every workspace.

## Deployment
`scripts/deploy-gh-pages.mjs` builds each app with its own base path (`/GhostPacket`, `/GhostPacket/clinic`, `/GhostPacket/tontine`) and merges the exports into one `gh-pages` tree. Each app registers its own service worker with its own scope. The portal worker ignores requests under the app sub-paths, so an app's offline cache never falls back to the portal shell.

## Theme
`data-theme="haunted" | "clean"` and `data-app="portal" | "clinic" | "tontine"` on `<html>`, set before first paint from local storage. Tokens are CSS variables in `packages/ghostpacket-ui/styles/haunted.css`, mapped to the existing Tailwind colour names (`phosphor`, `amber`, `ion`, `alarm`, …) so components keep their functional class names. Decorative layers are absolutely positioned, `pointer-events: none`, and are not rendered in Clean Field Mode or under `prefers-reduced-motion`.
