import Link from "next/link";

import { BUILD_INFO } from "@/lib/build-info";

const CASES = [
  {
    title: "Tontine receipts, Dakar",
    who: "Savings-group treasurer · Tilène Market",
    text: "Hands each member a signed contribution receipt at the market stall. No data plan, no shared Wi-Fi, no dispute over who paid.",
  },
  {
    title: "Rural clinic prescriptions",
    who: "Nurse · Ndiob health post",
    text: "Sends a verifiable, optionally encrypted prescription to the pharmacy next door. The pharmacist sees the issuer fingerprint and the dosage.",
  },
  {
    title: "Humanitarian aid vouchers",
    who: "Distributor · Kaolack flood response",
    text: "Issues tamper-proof vouchers offline. The anti-replay ledger refuses a voucher presented twice, so it cannot be redeemed twice.",
  },
];

const STATS = [
  { value: "≈ 1 ms", label: "sign a document (Ed25519, in the browser)" },
  { value: "0", label: "network calls at runtime" },
  { value: "50 %", label: "QR frames lost and still rebuilt" },
  { value: `${BUILD_INFO.wasmGzipKb} KB`, label: "Rust → WASM core, gzip" },
  { value: "±300 ppm", label: "clock drift + room echo survived over sound" },
  { value: `${BUILD_INFO.rustTests}`, label: "Rust tests incl. channel fuzzing" },
];

export default function HomeView() {
  return (
    <div className="flex flex-col gap-6">
      <section className="panel relative overflow-hidden px-6 py-10 sm:px-10 sm:py-14">
        <p className="panel-title">Kiroween 2026 · Frankenstein</p>
        <h1 className="display mt-3 max-w-4xl text-[clamp(2.4rem,5vw,4.2rem)] leading-[1.02] text-ink">
          Signed documents that cross the air <em className="text-phosphor glow">with no network at all</em>.
        </h1>
        <p className="mt-5 max-w-2xl text-base text-mist">
          GhostPacket seals a receipt, a prescription or any message into an Ed25519-signed frame of at most 512 bytes, then sends it from one device to another over{" "}
          <span className="text-phosphor">sound</span> (a 4-FSK modem) or <span className="text-ion">light</span> (fountain-coded QR codes). The receiver proves it is authentic, or rejects it with an exact reason.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/simulation/?run=1" className="cta-ember px-6 py-3 text-base font-bold">
            ▶ Launch the 20 s simulation
          </Link>
          <Link href="/test/" className="rounded-full px-6 py-3 text-base text-ink ring-1 ring-grid hover:ring-phosphor/50">
            Test PC ↔ Phone
          </Link>
          <Link href="/how-it-works/" className="rounded-full px-6 py-3 text-base text-mist hover:text-ink">
            How it works →
          </Link>
        </div>
        <p className="mt-4 font-mono text-[11px] text-mute">No microphone, no camera, no install. Works offline after the first visit.</p>
      </section>

      <section aria-labelledby="stats" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <h2 id="stats" className="sr-only">
          Measured performance
        </h2>
        {STATS.map((s) => (
          <div key={s.label} className="panel p-4">
            <div className="font-mono text-2xl text-phosphor">{s.value}</div>
            <div className="mt-1 text-[12px] text-mist">{s.label}</div>
          </div>
        ))}
      </section>

      <section aria-labelledby="cases">
        <h2 id="cases" className="display text-3xl text-ink">
          Where the network <em className="text-amber">gives up</em>
        </h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {CASES.map((c) => (
            <article key={c.title} className="panel p-5">
              <h3 className="text-lg font-semibold text-ink">{c.title}</h3>
              <p className="font-mono text-[11px] text-mute">{c.who}</p>
              <p className="mt-2 text-sm text-mist">{c.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <article className="panel p-5">
          <h2 className="display text-2xl text-ink">
            Cryptographic <em className="text-phosphor">armor</em>
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-mist">
            <li>
              <span className="text-ink">Integrity and authenticity:</span> CRC32 catches noise, Ed25519 (strict) catches forgery. Every single-bit flip of every frame is rejected in tests.
            </li>
            <li>
              <span className="text-ink">Optional end-to-end encryption:</span> ChaCha20-Poly1305 with a PBKDF2 passphrase, so a prescription played aloud in a waiting room stays private.
            </li>
            <li>
              <span className="text-ink">Anti-replay ledger and trusted keyring:</span> vouchers cannot be spent twice; unknown issuers are refused.
            </li>
            <li>
              <span className="text-ink">Zero exfiltration:</span> the signing key is born in the tab and never leaves it; no server exists.
            </li>
          </ul>
        </article>
        <article className="panel p-5">
          <h2 className="display text-2xl text-ink">
            Drop it into <em className="text-ion">your app</em>
          </h2>
          <p className="mt-3 text-sm text-mist">
            The <span className="font-mono text-ink">GhostPacketSDK</span> wraps the WASM core, Web Audio, the camera, the ledger and the keyring. Seal, send, receive and verify in a few lines, then sync the verified{" "}
            <span className="font-mono text-ink">.gpkt</span> proofs to your backend when connectivity returns.
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-grid bg-void/70 p-3 font-mono text-[12px] text-phosphor">{`const gp = await GhostPacketSDK.load();
const sealed = gp.sealMessage({ sender, title, message });
if (sealed.ok) await gp.transmitAcoustic(sealed.value.frame);`}</pre>
          <Link href="/how-it-works/#sdk" className="mt-3 inline-block text-sm text-ion hover:underline">
            Integration guide →
          </Link>
        </article>
      </section>
    </div>
  );
}
