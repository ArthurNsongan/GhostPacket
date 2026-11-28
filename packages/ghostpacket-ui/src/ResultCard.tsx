"use client";

import type { Result } from "ghostpacket-sdk/wasm-bridge";
import { useEffect, useState } from "react";

import { bloodMoon, spectral } from "ghostpacket-sdk/effects";
import type { LedgerCheck } from "ghostpacket-sdk/ledger";
import { ledgerTotal } from "ghostpacket-sdk/ledger-batch";
import { docTitle } from "ghostpacket-sdk/messages";
import type { DocumentBody, VerifiedFrame } from "ghostpacket-sdk/types";
import { currentTheme, onThemeChange, type Theme } from "ghostpacket-sdk/theme";
import { sfx } from "ghostpacket-sdk/ui-sfx";

/** Current Haunted / Clean Field theme, kept in sync with the header switch. */
function useHaunted(): boolean {
  const [theme, setThemeState] = useState<Theme>("haunted");
  useEffect(() => {
    setThemeState(currentTheme());
    return onThemeChange(setThemeState);
  }, []);
  return theme === "haunted";
}

/**
 * Rejection headline and the next thing to tap. Haunted Mode jokes; Clean
 * Field Mode stays sober for clinics and treasurers. The machine code above
 * the headline never changes.
 */
export function errorFlavor(code: string, haunted: boolean): { headline: string; nextTap: string } {
  switch (code) {
    case "CRC32_MISMATCH":
      return {
        headline: haunted ? "Nice try, poltergeist: that bit didn't belong here." : "Frame corrupted in transit (checksum mismatch).",
        nextTap: "Next: ask the sender to send it again, or tap ‘Restore intact frame’ in the tamper lab.",
      };
    case "INVALID_SIGNATURE":
      return {
        headline: haunted ? "Impostor ghost! That wax seal is a fake." : "Signature verification failed.",
        nextTap: "Next: request a frame signed by the real issuer, or tap ‘Restore intact frame’ in the tamper lab.",
      };
    case "UNTRUSTED_ISSUER":
      return {
        headline: haunted ? "Stranger danger in the graveyard: unknown signer." : "The signer is not in this device's trusted keyring.",
        nextTap: "Next: pin this issuer (identity QR or Ultrasonic Whisper), or turn off strict mode.",
      };
    case "PASSPHRASE_REQUIRED":
      return {
        headline: haunted ? "Sealed by a spell: this one only opens with a passphrase." : "The payload is encrypted.",
        nextTap: "Next: enter the passphrase the sender shared with you, then verify again.",
      };
    case "DECRYPTION_FAILED":
      return {
        headline: haunted ? "Wrong spell! The spirits won't whisper without the right passphrase." : "The payload cannot be decrypted with this passphrase.",
        nextTap: "Next: check the passphrase with the sender (same words, same spelling) and verify again.",
      };
    default:
      return {
        headline: haunted ? "Pure ectoplasm static: this frame is broken." : "Malformed frame.",
        nextTap: "Next: send or scan it again from the start, closer and with less noise.",
      };
  }
}

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

const MIME_TYPES = ["", "image/webp", "image/jpeg", "image/png"];

/** Image from a verified document: a local blob URL, revoked on unmount. */
export function SignedImage({ image, mime, alt }: { image: Uint8Array; mime: number; alt: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const type = MIME_TYPES[mime];
    if (!type) return;
    const u = URL.createObjectURL(new Blob([image.slice().buffer], { type }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [image, mime]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={alt} className="reveal max-h-80 w-auto rounded-md" /> : null;
}

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
          <Row k="Amount" v={<span className="font-mono text-ink">{amount(body.tontineReceipt.amountMinor, body.tontineReceipt.currency)}</span>} />
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
      {"ledgerBatchDelta" in body && (
        <>
          <Row k="Group" v={body.ledgerBatchDelta.group} />
          <Row k="Round" v={`#${body.ledgerBatchDelta.cycle} · ${body.ledgerBatchDelta.entries.length} contribution(s)`} />
          <Row
            k="Total"
            v={<span className="font-mono text-ink">{amount(ledgerTotal(body.ledgerBatchDelta.entries), body.ledgerBatchDelta.currency)}</span>}
          />
          <Row
            k="Entries"
            v={
              <ul className="max-h-40 overflow-y-auto font-mono text-[11px]">
                {body.ledgerBatchDelta.entries.map((e, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span>
                      {String.fromCharCode(...e.receiptId).trim()} · {e.member}
                    </span>
                    <span className="text-ink">{amount(e.amountMinor, body.ledgerBatchDelta.currency)}</span>
                  </li>
                ))}
              </ul>
            }
          />
          <Row k="Treasurer" v={body.ledgerBatchDelta.collector} />
          <Row k="Note" v={body.ledgerBatchDelta.note || "—"} />
        </>
      )}
      {"imageDocument" in body && (
        <>
          <Row k="Title" v={body.imageDocument.title} />
          <Row k="Subject" v={body.imageDocument.subjectRef} />
          {body.imageDocument.relatedDocId.some((b) => b !== 0) && (
            <Row k="Linked to" v={<span className="font-mono">{String.fromCharCode(...body.imageDocument.relatedDocId).trim()}</span>} />
          )}
          <Row k="Caption" v={body.imageDocument.caption || "—"} />
          <Row
            k="Image"
            v={
              <span className="font-mono text-[11px] text-mist">
                {body.imageDocument.width}×{body.imageDocument.height} · {(body.imageDocument.image.length / 1024).toFixed(1)} KB · {["", "WebP", "JPEG", "PNG"][body.imageDocument.mime] ?? "?"}
              </span>
            }
          />
          <div className="mt-2">
            <SignedImage image={body.imageDocument.image} mime={body.imageDocument.mime} alt={body.imageDocument.title} />
          </div>
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
  const color = broken ? "var(--color-alarm)" : "var(--color-phosphor)";
  return (
    <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden>
      {!broken && <span className="seal-ripple absolute inset-0 rounded-full border border-phosphor/60" />}
      <svg viewBox="0 0 48 48" className={`seal h-12 w-12 ${broken ? "" : "drop-shadow-[0_0_10px_color-mix(in_oklab,var(--color-phosphor)_45%,transparent)]"}`}>
        <polygon points="24,3 42,13.5 42,34.5 24,45 6,34.5 6,13.5" fill="none" stroke={color} strokeWidth="2" />
        <circle cx="24" cy="24" r="10" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray={broken ? "4 3" : undefined} />
        {broken ? (
          <path d="M22 4 L27 17 L20 25 L28 32 L23 45" fill="none" stroke="var(--color-void)" strokeWidth="3" />
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
  const haunted = useHaunted();
  const state = verification ? (verification.ok ? (replay?.status === "replay" ? "replay" : "ok") : "rejected") : null;
  useEffect(() => {
    if (silent || !state) return;
    if (state === "rejected") {
      bloodMoon();
      spectral("rejected");
      void sfx("rejected");
    } else if (state === "replay") {
      spectral("replay");
      void sfx("replay");
    } else {
      spectral("verified");
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
    const flavor = errorFlavor(verification.error.code, haunted);
    return (
      <div className="tampered flex gap-3 rounded-lg bg-alarm/10 p-4" role="alert">
        <Seal broken />
        <div>
          <div className="chroma font-mono text-sm font-bold tracking-widest text-alarm glow-alarm">REJECTED · {verification.error.code}</div>
          <p className="display text-lg italic text-ink/90">{flavor.headline}</p>
          <p className="mt-1 text-sm text-ink">{verification.error.message}</p>
          <p className="mt-2 rounded-md bg-ink/[0.05] px-2.5 py-1.5 text-[13px] text-ink">{flavor.nextTap}</p>
          <p className="mt-1 text-xs text-mute">Channel: {channel}. The document is not shown.</p>
        </div>
      </div>
    );
  }
  const v = verification.value;
  return (
    <div className="rounded-lg bg-phosphor-dim p-4" role="status">
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
        <div className="tampered mt-2 rounded-md bg-amber/10 px-3 py-2" role="alert">
          <p className="font-mono text-xs font-bold tracking-widest text-amber">REPLAY DETECTED · ALREADY REDEEMED</p>
          {haunted && <p className="display text-[15px] italic text-ink/90">Deja-boo! This document already walked out of the crypt once.</p>}
          <p className="text-[12px] text-ink">
            Same issuer and document id first redeemed via {replay.entry.channel} at {new Date(replay.entry.firstSeen).toLocaleTimeString("en-GB")}. A second presentation must be refused.
          </p>
          <p className="mt-1 text-[12px] text-mist">Next: refuse it, and ask the issuer for a new document if this one was lost. Duplicates are never paid twice.</p>
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
