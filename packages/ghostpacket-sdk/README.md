# ghostpacket-sdk

Ed25519-signed documents (≤ 512 bytes) sent offline over sound (4-FSK modem) or light (fountain-coded QR burst), verified by a Rust/WASM core. Proofs verified offline can be synced later to a `ghostpacket-verifier` server.

```js
import { GhostPacketSDK } from "ghostpacket-sdk";

const gp = await GhostPacketSDK.load(); // load({ wasm, workletUrl, storage, seed }) to override
const sealed = gp.sealMessage({ sender: "Kaolack point 4", title: "Voucher", message: "25 kg rice" });
if (sealed.ok) await gp.transmitAcoustic(sealed.value.frame);

const rx = await gp.receiveAcoustic({
  onFrame: (frame) => {
    const v = gp.verifyFrame(frame);
    if (v.ok) gp.queueProof(frame, v.value, "sound");
  },
});
// later, online: await gp.syncProofs("https://verifier.example.org")
```

| Method | Purpose |
|---|---|
| `sealMessage(input, { passphrase? })` | sign (and optionally encrypt) a message or document draft |
| `verifyFrame(frame, { passphrase?, strictKeyring?, trusted?, ledger? })` | CRC32, decryption, keyring, Ed25519, anti-replay ledger |
| `transmitAcoustic(frame, opts)` / `receiveAcoustic({ onFrame })` | speaker → microphone |
| `transmitOptical(frame, canvas, signal)` / `receiveOptical(video, onFrame)` | screen → camera |
| `exportGpktFile` / `importGpktFile` | `.gpkt` files (the raw frame) |
| `queueProof` / `syncProofs` / `enableAutoSync` | offline-to-cloud sync (201 synced, 409 double spend, 422 rejected) |

Without a bundler, map `ghostpacket-sdk`, `jsqr` and `qrcode-generator` in an import map (see `examples/browser/`). In Node, storage falls back to memory; sealing, verification and sync work, audio and camera I/O do not.

Nothing is sent over the network unless you call `syncProofs` or `enableAutoSync` with an endpoint.

MIT licence. Source and full documentation: https://github.com/ArthurNsongan/GhostPacket
