# Design — Integrable SDK and offline-to-cloud proof sync

## Overview
```text
 field device (offline)                                 back office (online later)
 ┌──────────────────────────────┐   HTTPS POST /v1/proofs   ┌─────────────────────────────┐
 │ receive (sound | light)      │   octet-stream, ≤ 512 B   │ ghostpacket-verifier        │
 │ verifyFrame  (WASM core)     │ ────────────────────────► │  ghostpacket-core (native)  │
 │ ProofOutbox  pending → …     │ ◄──────────────────────── │  ledger.jsonl (anti-replay) │
 └──────────────────────────────┘   201 | 409 | 422 | 503   └─────────────────────────────┘
```
The verifier does not trust the device: it runs the full GPKT verification again, then checks its own ledger. Two devices that redeemed the same voucher while offline both upload it; the second one gets 409.

## SDK package
| Piece | Choice | Reason |
|---|---|---|
| Build | `tsc -p web/tsconfig.sdk.json` → `sdk/dist`, then `scripts/build-sdk.mjs` adds `.js` to relative imports and copies the WASM glue, `.wasm` and worklet | one source of truth (`web/src/lib`), no extra bundler download |
| Entry | `web/src/lib/index.ts` | sets asset URLs with `new URL(…, import.meta.url)`; not imported by Next, so Turbopack never resolves the assets |
| Assets | `assets.ts` | Next build reads `NEXT_PUBLIC_BASE_PATH`; the package reads its own URLs; `load({ wasm, workletUrl })` overrides both |
| Storage | `storage.ts` (`kv()`, `setStorage`) | ledger, keyring, outbox and UI sounds work on Node and in sandboxed iframes |
| Optical receive | `receiveOptical(video, onFrame, onProgress)` | deduplicates the looped burst by frame bytes |

## Outbox (`web/src/lib/outbox.ts`)
- Item id: `fingerprint/docId/timestamp`. `docId` is text for printable ASCII ids, hex otherwise (same rule as the server).
- Stored under `ghostpacket.outbox.v1`; the endpoint under `ghostpacket.sync.endpoint`. The token is never stored.
- `sync()` normalizes the URL, then runs under a single-flight lock (`navigator.locks` when present). Each item is a `fetch` with `credentials: "omit"`, `referrerPolicy: "no-referrer"`, `redirect: "error"` and an 8 s timeout.
- State mapping: 201 synced · 409 replay · 422/413 rejected · other or network error → still pending, stop.
- Frames are kept after a 201 so that the user can still export the `.gpkt`.

## Server verifier (`crates/ghostpacket-verifier`)
| Module | Content |
|---|---|
| `lib.rs` | `Config`, `Verifier::submit(frame) → Verdict`, ledger load/append, `parse_key` (rejects weak keys) |
| `http.rs` | `serve(listener, verifier)`: thread per connection inside `Limits` (32 total, 4 per IP, token bucket 5/s burst 20); `read_request` with a 5 s whole-request deadline and strict parsing; `route` |
| `main.rs` | `verify <files>` and `serve`; secrets from `GHOSTPACKET_PASSPHRASE` / `GHOSTPACKET_TOKEN` |

### Ledger
- Key: `issuer_pubkey_hex/hex(doc_id)/timestamp` (full key, no fingerprint collision).
- Append-only JSONL, one `write_all` + `sync_data` per record, before the 201 is sent.
- Loading: a line that opens a JSON object but never closes it is a record torn by a crash; it was never acknowledged, so it is skipped. Any other unparseable line stops startup, because it could hide redemptions. After a torn tail, the next append starts on a fresh line.
- `--max-ledger` (default 100,000) caps memory; reaching it returns 503 `LEDGER_FULL`.

### Responses
| Status | Body |
|---|---|
| 201 | `status`, `receipt` (SHA-256 of the frame), `encrypted`, and for plaintext frames `doc_id`, `doc_type`, `fingerprint`, `issuer_pubkey_hex`, `trusted_issuer`, `doc_timestamp`, `document` |
| 409 | `status: "replay"`, `receipt`, `first_received_at`, `doc_id` (plaintext only) |
| 422 | `status: "rejected"`, `code`, `message` |
| 503 | `code`: `LEDGER_WRITE_FAILED`, `LEDGER_FULL`, `BUSY` |

Encrypted proofs echo no document fields, and every post-decryption failure becomes `ENCRYPTED_PROOF_REJECTED`, so the server is not an oracle for the passphrase or the plaintext.

## Known limitation
Anyone who overhears a broadcast can upload the frame first (front-running). The ledger then marks the honest device's upload as a replay. A bearer token (`GHOSTPACKET_TOKEN`) limits who can submit; binding a proof to the redeeming device would need a second signature and is out of scope.

## Testing
- `crates/ghostpacket-verifier/tests/verifier.rs`: 12 real-TCP tests (replay, 8 concurrent submits, tampering, malformed HTTP, foreign origin, slow client, token, keyring, E2EE oracle, torn ledger, corrupt ledger, ledger cap, CORS).
- `sdk/test/sdk.test.mjs`: 8 Node tests, including sync against the real verifier binary.
- `sdk/test/browser.test.mjs`: 11 headless Chrome checks with a fake microphone and camera.
- Site E2E: the Test page's outbox goes from PENDING to SYNCED · 201, and the verifier ledger matches.
