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

## Apps on one origin
| Concern | Mechanism |
|---|---|
| Data isolation | `setStorageNamespace(app)` (called by `AppFrame`, and first thing in each app's store module): keys become `clinic:…`, `tontine:…`. The portal keeps the V2 unprefixed keys. Theme and sound preferences use `prefs()`, shared by all apps. |
| Records | `collection<T>(name, max)` in `records.ts`: synchronous, bounded, newest first. `insert()` draws a new id on collision instead of overwriting. |
| Offline | One service worker per app, scoped to its sub-path, cache `gp-<app>-v3`. A worker reads only its own cache and deletes only its own old caches. The portal worker ignores `/clinic` and `/tontine`. Pages are cached without query string; the unhashed `.wasm` and worklet are network-first. |

## Redemption policy (`redemption-policy.ts`)
A valid signature proves that *someone* signed. Anyone can open the public app and sign a 1,000,000 XOF voucher with a fresh key, so an app only dispenses or pays out when `redemptionGate` passes:
1. the expected document type (prescription at the pharmacy, voucher at the pay-out desk, receipt in the wallet);
2. no DEMO flag;
3. an issuer pinned in the keyring (or this device's own session key, for the one-device virtual hand-over);
4. signed timestamp at most 10 minutes ahead of the device clock; voucher not expired.

`IssuerGate` explains a refusal and offers to pin the issuer after an out-of-band fingerprint check.

Guarded ledger scopes (`dispensed`, `vouchers`) use `redeemOnce`. They never evict (cap 5,000, then refuse), cannot be cleared from the UI, and fail closed: a failed or unconfirmed write returns `LEDGER_WRITE_FAILED` and nothing is handed out. The proof queued for sync is the redemption itself.

Vouchers are paid out at the pay-out desk (the treasurer's or a merchant's device), not on the beneficiary's phone, which only keeps a wallet view.

## Sound safety
`modem-activity.ts` counts real speaker bursts and microphone captures. When it is non-zero:
- `ui-sfx` refuses new cues;
- the master gain drops to 0 at once, which also silences tails of cues already scheduled;
- the ambience ducks.

`AirSender` plays no cue before a real burst, only the visual `transmit` event. If `MicReceiver.stop()` is called while `getUserMedia` is pending, the late stream is closed (generation counter).

## Security review (`dsp-security-auditor`, V3)
| Finding | Severity | Fix |
|---|---|---|
| Apps dispensed / paid any validly signed document (TOFU) | critical | `redemptionGate` + `IssuerGate`; proofs queued only after redemption |
| Ledger evicted after 200 entries | high | guarded scopes: no eviction, refuse when full |
| Quota errors swallowed by `writeJson` | medium | `writeJson` returns a boolean; `redeemOnce` fails closed and reads back |
| DEMO frames and other document types redeemable | medium | type and DEMO checks in the gate |
| Beneficiary controls the voucher ledger, one-click clear | medium | pay-out desk wording, guarded scopes cannot be cleared |
| Scheduled cue tails played into a burst | medium | master gain cut, no cue before a burst |
| Mic left on when stopped during `getUserMedia` | medium | generation counter in `MicReceiver` |
| `caches.match` across all caches of the shared origin | medium | each worker matches only its own cache |
| Id collisions overwrote records | medium | `insert()` / `freeId()` |
| E2E server path traversal, bound to every interface | medium | `127.0.0.1`, path check |
| Voucher expiry only in the UI, mixed-unit totals, `/clinic` without slash, query-string cache growth, stale `.wasm`, ambience races, `--out` deletion | low | fixed |
| Persistent issuer key, shared `github.io` origin | design | open decisions (tasks 4.1, 4.2) |

## Known limits
- The issuer key lives for one tab session (product steering). A pharmacy's pin of a clinic key therefore lasts until the clinic reloads. Task 4.1 tracks the persistent-key decision.
- Records live in `localStorage` on a shared GitHub Pages origin. Other pages of the same `<user>.github.io` account could read them. They are not confidential until the apps move to a dedicated origin (task 4.2).
- The plan's IndexedDB store was not used: bounded synchronous collections on the SDK key-value store are enough for hundreds of records and keep the Node tests simple.
