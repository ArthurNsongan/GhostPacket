"use client";

import type { Result } from "ghostpacket-sdk/wasm-bridge";
import { useEffect } from "react";

import { bloodMoon } from "ghostpacket-sdk/effects";
import type { LedgerCheck } from "ghostpacket-sdk/ledger";
import { docTitle } from "ghostpacket-sdk/messages";
import type { DocumentBody, VerifiedFrame } from "ghostpacket-sdk/types";
import { sfx } from "ghostpacket-sdk/ui-sfx";

function amount(minor: number, currency: string): string {
  const decimals = ["XOF", "XAF", "JPY", "GNF", "RWF"].includes(currency) ? 0 : 2;
  const value = minor / 10 ** decimals;
  return `${value.toLocaleString("en-GB", { minimumFractionDigits: decimals })} ${currency}`;
}

function date(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-0.5 text-[13px]">
      <dt className="text-mute">{k}</dt>
      <dd className="text-ink">{v}</dd>
    </div>
  );
}

export { docTitle };

/** Human view of a document body. */
export function DocumentView({ body, docId, timestamp }: { body: DocumentBody; docId: number[]; timestamp: number }) {
  const id = String.fromCharCode(...docId).trim();
  return (
    <dl>
      <Row k="Document" v={<span className="font-mono">{id}</span>} />
      <Row k="Issued" v={date(timestamp)} />
      {"tontineReceipt" in body && (
        <>
          <Row k="Group" v={body.tontineReceipt.group} />
          <Row k="Member" v={body.tontineReceipt.member} />
          <Row k="Amount" v={<span className="font-mono text-phosphor">{amount(body.tontineReceipt.amountMinor, body.tontineReceipt.currency)}</span>} />
          <Row k="Cycle" v={`#${body.tontineReceipt.cycle}`} />
          <Row k="Collector" v={body.tontineReceipt.collector} />
          <Row k="Note" v={body.tontineReceipt.note} />
        </>
      )}
      {"medicalPrescription" in body && (
        <>
          <Row k="Facility" v={body.medicalPrescription.clinic} />
          <Row k="Prescriber" v={body.medicalPrescription.practitioner} />
          <Row k="Patient" v={body.medicalPrescription.patientRef} />
          <Row
            k="Treatment"
            v={
              <ul className="list-inside list-disc">
                {body.medicalPrescription.items.map((it, i) => (
                  <li key={i}>
                    {it.drug} — {it.dosage}, {it.days} d
                  </li>
                ))}
              </ul>
            }
          />
          <Row k="Note" v={body.medicalPrescription.note} />
        </>
      )}
      {"customMessage" in body && (
        <>
          <Row k="From" v={body.customMessage.sender || "—"} />
          <Row k="Title" v={body.customMessage.title || "—"} />
        </>
      )}
      {"emergencyVoucher" in body && (
        <>
          <Row k="Program" v={body.emergencyVoucher.program} />
          <Row k="Distributor" v={body.emergencyVoucher.distributor} />
          <Row k="Beneficiary" v={body.emergencyVoucher.beneficiaryRef} />
          <Row
            k="Allocation"
            v={
              <ul className="list-inside list-disc">
                {body.emergencyVoucher.items.map((it, i) => (
                  <li key={i}>
                    {it.quantity} {it.unit} · {it.label}
                  </li>
                ))}
              </ul>
            }
          />
          <Row k="Valid until" v={date(body.emergencyVoucher.validUntil)} />
          <Row k="Note" v={body.emergencyVoucher.note} />
        </>
      )}
    </dl>
  );
}

/** Minimal geometric seal: stamped when intact, cracked when broken. */
function Seal({ broken = false }: { broken?: boolean }) {
  const color = broken ? "#F43F5E" : "#5EF2C6";
  return (
    <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden>
      {!broken && <span className="seal-ripple absolute inset-0 rounded-full border border-phosphor/60" />}
      <svg viewBox="0 0 48 48" className={`seal h-12 w-12 ${broken ? "" : "drop-shadow-[0_0_8px_rgba(94,242,198,0.6)]"}`}>
        <polygon points="24,3 42,13.5 42,34.5 24,45 6,34.5 6,13.5" fill="none" stroke={color} strokeWidth="2" />
        <circle cx="24" cy="24" r="10" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={broken ? "4 3" : undefined} />
        {broken ? (
          <path d="M22 4 L27 17 L20 25 L28 32 L23 45" fill="none" stroke="#07080B" strokeWidth="3" />
        ) : (
          <path d="M18.5 24.5 L22.5 28.5 L30 20" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
    </span>
  );
}

/** Verification verdict: ED25519 VERIFIED or REJECTED with the stable code. */
export default function ResultCard({
  verification,
  channel,
  detail,
  replay,
  issuerLabel,
  silent,
}: {
  verification: Result<VerifiedFrame> | null;
  channel: string;
  detail?: string;
  /** Anti-replay ledger outcome for this delivery. */
  replay?: LedgerCheck | null;
  /** Keyring label of the issuer, if pinned. */
  issuerLabel?: string | null;
  /** No Blood Moon / sound (e.g. intermediate states). */
  silent?: boolean;
}) {
  const state = verification ? (verification.ok ? (replay?.status === "replay" ? "replay" : "ok") : "rejected") : null;
  useEffect(() => {
    if (silent || !state) return;
    if (state === "rejected") {
      bloodMoon();
      void sfx("rejected");
    } else if (state === "replay") {
      void sfx("rejected");
    } else {
      void sfx("verified");
    }
  }, [state, silent]);
  if (!verification) {
    return (
      <div className="rounded-lg border border-dashed border-grid p-4 text-sm text-mute">
        Waiting for a frame over {channel}…
      </div>
    );
  }
  if (!verification.ok) {
    return (
      <div className="tampered flex gap-3 rounded-lg border border-alarm/70 bg-alarm/10 p-4" role="alert">
        <Seal broken />
        <div>
          <div className="chroma font-mono text-sm font-bold tracking-widest text-alarm glow-alarm">REJECTED · {verification.error.code}</div>
          <p className="display text-lg italic text-ink/90">Corrupted spirit rejected</p>
          <p className="mt-1 text-sm text-ink">{verification.error.message}</p>
          <p className="mt-1 text-xs text-mute">Channel: {channel}. The document is not shown.</p>
        </div>
      </div>
    );
  }
  const v = verification.value;
  return (
    <div className="rounded-lg border border-phosphor/60 bg-phosphor-dim p-4" role="status">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-3">
          <Seal />
          <span>
            <span className="block font-mono text-sm font-bold tracking-widest text-phosphor glow">ED25519 VERIFIED</span>
            <span className="display block text-lg italic text-ink/90">Cryptographic seal intact</span>
          </span>
        </span>
        <span className="font-mono text-[11px] text-mute">
          {channel} · {v.frameLen} B · CRC32 {v.crc32.toString(16).toUpperCase().padStart(8, "0")}
        </span>
      </div>
      <p className="mt-1 font-mono text-[11px] text-ion">
        Issuer {v.fingerprint} {issuerLabel ? `· ${issuerLabel}` : ""} {v.trustedIssuer ? "· in keyring" : "· first contact (TOFU)"}
        {v.encrypted && <span className="ml-2 rounded bg-ion/15 px-1.5 py-0.5 text-ion">E2EE · decrypted on this device</span>}
      </p>
      {replay?.status === "replay" && (
        <div className="tampered mt-2 rounded-md border border-amber/60 bg-amber/10 px-3 py-2" role="alert">
          <p className="font-mono text-xs font-bold tracking-widest text-amber">REPLAY DETECTED · ALREADY REDEEMED</p>
          <p className="text-[12px] text-ink">
            Same issuer and document id first redeemed via {replay.entry.channel} at {new Date(replay.entry.firstSeen).toLocaleTimeString("en-GB")}. A second presentation must be refused.
          </p>
        </div>
      )}
      {replay?.status === "first" && <p className="font-mono text-[11px] text-phosphor">First redemption · recorded in the Crypt Ledger</p>}
      {detail && <p className="font-mono text-[11px] text-mute">{detail}</p>}
      <h3 className="mt-3 text-sm font-semibold text-ink">{docTitle(v.document.body)}</h3>
      {"customMessage" in v.document.body && (
        <blockquote className="reveal mt-2 whitespace-pre-wrap rounded-md border-l-2 border-phosphor bg-void/60 px-3 py-2 text-[15px] leading-relaxed text-ink">
          {v.document.body.customMessage.message}
        </blockquote>
      )}
      <div className="mt-1">
        <DocumentView body={v.document.body} docId={v.document.docId} timestamp={v.document.timestamp} />
      </div>
    </div>
  );
}
