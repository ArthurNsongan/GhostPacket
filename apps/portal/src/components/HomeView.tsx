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

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Two distinct apps built only from the shared skeleton (see .kiro/specs/v3-skeleton-crew). */
const APPS = [
  {
    href: `${BASE}/clinic/`,
    name: ["Ghost", "Clinic"],
    face: "The Apothecary's Ward",
    tone: "oklch(0.76 0.11 45)",
    text: "Patient records, signed and optionally encrypted prescriptions handed to the pharmacy phone, dispensed once.",
  },
  {
    href: `${BASE}/tontine/`,
    name: ["Ghost", "Tontine"],
    face: "The Midnight Vault",
    tone: "oklch(0.83 0.12 85)",
    text: "Members, contribution rounds, signed receipts in each member's wallet, single-use aid vouchers paid out once.",
  },
] as const;

const STATS = [
  { value: "≈ 1 ms", label: "to sign a document (Ed25519, in the browser)" },
  { value: "50 %", label: "of QR frames lost and still rebuilt" },
  { value: `${BUILD_INFO.wasmGzipKb} KB`, label: "Rust → WASM core, gzip" },
  { value: "±300 ppm", label: "clock drift and room echo survived over sound" },
];

const RECEIPT = [
  ["Member", "Aminata Diop · #17"],
  ["Group", "Médina Women's Tontine"],
  ["Cycle", "Round 9 · 31 Oct 2026"],
  ["Issuer", "GPKT-8436-0E7F"],
] as const;

const NUMERALS = ["i.", "ii.", "iii."];

export default function HomeView() {
  return (
    <div className="flex flex-col gap-16 pb-6">
      {/* Hero: editorial, open on the night sky rather than boxed. */}
      <section className="grid items-end gap-10 px-1 pt-10 sm:pt-16 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <p className="panel-title">Kiroween 2026 · Skeleton Crew</p>
          <h1 className="display mt-5 text-[clamp(2.8rem,6vw,5.4rem)] leading-[0.98] text-ink">
            Signed documents that cross the air{" "}
            <em className="text-accent">with no network at all.</em>
          </h1>
          <p className="mt-7 max-w-2xl text-[17px] leading-relaxed text-mist">
            GhostPacket seals a receipt, a prescription or any message into an
            Ed25519-signed frame of at most 512 bytes, then carries it from one
            device to another over <span className="text-ink">sound</span> (a
            4-FSK modem) or <span className="text-ink">light</span>{" "}
            (fountain-coded QR codes). The receiver proves it is authentic, or
            rejects it with an exact reason.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/simulation/?run=1"
              className="cta-ember px-7 py-3.5 text-[15px]"
            >
              Launch the 20 s simulation
            </Link>
            <Link href="/test/" className="btn-tonal px-6 py-3.5 text-[15px]">
              Test PC ↔ phone
            </Link>
            <Link
              href="/how-it-works/"
              className="px-4 py-3.5 text-[15px] text-mist transition-colors hover:text-ink"
            >
              How it works →
            </Link>
          </div>
          <p className="mt-5 text-[12px] text-mute">
            No microphone, no camera, no install. Works offline after the first
            visit.
          </p>
        </div>

        {/* A sealed document, as the receiver sees it. */}
        <div className="lg:col-span-4">
          <aside
            className="panel rise relative p-6"
            aria-label="Example of a verified receipt"
          >
            <div className="flex items-center justify-between">
              <p className="panel-title">Receipt · TNT-0842</p>
              <span className="rounded-full bg-phosphor/12 px-2.5 py-1 text-[11px] font-medium text-phosphor">
                Seal intact
              </span>
            </div>
            <p className="display mt-5 text-[2.6rem] leading-none text-ink">
              25 000 <em className="text-accent">XOF</em>
            </p>
            <dl className="mt-6 space-y-2.5 text-[13px]">
              {RECEIPT.map(([k, v]) => (
                <div
                  key={k}
                  className="flex justify-between gap-4 border-b border-grid pb-2.5 last:border-0"
                >
                  <dt className="text-mute">{k}</dt>
                  <dd
                    className={
                      k === "Issuer" ? "font-mono text-ion" : "text-ink"
                    }
                  >
                    {v}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 font-mono text-[11px] text-mute">
              296 B · LZ4 · CRC32 · Ed25519
            </p>
          </aside>
        </div>
      </section>

      {/* Bento: one skeleton, measured. */}
      <section aria-labelledby="skeleton" className="rise">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2
            id="skeleton"
            className="display text-[clamp(2rem,3.4vw,2.8rem)] leading-tight text-ink"
          >
            One skeleton, <em className="text-accent">three apps</em>
          </h2>
          <p className="max-w-xl text-sm text-mist">
            <span className="font-mono text-ink">ghostpacket-core</span> (Rust →
            WASM), <span className="font-mono text-ink">-sdk</span> and{" "}
            <span className="font-mono text-ink">-ui</span> power this portal
            and two separate offline apps. Each keeps its own records on the
            device; none contains crypto or DSP code of its own.
          </p>
        </div>

        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="panel flex flex-col justify-between gap-8 p-7 sm:col-span-2 lg:row-span-2">
            <p className="panel-title">At runtime</p>
            <div>
              <p className="display text-[clamp(6rem,12vw,10rem)] leading-[0.8] text-ink">
                0
              </p>
              <p className="mt-4 max-w-sm text-[17px] text-mist">
                network calls. The signing key is born in the tab and never
                leaves it;{" "}
                <span className="text-ink">
                  {BUILD_INFO.rustTests} Rust tests
                </span>
                , channel fuzzing included, guard the core.
              </p>
            </div>
          </div>
          {APPS.map((a) => (
            <a
              key={a.href}
              href={a.href}
              className="panel group flex flex-col justify-between gap-6 p-6 transition-colors hover:bg-panel-2 sm:col-span-2"
              style={{ "--color-accent": a.tone } as React.CSSProperties}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="display-gothic text-[1.9rem] leading-none text-ink">
                  {a.name[0]}
                  <em className="text-accent">{a.name[1]}</em>
                </span>
                <span className="text-[12px] text-mute">{a.face}</span>
              </div>
              <p className="text-sm text-mist">{a.text}</p>
              <span className="text-[13px] text-accent">
                Open {a.name.join("")}{" "}
                <span className="inline-block transition-transform group-hover:translate-x-1">
                  →
                </span>
              </span>
            </a>
          ))}
          {STATS.map((s) => (
            <div key={s.label} className="panel p-5">
              <div className="font-mono text-[1.7rem] font-medium tracking-tight text-ink">
                {s.value}
              </div>
              <div className="mt-2 text-[13px] leading-snug text-mist">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="cases" className="rise">
        <h2
          id="cases"
          className="display text-[clamp(2rem,3.4vw,2.8rem)] leading-tight text-ink"
        >
          Where the network <em className="text-accent">gives up</em>
        </h2>
        <div className="mt-7 grid gap-x-10 gap-y-8 border-t border-grid pt-8 md:grid-cols-3">
          {CASES.map((c, i) => (
            <article key={c.title}>
              <p className="display text-2xl italic text-accent">
                {NUMERALS[i]}
              </p>
              <h3 className="mt-3 text-lg font-medium text-ink">{c.title}</h3>
              <p className="mt-1 text-[12px] text-mute">{c.who}</p>
              <p className="mt-3 text-sm leading-relaxed text-mist">{c.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="rise grid gap-4 md:grid-cols-2">
        <article className="panel p-7">
          <h2 className="display text-[1.9rem] text-ink">
            Cryptographic <em className="text-accent">armor</em>
          </h2>
          <ul className="mt-5 space-y-3.5 text-sm leading-relaxed text-mist">
            <li>
              <span className="font-medium text-ink">
                Integrity and authenticity.
              </span>{" "}
              CRC32 catches noise, Ed25519 (strict) catches forgery. Every
              single-bit flip of every frame is rejected in tests.
            </li>
            <li>
              <span className="font-medium text-ink">
                Optional end-to-end encryption.
              </span>{" "}
              ChaCha20-Poly1305 with a PBKDF2 passphrase, so a prescription
              played aloud in a waiting room stays private.
            </li>
            <li>
              <span className="font-medium text-ink">
                Anti-replay ledger and trusted keyring.
              </span>{" "}
              Vouchers cannot be spent twice; unknown issuers are refused.
            </li>
            <li>
              <span className="font-medium text-ink">Zero exfiltration.</span>{" "}
              The signing key is born in the tab and never leaves it; no server
              exists.
            </li>
          </ul>
        </article>
        <article className="panel p-7">
          <h2 className="display text-[1.9rem] text-ink">
            Drop it into <em className="text-accent">your app</em>
          </h2>
          <p className="mt-5 text-sm leading-relaxed text-mist">
            The <span className="font-mono text-ink">GhostPacketSDK</span> wraps
            the WASM core, Web Audio, the camera, the ledger and the keyring.
            Seal, send, receive and verify in a few lines, then sync the
            verified <span className="font-mono text-ink">.gpkt</span> proofs to
            your backend when connectivity returns.
          </p>
          <pre className="mt-5 overflow-x-auto rounded-xl bg-void/70 p-4 font-mono text-[12px] leading-relaxed text-ink/90">{`const gp = await GhostPacketSDK.load();
const sealed = gp.sealMessage({ sender, title, message });
if (sealed.ok) await gp.transmitAcoustic(sealed.value.frame);`}</pre>
          <Link
            href="/how-it-works/#sdk"
            className="mt-5 inline-block text-sm text-accent hover:underline"
          >
            Integration guide →
          </Link>
        </article>
      </section>
    </div>
  );
}
