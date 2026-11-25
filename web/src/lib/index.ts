// Public entry of the standalone SDK package (sdk/). Not imported by the site.
// Asset URLs default to files shipped next to this module.
import { configureAssets } from "./assets";

configureAssets({
  wasm: new URL("../wasm/ghostpacket_core_bg.wasm", import.meta.url),
  workletUrl: new URL("../assets/capture-processor.js", import.meta.url).href,
});

export { GhostPacketSDK, downloadFile, GPKT_MIME, MAX_GPKT_FILE } from "./sdk";
export type { LoadOptions, SealOptions, VerifyOptions, Verified } from "./sdk";
export { configureAssets } from "./assets";
export type { AssetConfig } from "./assets";
export { setStorage } from "./storage";
export type { KeyValueStore } from "./storage";
export { ProofOutbox, normalizeEndpoint, frameOf, onOutboxChange } from "./outbox";
export type { OutboxItem, OutboxState, SyncOptions, SyncReport } from "./outbox";
export { redeem, readLedger, clearLedger, onLedgerChange } from "./ledger";
export type { LedgerEntry, LedgerCheck, LedgerScope } from "./ledger";
export { identityText, parseIdentity, readKeyring, trustKey, forgetKey, IDENTITY_PREFIX } from "./keyring";
export type { TrustedKey } from "./keyring";
export { messageDraft, messageBudget, newDocId, docTitle } from "./messages";
export type { MessageInput } from "./messages";
export { MicReceiver, playBurst } from "./audio-engine";
export { CameraScanner, broadcast, drawQr } from "./optical-engine";
export { Core, loadCore, toHex, fromHex, newSigningSeed, normalizePassphrase } from "./wasm-bridge";
export type { Result } from "./wasm-bridge";
export * from "./types";
