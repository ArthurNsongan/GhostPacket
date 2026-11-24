---
inclusion: fileMatch
fileMatchPattern: "crates/**/*.rs"
---

# Determinism and safety of the Rust/WASM crate

These rules apply to all code in `crates/ghostpacket-core/src/`. The `wasm-no-panic-guard` hook checks them on every save.

## Zero panic
- Forbidden outside `#[cfg(test)]`: `.unwrap()`, `.expect(`, `panic!(`, `todo!(`, `unimplemented!(`, `unreachable!(`.
- No direct indexing on untrusted input: use `.get(..)` and return a `GhostError`.
- Arithmetic on received lengths: `checked_*`, `saturating_*`, or bounds checked before the computation.
- A panic in WASM kills the instance: the browser would lose the whole demo state.

## Bit-exact determinism
- No `std::time`, no `getrandom`, no `HashMap` whose order could affect an output.
- Every seed (Ed25519, AWGN noise, fountain PRNG) and every timestamp is passed as an argument.
- Single PRNG: `xorshift64*` defined in `fountain.rs`, shared with `channel_sim.rs`. Bounded draws use the high 32 bits (the low bits are weak).
- The same inputs produce the same bytes on every platform (native tests = WASM behaviour).

## Bounded memory
| Constant | Value |
|---|---|
| `MAX_FRAME_SIZE` | 512 bytes |
| `MAX_PAYLOAD_LEN` | 436 bytes |
| `MAX_DECOMPRESSED_BYTES` | 4096 bytes |
| `MAX_SAMPLES` | 48000 × 40 (a 512-byte robust burst lasts ≈ 34 s) |
| `MAX_PENDING_DROPLETS` | 256 |

Any input over a bound is rejected **before** allocation.

## Messages
`GhostError::code()` is the stable contract with the UI. `Display` messages are short English sentences that include the measured values (sizes, CRC values, sample offsets).

## Release profile
`opt-level = "z"`, `lto = true`, `codegen-units = 1`, `panic = "abort"`.
