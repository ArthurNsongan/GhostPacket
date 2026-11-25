// SDK tests on Node (no browser): seal / verify / E2EE / .gpkt / ledger / keyring,
// and offline-to-cloud sync against a real ghostpacket-verifier process.
//   npm run build:sdk && npm run test:sdk          (from the repo root)
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  clearLedger,
  collection,
  GhostPacketSDK,
  identityText,
  isGuarded,
  parseIdentity,
  readLedger,
  redeemOnce,
  redemptionGate,
  setStorage,
  setStorageNamespace,
  trustKey,
} from "../dist/lib/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const wasm = readFileSync(join(here, "..", "dist", "wasm", "ghostpacket_core_bg.wasm"));
const MSG = { sender: "Ndiob health post", title: "Rx 0815", message: "Artemether 4 tablets twice a day, 3 days." };

let gp;
before(async () => {
  gp = await GhostPacketSDK.load({ wasm, seed: new Uint8Array(32).fill(7) });
});

describe("seal and verify", () => {
  test("a sealed message verifies and round-trips its text", () => {
    const s = gp.sealMessage(MSG);
    assert.ok(s.ok, s.ok ? "" : s.error.code);
    assert.ok(s.value.frameLen <= 512);
    const v = gp.verifyFrame(s.value.frame);
    assert.ok(v.ok);
    assert.equal(v.value.docType, 4);
    assert.equal(v.value.document.body.customMessage.message, MSG.message);
    assert.equal(v.value.fingerprint, gp.identity.fingerprint);
  });

  test("end-to-end encryption hides the text and needs the passphrase", () => {
    const s = gp.sealMessage(MSG, { passphrase: "baobab moon harmattan" });
    assert.ok(s.ok && s.value.encrypted);
    assert.ok(!Buffer.from(s.value.frame).includes("Artemether"), "plaintext leaked into the frame");
    assert.equal(gp.verifyFrame(s.value.frame).error?.code, "PASSPHRASE_REQUIRED");
    assert.equal(gp.verifyFrame(s.value.frame, { passphrase: "wrong" }).error?.code, "DECRYPTION_FAILED");
    // NFC and NFD forms of the same passphrase derive the same key.
    const accented = gp.sealMessage(MSG, { passphrase: "caf\u00e9 lun\u00e9" });
    assert.ok(gp.verifyFrame(accented.value.frame, { passphrase: "cafe\u0301 lune\u0301" }).ok);
  });

  test("a flipped bit is rejected", () => {
    const f = gp.sealMessage(MSG).value.frame.slice();
    f[20] ^= 1;
    assert.equal(gp.verifyFrame(f).error?.code, "CRC32_MISMATCH");
  });

  test(".gpkt export / import round-trip, oversized files refused", async () => {
    const frame = gp.sealMessage(MSG).value.frame;
    const file = gp.exportGpktFile(frame, "rx.gpkt");
    const back = await gp.importGpktFile(file);
    assert.ok(back.ok);
    assert.deepEqual(Array.from(back.value), Array.from(frame));
    const big = await gp.importGpktFile(new Blob([new Uint8Array(600)]));
    assert.equal(big.error?.code, "FRAME_TOO_LARGE");
  });
});

describe("ledger and keyring (in-memory storage on Node)", () => {
  test("second redemption is a replay", () => {
    const frame = gp.sealMessage(MSG).value.frame;
    const a = gp.verifyFrame(frame, { ledger: "field", channel: "sound" });
    const b = gp.verifyFrame(frame, { ledger: "field", channel: "light" });
    assert.equal(a.value.replay.status, "first");
    assert.equal(b.value.replay.status, "replay");
    assert.ok(readLedger("field").every((e) => !JSON.stringify(e).includes("Artemether")), "ledger must not store message text");
  });

  test("strict keyring rejects other issuers", async () => {
    const other = await GhostPacketSDK.load({ seed: new Uint8Array(32).fill(9) });
    const parsed = parseIdentity(gp.core, identityText("Clinic", gp.identity.publicKeyHex));
    assert.ok(parsed.ok);
    trustKey(parsed.key);
    assert.ok(gp.verifyFrame(gp.sealMessage(MSG).value.frame, { strictKeyring: true }).ok);
    assert.equal(gp.verifyFrame(other.sealMessage(MSG).value.frame, { strictKeyring: true }).error?.code, "UNTRUSTED_ISSUER");
    assert.equal(parseIdentity(gp.core, "GPKT-KEY:x:" + "00".repeat(32)).ok, false, "invalid curve point");
  });
});

describe("redemption policy (apps: dispense once, pay out once)", () => {
  const NOW = Math.floor(Date.now() / 1000);
  const rx = (id) => ({
    docId: Array.from(id.padEnd(8, " "), (c) => c.charCodeAt(0)),
    timestamp: NOW,
    body: { medicalPrescription: { clinic: "Ndiob", practitioner: "Nurse Sarr", patientRef: "PAT-0815 (F, 34 y)", items: [{ drug: "Paracetamol 500 mg", dosage: "1 tablet", days: 3 }], note: "" } },
  });

  test("a valid signature from an unpinned issuer is not redeemable until pinned", async () => {
    const stranger = await GhostPacketSDK.load({ seed: new Uint8Array(32).fill(0x31) });
    const v = gp.verifyFrame(stranger.sealMessage(rx("RX-00001")).value.frame).value;
    assert.equal(redemptionGate(v, { kind: "medicalPrescription" }).reason, "UNPINNED_ISSUER");
    assert.ok(redemptionGate(v, { kind: "medicalPrescription", selfKeyHex: stranger.identity.publicKeyHex }).ok, "own session key is trusted");
    trustKey({ label: "Ndiob", publicKeyHex: stranger.identity.publicKeyHex, fingerprint: stranger.identity.fingerprint });
    assert.ok(redemptionGate(v, { kind: "medicalPrescription" }).ok);
    assert.equal(redemptionGate(v, { kind: "emergencyVoucher" }).reason, "WRONG_DOCUMENT");
  });

  test("DEMO frames, expired vouchers and future timestamps are refused", () => {
    const self = { selfKeyHex: gp.identity.publicKeyHex };
    const demo = gp.verifyFrame(gp.sealMessage(rx("RX-00002"), { flags: 0b1110 }).value.frame).value;
    assert.equal(redemptionGate(demo, { kind: "medicalPrescription", ...self }).reason, "DEMO_FRAME");
    const voucher = (validUntil, timestamp = NOW) => ({
      docId: Array.from("AID-0001", (c) => c.charCodeAt(0)),
      timestamp,
      body: { emergencyVoucher: { program: "Solidarity fund", distributor: "Treasurer", beneficiaryRef: "MBR-0017", items: [{ label: "Cash", quantity: 15000, unit: "XOF" }], validUntil, note: "" } },
    });
    const expired = gp.verifyFrame(gp.sealMessage(voucher(NOW - 60)).value.frame).value;
    assert.equal(redemptionGate(expired, { kind: "emergencyVoucher", ...self }).reason, "EXPIRED");
    const future = gp.verifyFrame(gp.sealMessage(voucher(NOW + 86400, NOW + 3600)).value.frame).value;
    assert.equal(redemptionGate(future, { kind: "emergencyVoucher", ...self }).reason, "FUTURE_TIMESTAMP");
  });

  test("guarded ledger: once, then replay; no clear; fails closed when storage fails", () => {
    const v = gp.verifyFrame(gp.sealMessage(rx("RX-00003")).value.frame).value;
    assert.equal(redeemOnce("dispensed", v, "light").status, "first");
    assert.equal(redeemOnce("dispensed", v, "sound").status, "replay");
    assert.ok(isGuarded("dispensed"));
    clearLedger("dispensed");
    assert.equal(redeemOnce("dispensed", v, "sound").status, "replay", "a guarded ledger cannot be cleared");

    const map = new Map();
    setStorage({ getItem: (k) => map.get(k) ?? null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: (k) => map.delete(k) });
    const w = gp.verifyFrame(gp.sealMessage(rx("RX-00004")).value.frame).value;
    const out = redeemOnce("dispensed", w, "light");
    assert.equal(out.status, "unavailable");
    assert.equal(out.code, "LEDGER_WRITE_FAILED");
    const fresh = new Map();
    setStorage({ getItem: (k) => fresh.get(k) ?? null, setItem: (k, val) => fresh.set(k, val), removeItem: (k) => fresh.delete(k) });
  });

  test("app namespaces isolate same-origin data; records never overwrite on id collision", () => {
    const raw = new Map();
    setStorage({ getItem: (k) => raw.get(k) ?? null, setItem: (k, val) => raw.set(k, val), removeItem: (k) => raw.delete(k) });
    setStorageNamespace("clinic");
    const patients = collection("patients");
    assert.ok(patients.put({ id: "PAT-0001", name: "Awa" }));
    let n = 0;
    const ids = ["PAT-0001", "PAT-0001", "PAT-0002"];
    const p = patients.insert(() => ids[n++], (id) => ({ id, name: "Ibrahima" }));
    assert.equal(p.id, "PAT-0002", "drew a new id instead of overwriting");
    assert.equal(patients.get("PAT-0001").name, "Awa");
    assert.ok([...raw.keys()].every((k) => k.startsWith("clinic:")), [...raw.keys()].join(" "));
    setStorageNamespace("tontine");
    assert.equal(collection("patients").list().length, 0, "another app sees nothing");
    setStorageNamespace("");
  });
});

describe("offline-to-cloud sync with ghostpacket-verifier", () => {
  const exe = join(here, "..", "..", "..", "crates", "ghostpacket-verifier", "target", "release", process.platform === "win32" ? "ghostpacket-verifier.exe" : "ghostpacket-verifier");
  const port = 18000 + Math.floor(Math.random() * 2000);
  const endpoint = `http://127.0.0.1:${port}`;
  let server;

  before(async (t) => {
    if (!existsSync(exe)) return;
    server = spawn(exe, ["serve", "--tofu", "--addr", `127.0.0.1:${port}`], { stdio: "ignore" });
    for (let i = 0; i < 50; i++) {
      try {
        if ((await fetch(`${endpoint}/v1/health`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 100));
    }
  });
  after(() => server?.kill());

  test("queue offline, sync, then a second device's copy is a 409 replay", { skip: !existsSync(exe) && "build crates/ghostpacket-verifier (cargo build --release) to run" }, async () => {
    gp.outbox.clear();
    const frame = gp.sealMessage({ sender: "Kaolack point 4", title: "Voucher AID-5531", message: "25 kg rice, 5 L oil" }).value.frame;
    const v = gp.verifyFrame(frame);
    gp.queueProof(frame, v.value, "light");
    gp.queueProof(frame, v.value, "light");
    assert.equal(gp.outbox.pending().length, 1, "same document queued once");

    const r1 = await gp.syncProofs(endpoint);
    assert.deepEqual([r1.sent, r1.synced, r1.replays], [1, 1, 0]);
    assert.equal(gp.outbox.list()[0].state, "synced");

    // Another offline device redeemed the same voucher: the server catches it.
    const device2 = await GhostPacketSDK.load();
    device2.outbox.clear();
    device2.queueProof(frame, v.value, "sound");
    const r2 = await device2.syncProofs(endpoint);
    assert.equal(r2.replays, 1);
    assert.equal(device2.outbox.list()[0].state, "replay");

    const tampered = frame.slice();
    tampered[30] ^= 4;
    const r3 = await (await fetch(`${endpoint}/v1/proofs`, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: tampered })).json();
    assert.equal(r3.code, "CRC32_MISMATCH", "the server re-verifies instead of trusting the device");
  });

  test("unreachable endpoint keeps items pending; bad URLs are refused", async () => {
    gp.outbox.clear();
    const frame = gp.sealMessage(MSG).value.frame;
    gp.queueProof(frame, gp.verifyFrame(frame).value);
    const r = await gp.syncProofs("http://127.0.0.1:1", { timeoutMs: 1500 });
    assert.ok(r.networkError);
    assert.equal(gp.outbox.pending().length, 1);
    assert.match((await gp.syncProofs("http://example.com/v1/proofs")).networkError, /https/);
  });
});
