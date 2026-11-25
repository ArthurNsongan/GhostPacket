# Requirements — Integrable SDK and offline-to-cloud proof sync

## Introduction
Two gaps remained after V2. The SDK only existed inside the web app, and a proof verified offline never reached any back office, so a voucher redeemed on two disconnected devices went unnoticed. This spec packages the SDK as `ghostpacket-sdk` and adds a client outbox plus a Rust server verifier (`crates/ghostpacket-verifier`) that re-verifies every proof with `ghostpacket-core` and keeps a server-side anti-replay ledger.

## Requirements

### Requirement 1 — Standalone SDK package
**User story:** As an integrating developer, I want to install GhostPacket as a package, so that I can add signed offline transfer to my own app without copying the demo.

#### Acceptance criteria
1. THE SYSTEM SHALL publish an ES module package `ghostpacket-sdk` that contains the compiled facade, its type declarations, the WASM glue, the `.wasm` binary and the capture worklet.
2. THE SYSTEM SHALL resolve the `.wasm` and worklet URLs relative to the package, and SHALL let the caller override them (`wasm`, `workletUrl`).
3. WHEN `localStorage` is unavailable (Node, workers), THE SYSTEM SHALL fall back to in-memory storage, and SHALL accept a caller-provided key-value store.
4. THE SYSTEM SHALL load in a plain browser page with an import map and no bundler.
5. THE SYSTEM SHALL test every transport method of the package: `sealMessage`, `verifyFrame`, E2EE, `transmitOptical`, `receiveOptical`, `transmitAcoustic`, `receiveAcoustic`, `syncProofs`.
6. WHEN `receiveOptical` sees the same looped QR burst again, THE SYSTEM SHALL report the frame once.

### Requirement 2 — Proof outbox
**User story:** As an aid distributor, I want every voucher verified offline to be kept, so that it is uploaded when the network returns.

#### Acceptance criteria
1. WHEN a frame is verified on the Test page, THE SYSTEM SHALL queue it locally as `pending`, once per document (issuer, document id, signed timestamp).
2. THE SYSTEM SHALL store the frame exactly as received (ciphertext for encrypted frames) and SHALL never send it while no verifier URL is set.
3. THE SYSTEM SHALL accept only `https://` verifier URLs, or `http://` for localhost, 127.0.0.1 and [::1], without credentials in the URL.
4. WHEN the server answers 201, THE SYSTEM SHALL mark the item `synced`; 409, `replay` (double spend); 422 or 413, `rejected` with the server code; any other answer or a network error SHALL leave it `pending` and stop the sync.
5. THE SYSTEM SHALL run one sync at a time (across tabs where Web Locks exist), SHALL refuse HTTP redirects, and SHALL keep only well-formed server codes and timestamps.
6. WHILE the outbox holds `MAX_OUTBOX` (200) items, THE SYSTEM SHALL evict rejected, then replay, then synced items, and SHALL refuse a new proof rather than drop a pending one.
7. WHERE auto sync is enabled, THE SYSTEM SHALL sync each time the browser comes back online.
8. THE SYSTEM SHALL keep a verifier bearer token in memory only.

### Requirement 3 — Server verifier
**User story:** As a program back office, I want to re-verify field proofs and catch double spends, so that I do not trust the field devices blindly.

#### Acceptance criteria
1. THE SYSTEM SHALL verify each posted frame with the same `ghostpacket-core` code as the browser (structure, CRC32, optional decryption, keyring, Ed25519).
2. THE SYSTEM SHALL answer `201 accepted` with a SHA-256 receipt the first time a document is seen, and `409 replay` with the first reception time afterwards, also under concurrent submissions.
3. IF a frame fails verification, THEN THE SYSTEM SHALL answer 422 with the core error code; for encrypted frames, every error after decryption SHALL be reported as `ENCRYPTED_PROOF_REJECTED`.
4. THE SYSTEM SHALL refuse to start `serve` without either pinned issuers (`--trust`) or an explicit `--tofu`.
5. THE SYSTEM SHALL read the passphrase and the bearer token only from the environment.
6. WHEN started with a ledger file, THE SYSTEM SHALL persist each redemption before answering 201, SHALL reload it on restart, SHALL skip records torn by a crash, and SHALL refuse to start on any other corrupt line.
7. IF the ledger cannot be written or is full, THEN THE SYSTEM SHALL answer 503 so that clients retry.
8. THE SYSTEM SHALL bound every request: 5 s deadline, head ≤ 2 KiB, one numeric `Content-Length` ≤ 512 bytes, no `Transfer-Encoding`, `Content-Type: application/octet-stream`, at most 32 connections and 4 per IP, and a token-bucket rate limit.
9. WHERE `--allow-origin` is set, THE SYSTEM SHALL answer CORS for that exact origin and SHALL reject a POST carrying any other `Origin` with 403; `*` SHALL be refused.
10. THE SYSTEM SHALL refuse weak (small-order) Ed25519 keys as trusted issuers.
