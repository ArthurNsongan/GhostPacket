"use client";

import { useState } from "react";

import { WithGhost } from "./AppShell";
import GpktVerifier from "./GpktVerifier";

const PIPELINE = [
  { name: "Plaintext", detail: "receipt, prescription, voucher or free message", tone: "text-ink" },
  { name: "postcard + LZ4", detail: "compact binary, LZ4 only if it shrinks", tone: "text-amber" },
  { name: "Optional E2EE", detail: "ChaCha20-Poly1305 · PBKDF2-HMAC-SHA256 · fresh salt", tone: "text-ion" },
  { name: "CRC32 + Ed25519", detail: "checksum then strict signature over header, payload and CRC", tone: "text-phosphor" },
  { name: "4-FSK sound ∥ LT QR", detail: "Reed-Solomon modem or fountain-coded QR burst", tone: "text-ion" },
  { name: "Verified plaintext", detail: "or an exact rejection code", tone: "text-phosphor" },
];

const THREATS = [
  { threat: "Noise, scratch, missed frames", attack: "Bits flip in the air; QR frames are lost", defense: "Reed-Solomon (8 bytes/block), fountain code, CRC32", result: "Corrected, or CRC32_MISMATCH", test: "noise_fsk_fuzz, optical_fountain_fuzz" },
  { threat: "Tampering", attack: "Edit the amount and fix the CRC32", defense: "Ed25519 strict signature over header + payload + CRC32", result: "INVALID_SIGNATURE", test: "resigned_content_with_recomputed_crc_is_still_rejected" },
  { threat: "Forgery / key substitution", attack: "Re-sign the document with a rogue key", defense: "Issuer key inside the signed document + pinned keyring", result: "UNTRUSTED_ISSUER", test: "trusted_keyring_rejects_other_issuers" },
  { threat: "Eavesdropping", attack: "Record the sound or film the QR stream", defense: "Optional ChaCha20-Poly1305, key from a passphrase never sent", result: "PASSPHRASE_REQUIRED / DECRYPTION_FAILED", test: "encrypted_frame_hides_plaintext_and_needs_the_passphrase" },
  { threat: "Replay / double-spend", attack: "Present the same voucher twice", defense: "Crypt Ledger keyed by issuer + document id", result: "REPLAY DETECTED · ALREADY REDEEMED", test: "browser ledger (Simulation, Test)" },
  { threat: "Malicious input", attack: "LZ4 bomb, oversized frame, crafted droplets", defense: "Bounds checked before allocation, zero-panic Rust", result: "DECOMPRESSED_TOO_LARGE, FRAME_TOO_LARGE, DROPLET_*", test: "lz4_bomb_is_blocked_before_allocation, no-panic guard" },
  { threat: "Exfiltration", attack: "Steal the signing key or the document", defense: "Key generated in the tab, kept in RAM; no server, no network call", result: "Nothing to steal remotely", test: "kiroween-audit, headless Chrome (0 external requests)" },
  { threat: "Jamming one channel", attack: "Shout over the speaker or block the camera", defense: "Two independent channels in parallel (Chimera race)", result: "The surviving channel delivers", test: "Simulation → Chimera race" },
];

const SNIPPETS: Record<string, { lang: string; code: string }> = {
  "Vanilla JS / PWA": {
    lang: "ts",
    code: `// Copy web/src/lib/ and web/src/wasm/ into your app, and serve
// ghostpacket_core_bg.wasm from your own origin.
import { GhostPacketSDK, downloadFile } from "./lib/sdk";

const gp = await GhostPacketSDK.load();          // ephemeral Ed25519 key for this tab
console.log("My fingerprint:", gp.identity.fingerprint);

const sealed = gp.sealMessage(
  { sender: "Ndiob health post", title: "Rx #0815", message: "Artemether 4 tablets x2/day, 3 days" },
  { passphrase: sharedPassphrase },               // optional end-to-end encryption
);
if (!sealed.ok) throw new Error(sealed.error.code);

await gp.transmitAcoustic(sealed.value.frame);    // speaker, robust 4-FSK
// or: gp.transmitOptical(sealed.value.frame, canvas, abort.signal)
downloadFile(gp.exportGpktFile(sealed.value.frame, "rx-0815.gpkt"));`,
  },
  React: {
    lang: "tsx",
    code: `function Receiver({ gp }: { gp: GhostPacketSDK }) {
  const [text, setText] = useState("Listening…");
  useEffect(() => {
    let mic: MicReceiver | undefined;
    gp.receiveAcoustic({
      onFrame: (frame) => {
        const v = gp.verifyFrame(frame, { strictKeyring: true, ledger: "field", channel: "sound" });
        if (!v.ok) return setText(\`Rejected: \${v.error.code}\`);
        if (v.value.replay?.status === "replay") return setText("Already redeemed");
        const body = v.value.document.body;
        setText("customMessage" in body ? body.customMessage.message : "Verified document");
      },
    }).then((r) => (mic = r));
    return () => mic?.stop();
  }, [gp]);
  return <p>{text}</p>;
}`,
  },
  "Offline-to-cloud sync": {
    lang: "ts",
    code: `// Field device: keep verified proofs while offline…
const queue: string[] = JSON.parse(localStorage.getItem("gpkt-queue") ?? "[]");
function keep(frame: Uint8Array) {
  queue.push(btoa(String.fromCharCode(...frame)));
  localStorage.setItem("gpkt-queue", JSON.stringify(queue));
}
// …and hand them to your backend when the network returns.
window.addEventListener("online", async () => {
  for (const b64 of queue.splice(0)) {
    await fetch("/api/proofs", { method: "POST", body: b64 }); // your server
  }
  localStorage.setItem("gpkt-queue", "[]");
});
// Server: re-verify each proof with ghostpacket-core (Rust) before trusting it.`,
  },
  "Rust (ghostpacket-core)": {
    lang: "rust",
    code: `use ghostpacket_core::protocol::{decode_and_verify_frame_with, encode_frame_with, Encryption};
use ghostpacket_core::schema::{DocumentBody, DocumentDraft};

let draft = DocumentDraft {
    doc_id: *b"MSG-0042",
    timestamp: 1_793_448_000,
    body: DocumentBody::CustomMessage { sender: "Clinic".into(), title: "Rx".into(), message: "…".into() },
};
let frame = encode_frame_with(draft, &seed, 0, Some(Encryption { passphrase: b"pass", salt: &salt }))?;
let verified = decode_and_verify_frame_with(&frame.bytes, &[trusted_key], Some(b"pass"))?;`,
  },
};

const WIRE = [
  ["0", "4", "Sync", "47 50 4B 54 (\"GPKT\")"],
  ["4", "1", "Version", "0x01"],
  ["5", "1", "Flags", "b0 LZ4 · b1 FSK · b2 FOUNTAIN · b3 DEMO · b4 ENCRYPTED · b5–7 = 0"],
  ["6", "2", "Length N", "u16 BE, 1 ≤ N ≤ 436"],
  ["8", "N", "Payload", "postcard document, LZ4 if b0, [salt 16][ciphertext][tag 16] if b4"],
  ["8+N", "4", "CRC32", "IEEE, over bytes 0 .. 8+N"],
  ["12+N", "64", "Ed25519", "strict signature over bytes 0 .. 12+N"],
];

function Snippets() {
  const [tab, setTab] = useState(Object.keys(SNIPPETS)[0] as string);
  const [copied, setCopied] = useState(false);
  const s = SNIPPETS[tab];
  return (
    <div>
      <div className="flex flex-wrap gap-1" role="tablist">
        {Object.keys(SNIPPETS).map((k) => (
          <button key={k} role="tab" aria-selected={k === tab} onClick={() => setTab(k)} className={`rounded-full px-3 py-1 text-[12px] ${k === tab ? "bg-ion/15 text-ion ring-1 ring-ion/40" : "text-mist hover:text-ink"}`}>
            {k}
          </button>
        ))}
      </div>
      <div className="relative mt-2">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(s?.code ?? "");
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="absolute right-2 top-2 rounded-md border border-grid bg-panel px-2 py-0.5 font-mono text-[10px] text-mist hover:text-ink"
        >
          {copied ? "copied ✓" : "copy"}
        </button>
        <pre className="max-h-96 overflow-auto rounded-lg border border-grid bg-void/80 p-4 font-mono text-[12px] leading-relaxed text-ink">{s?.code}</pre>
      </div>
    </div>
  );
}

export default function HowItWorksView() {
  return (
    <div className="flex flex-col gap-6">
      <section className="panel p-6">
        <p className="panel-title">How it works</p>
        <h1 className="display mt-2 text-[clamp(2rem,4vw,3.2rem)] leading-tight text-ink">
          From plaintext to <em className="text-phosphor glow">verified plaintext</em>, through the air.
        </h1>
        <ol className="mt-6 grid gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="End-to-end pipeline">
          {PIPELINE.map((p, i) => (
            <li key={p.name} className="pipeline-step relative rounded-lg border border-grid bg-void/50 p-3" style={{ animationDelay: `${i * 0.45}s` }}>
              <span className="font-mono text-[10px] text-mute">0{i + 1}</span>
              <p className={`mt-1 font-semibold ${p.tone}`}>{p.name}</p>
              <p className="mt-1 text-[12px] text-mist">{p.detail}</p>
              {i < PIPELINE.length - 1 && <span className="absolute -right-2 top-1/2 hidden -translate-y-1/2 text-phosphor xl:block">›</span>}
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-mist">
          All cryptography, compression, DSP and coding run in a Rust crate compiled to WebAssembly. The page only moves samples and pixels: speaker, microphone, screen and camera.
        </p>
      </section>

      <section className="panel p-6" aria-labelledby="threats">
        <h2 id="threats" className="display text-3xl text-ink">
          Security architecture & <em className="text-alarm">threat model</em>
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-[13px]">
            <thead className="font-mono text-[10px] uppercase tracking-widest text-mute">
              <tr>
                <th className="py-2 pr-3">Threat</th>
                <th className="py-2 pr-3">Attack</th>
                <th className="py-2 pr-3">Defense</th>
                <th className="py-2 pr-3">Outcome</th>
                <th className="py-2">Proven by</th>
              </tr>
            </thead>
            <tbody>
              {THREATS.map((t) => (
                <tr key={t.threat} className="border-t border-grid align-top">
                  <td className="py-2 pr-3 font-semibold text-ink">{t.threat}</td>
                  <td className="py-2 pr-3 text-mist">{t.attack}</td>
                  <td className="py-2 pr-3 text-mist">{t.defense}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-phosphor">{t.result}</td>
                  <td className="py-2 font-mono text-[11px] text-mute">{t.test}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[12px] text-mist">
          Verification order (fails closed at the first broken layer): size → preamble → version and flags → length → CRC32 → decryption → bounded LZ4 → schema → keyring → strict Ed25519. Try it live in the Simulation tamper
          lab: click any byte of the frame.
        </p>
      </section>

      <section id="sdk" className="panel p-6" aria-labelledby="sdk-title">
        <h2 id="sdk-title" className="display text-3xl text-ink">
          Integrate in <em className="text-ion">your app</em>
        </h2>
        <p className="mt-2 max-w-3xl text-sm text-mist">
          <span className="font-mono text-ink">GhostPacketSDK</span> (<span className="font-mono">web/src/lib/sdk.ts</span>) exposes <span className="font-mono text-ink">sealMessage</span>,{" "}
          <span className="font-mono text-ink">verifyFrame</span>, <span className="font-mono text-ink">transmitAcoustic</span> / <span className="font-mono text-ink">receiveAcoustic</span>,{" "}
          <span className="font-mono text-ink">transmitOptical</span> / <span className="font-mono text-ink">receiveOptical</span> and <span className="font-mono text-ink">exportGpktFile</span> /{" "}
          <span className="font-mono text-ink">importGpktFile</span>.
        </p>
        <div className="mt-4">
          <Snippets />
        </div>
        <h3 className="panel-title mt-6">.gpkt wire format (a file is the raw frame)</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] font-mono text-[12px]">
            <thead className="text-[10px] uppercase tracking-widest text-mute">
              <tr>
                <th className="py-1 pr-3 text-left">Offset</th>
                <th className="py-1 pr-3 text-left">Size</th>
                <th className="py-1 pr-3 text-left">Field</th>
                <th className="py-1 text-left">Content</th>
              </tr>
            </thead>
            <tbody>
              {WIRE.map(([o, s, f, c]) => (
                <tr key={f} className="border-t border-grid">
                  <td className="py-1 pr-3 text-mute">{o}</td>
                  <td className="py-1 pr-3 text-mute">{s}</td>
                  <td className="py-1 pr-3 text-ink">{f}</td>
                  <td className="py-1 text-mist">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel p-6" aria-labelledby="verifier">
        <h2 id="verifier" className="display text-3xl text-ink">
          Verify a <em className="text-phosphor">.gpkt</em> proof
        </h2>
        <div className="mt-4">
          <WithGhost>{(g) => <GpktVerifier ghost={g} />}</WithGhost>
        </div>
      </section>
    </div>
  );
}
