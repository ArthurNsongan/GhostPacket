// Public entry of the standalone SDK build (packages/ghostpacket-sdk/dist). Apps of
// the monorepo import subpaths (ghostpacket-sdk/<module>) instead.
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
export { setStorage, setStorageNamespace } from "./storage";
export { collection, shortId, docIdBytes } from "./records";
export type { Collection, RecordBase } from "./records";
export { isModemBusy, onModemActivity } from "./modem-activity";
export type { KeyValueStore } from "./storage";
export { ProofOutbox, normalizeEndpoint, frameOf, onOutboxChange } from "./outbox";
export type { OutboxItem, OutboxState, SyncOptions, SyncReport } from "./outbox";
export { redeem, redeemOnce, findRedemption, guardScope, isGuarded, readLedger, clearLedger, onLedgerChange } from "./ledger";
export type { LedgerEntry, LedgerCheck, LedgerScope, RedeemOutcome } from "./ledger";
export { redemptionGate, issuerPinned, kindOf } from "./redemption-policy";
export type { Gate, GateReason, DocKind } from "./redemption-policy";
export { identityText, parseIdentity, readKeyring, trustKey, forgetKey, IDENTITY_PREFIX } from "./keyring";
export type { TrustedKey } from "./keyring";
export { messageDraft, messageBudget, newDocId, docTitle, identityCardDraft, identityCardLabel, IDENTITY_CARD_TITLE } from "./messages";
export { sealCompact, ledgerTotal, receiptIdText } from "./ledger-batch";
export { runChimeraTurbo, chimeraBroadcast, isBundle, DROPLETS_PER_BURST } from "./chimera-turbo";
export type { TurboOutcome, TurboTick, TurboOptions, TurboLane } from "./chimera-turbo";
export { LanLink, scanQrText, parseSignal, encodeSignal, expandSignal, compactSdp, LAN_PREFIX, LAN_MAX_MESSAGE } from "./lan-link";
export type { LanSignal, LanState, LanRole } from "./lan-link";
export type { MessageInput } from "./messages";
export { MicReceiver, playBurst } from "./audio-engine";
export { CameraScanner, broadcast, drawQr } from "./optical-engine";
export { ChromaScanner, chromaBroadcast, drawChroma, runChromaLoopback } from "./chroma-engine";
export { encodeImage, loadBitmap, sampleRdtImage, IMAGE_BUDGETS } from "./image-codec";
export type { ImageBudget, EncodedImage } from "./image-codec";
export { storedVault, storedIdentity, vaultStatus, createIdentity, unlockIdentity, forgetIdentity, exportVaultFile, importVaultFile } from "./identity";
export { Core, ChromaReceiver, loadCore, toHex, fromHex, newSigningSeed, normalizePassphrase } from "./wasm-bridge";
export type { Result } from "./wasm-bridge";
export * from "./types";
