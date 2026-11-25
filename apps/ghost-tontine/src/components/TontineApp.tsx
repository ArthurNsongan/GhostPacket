"use client";

import "./tontine-store";

import { useEffect, useMemo, useState } from "react";

import { findRedemption, guardScope, redeem, redeemOnce, type LedgerCheck } from "ghostpacket-sdk/ledger";
import { issuerPinned, redemptionGate } from "ghostpacket-sdk/redemption-policy";
import { docIdBytes, freeId, shortId } from "ghostpacket-sdk/records";
import { FLAG_FOUNTAIN, FLAG_FSK, type Channel, type DocumentDraft, type FskMode, type VerifiedFrame } from "ghostpacket-sdk/types";
import type { Result } from "ghostpacket-sdk/wasm-bridge";
import { AirReceiver, AirSender, VirtualHandover } from "ghostpacket-ui/AirTransfer";
import CryptLedger from "ghostpacket-ui/CryptLedger";
import { Hero, NumberField, Panel, Stat, TabBar, TextField } from "ghostpacket-ui/FormKit";
import type { GhostState } from "ghostpacket-ui/GhostContext";
import { IdentityQr } from "ghostpacket-ui/IdentityCard";
import IssuerGate from "ghostpacket-ui/IssuerGate";
import ProofOutboxPanel from "ghostpacket-ui/ProofOutboxPanel";
import ResultCard from "ghostpacket-ui/ResultCard";

import { fromB64, group as readGroup, issued as issuedStore, members, saveGroup, seedOnce, toB64, wallet, xof, type Group, type Issued, type Member } from "./tontine-store";

type Tab = "round" | "voucher" | "wallet" | "sync";
const FIELD = 64;
const NOTE = 120;
const FLAGS = FLAG_FSK | FLAG_FOUNTAIN;
const DAY = 86_400;
/** Pay-out desk ledger: append-only, fails closed. */
const PAID_OUT = "vouchers";
guardScope(PAID_OUT);

interface Received {
  frame: Uint8Array;
  channel: Channel;
  v: Result<VerifiedFrame>;
  check: LedgerCheck | null;
  refused?: string;
  seq: number;
}

function useLive<T>(read: () => T, subscribe: (fn: () => void) => () => void): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    return subscribe(() => setValue(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

export default function TontineApp({ ghost }: { ghost: GhostState }) {
  const { core, seed, keyInfo, sdk } = ghost;
  useState(() => seedOnce());
  const roster = useLive(() => [...members.list()].sort((a, b) => a.number - b.number), members.onChange);
  const issued = useLive(() => issuedStore.list(), issuedStore.onChange);
  const purse = useLive(() => wallet.list(), wallet.onChange);
  const initial = useMemo(() => readGroup(), []);
  const [g, setG] = useState<Group>(initial);
  useEffect(() => saveGroup(g), [g]);

  const [tab, setTab] = useState<Tab>("round");
  const [mode, setMode] = useState<FskMode>("robust");
  const [current, setCurrent] = useState<Issued | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [received, setReceived] = useState<Received | null>(null);
  const [seq, setSeq] = useState(0);

  // Voucher form.
  const [vMember, setVMember] = useState("");
  const [vAmount, setVAmount] = useState(15_000);
  const [vReason, setVReason] = useState("Solidarity fund: child's hospital fees. Single use.");

  const paidThisRound = issued.filter((i) => i.kind === "receipt" && i.cycle === g.cycle);
  const pot = paidThisRound.reduce((s, i) => s + i.amount, 0);
  const beneficiary = roster.length ? roster[(g.cycle - 1) % roster.length] : undefined;

  const seal = (kind: Issued["kind"], member: Member, amount: number, draftBody: DocumentDraft["body"], idPrefix: string) => {
    setError(null);
    const docId = freeId(() => shortId(idPrefix, 8 - idPrefix.length - 1), (id) => !!issuedStore.get(id));
    if (!docId) return setError("No free document id: archive old documents");
    const draft: DocumentDraft = { docId: docIdBytes(docId), timestamp: Math.floor(Date.now() / 1000), body: draftBody };
    const enc = core.encode(draft, seed, FLAGS);
    if (!enc.ok) {
      setError(`${enc.error.code}: ${enc.error.message}`);
      return;
    }
    const rec = { id: docId, kind, memberId: member.id, docId, cycle: g.cycle, amount, frameB64: toB64(enc.value.frame), frameLen: enc.value.frameLen, fingerprint: enc.value.fingerprint };
    if (!issuedStore.put(rec)) return setError("Ledger full (500 documents)");
    setCurrent(issuedStore.get(docId) ?? null);
  };

  const recordContribution = (m: Member) =>
    seal(
      "receipt",
      m,
      m.share,
      {
        tontineReceipt: {
          group: g.group.trim(),
          member: `${m.name} (member #${m.number})`,
          collector: g.collector.trim(),
          amountMinor: m.share,
          currency: g.currency,
          cycle: g.cycle,
          note: `Contribution for round ${g.cycle} received in cash.`,
        },
      },
      "TNT",
    );

  const issueVoucher = () => {
    const m = roster.find((x) => x.id === vMember) ?? roster[0];
    if (!m) return;
    seal(
      "voucher",
      m,
      vAmount,
      {
        emergencyVoucher: {
          program: `${g.group.trim()} solidarity fund`.slice(0, FIELD),
          distributor: g.collector.trim(),
          beneficiaryRef: `${m.id} (member #${m.number})`,
          items: [{ label: "Cash aid from the solidarity fund", quantity: vAmount, unit: g.currency }],
          validUntil: Math.floor(Date.now() / 1000) + 14 * DAY,
          note: vReason.trim(),
        },
      },
      "AID",
    );
  };

  // ---- member phone ------------------------------------------------------------
  const receive = (frame: Uint8Array, channel: Channel) => {
    // Signature check first (TOFU); the wallet and the pay-out desk only accept a pinned treasurer (redemptionGate).
    const v = core.verify(frame, []);
    let check: LedgerCheck | null = null;
    let refused: string | undefined;
    if (v.ok) {
      const body = v.value.document.body;
      const docId = String.fromCharCode(...v.value.document.docId).trim();
      const key = `${v.value.fingerprint}/${docId}/${v.value.document.timestamp}`;
      if ("tontineReceipt" in body && redemptionGate(v.value, { kind: "tontineReceipt", selfKeyHex: keyInfo.publicKeyHex }).ok) {
        const known = findRedemption("receipts", v.value);
        // Wallet first, then the ledger: a full wallet must not mark the receipt as seen.
        if (!known && !wallet.put({ id: key, kind: "receipt", docId, group: body.tontineReceipt.group, amount: body.tontineReceipt.amountMinor, cycle: body.tontineReceipt.cycle, fingerprint: v.value.fingerprint })) {
          refused = "Wallet full (300 documents)";
        } else {
          check = redeem("receipts", v.value, channel);
          if (check.status === "first" && !sdk.queueProof(frame, v.value, channel)) refused = "Outbox full: sync soon";
        }
      } else if ("emergencyVoucher" in body) {
        const used = findRedemption(PAID_OUT, v.value);
        check = used ? { status: "replay", entry: used } : null;
        // Only cash in the group currency counts towards the amount.
        const amount = body.emergencyVoucher.items.filter((i) => i.unit === g.currency).reduce((s, i) => s + i.quantity, 0);
        // Kept in the wallet (expired ones too, shown as such) once the issuer is pinned; payment is the desk's decision.
        if (issuerPinned(v.value, keyInfo.publicKeyHex)) {
          wallet.put({ id: key, kind: "voucher", docId, group: body.emergencyVoucher.program, amount, cycle: 0, fingerprint: v.value.fingerprint, validUntil: body.emergencyVoucher.validUntil });
        }
      }
    }
    const n = seq + 1;
    setSeq(n);
    setReceived({ frame, channel, v, check, refused, seq: n });
    setTab("wallet");
  };

  const redeemVoucher = () => {
    // Re-checked here (pinned issuer, type, DEMO flag, expiry, future timestamp), not only by the disabled button.
    if (!received?.v.ok || !redemptionGate(received.v.value, { kind: "emergencyVoucher", selfKeyHex: keyInfo.publicKeyHex }).ok) return;
    const out = redeemOnce(PAID_OUT, received.v.value, received.channel);
    const n = seq + 1;
    setSeq(n);
    if (out.status === "unavailable") return setReceived({ ...received, refused: `${out.code}: ${out.message}`, seq: n });
    // The proof uploaded later is "this voucher was paid out here".
    const queued = out.status !== "first" || sdk.queueProof(received.frame, received.v.value, received.channel);
    setReceived({ ...received, check: out, refused: queued ? undefined : "Outbox full: sync before the next pay-out", seq: n });
  };

  const isVoucher = received?.v.ok && "emergencyVoucher" in received.v.value.document.body;
  const gate = received?.v.ok ? redemptionGate(received.v.value, { kind: isVoucher ? "emergencyVoucher" : "tontineReceipt", selfKeyHex: keyInfo.publicKeyHex }) : null;
  const gateLabel = received?.v.ok ? ("tontineReceipt" in received.v.value.document.body ? received.v.value.document.body.tontineReceipt.collector : "emergencyVoucher" in received.v.value.document.body ? received.v.value.document.body.emergencyVoucher.distributor : "Issuer") : "Issuer";
  const currentFrame = current ? fromB64(current.frameB64) : null;
  const currentMember = current ? roster.find((m) => m.id === current.memberId) : undefined;

  const handover = (
    <Panel title="Hand over to the member's phone" aside={<ModeSelect mode={mode} onChange={setMode} />}>
      {current && currentFrame ? (
        <>
          <p className="font-mono text-xs text-ink">
            {current.kind === "receipt" ? "Receipt" : "Aid voucher"} {current.docId} · {currentMember?.name ?? current.memberId} · {xof(current.amount)} · {current.frameLen} B · {current.fingerprint}
          </p>
          <VirtualHandover ghost={ghost} frame={currentFrame} onFrame={receive} label="Hand over to the member (virtual, 30 % QR loss)" />
          <p className="text-[12px] text-mist">Several members at once: the sound burst reaches every phone in the room that listens in the “Member wallet” tab.</p>
          <AirSender ghost={ghost} frame={currentFrame} mode={mode} caption={`GhostTontine ${current.docId}`} />
        </>
      ) : (
        <p className="font-mono text-xs text-mute">Record a contribution or issue a voucher first.</p>
      )}
      {error && <p className="font-mono text-xs text-alarm">{error}</p>}
    </Panel>
  );

  return (
    <div className="flex flex-col gap-4">
      <Hero kicker="GhostTontine · The Midnight Vault · offline" title="A savings-group treasury that keeps its word" accent="with no network.">
        The treasurer records each contribution and hands the member a signed receipt over sound or light. One-time aid vouchers from the solidarity fund cannot be redeemed twice, even offline. Everything syncs to a verifier
        later, where a voucher redeemed on two phones is caught.
      </Hero>

      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "round", label: `Round ${g.cycle} · contributions`, badge: roster.length - new Set(paidThisRound.map((i) => i.memberId)).size },
          { id: "voucher", label: "Aid voucher" },
          { id: "wallet", label: "Receive · wallet & pay-out desk", badge: purse.length },
          { id: "sync", label: "Sync" },
        ]}
      />

      {tab === "round" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={`Round ${g.cycle}`} aside={<span className="font-mono text-[11px] text-mute">signed by {keyInfo.fingerprint}</span>}>
            <div className="grid grid-cols-3 gap-2">
              <Stat value={`${new Set(paidThisRound.map((i) => i.memberId)).size}/${roster.length}`} label="members paid" />
              <Stat value={xof(pot)} label="pot this round" tone="text-accent" />
              <Stat value={beneficiary?.name ?? "…"} label="receives the pot" tone="text-ion" />
            </div>
            <ul className="divide-y divide-grid">
              {roster.map((m) => {
                const paid = paidThisRound.find((i) => i.memberId === m.id);
                return (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="text-ink">
                        #{m.number} {m.name}
                      </span>{" "}
                      <span className="font-mono text-[11px] text-mute">
                        {m.id} · {xof(m.share)}
                      </span>
                    </span>
                    {paid ? (
                      <button type="button" onClick={() => setCurrent(paid)} className="rounded-full bg-phosphor/15 px-2 py-0.5 font-mono text-[10px] text-phosphor">
                        PAID · {paid.docId}
                      </button>
                    ) : (
                      <button type="button" onClick={() => recordContribution(m)} className="rounded-md px-2 py-1 text-[12px] text-accent ring-1 ring-accent hover:bg-accent-soft">
                        Record contribution
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            <button type="button" onClick={() => setG({ ...g, cycle: g.cycle + 1 })} className="self-start font-mono text-[11px] text-mist hover:text-ink">
              close round {g.cycle} → open round {g.cycle + 1}
            </button>
          </Panel>
          <div className="flex flex-col gap-4">
            {handover}
            <NewMember next={roster.reduce((n, m) => Math.max(n, m.number), 0) + 1} />
            <Panel title="Group">
              <TextField label="Group" value={g.group} max={FIELD} onChange={(group) => setG({ ...g, group })} />
              <TextField label="Treasurer" value={g.collector} max={FIELD} onChange={(collector) => setG({ ...g, collector })} />
              <IdentityQr keyInfo={keyInfo} />
            </Panel>
          </div>
        </div>
      )}

      {tab === "voucher" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="One-time aid voucher · solidarity fund">
            <label className="block text-[12px] text-mist">
              Member
              <select value={vMember || roster[0]?.id || ""} onChange={(e) => setVMember(e.target.value)} className="mt-1 w-full rounded-md border border-grid bg-void px-2 py-1.5 text-sm text-ink">
                {roster.map((m) => (
                  <option key={m.id} value={m.id}>
                    #{m.number} {m.name}
                  </option>
                ))}
              </select>
            </label>
            <NumberField label="Amount" value={vAmount} min={500} max={1_000_000} step={500} onChange={setVAmount} suffix={g.currency} />
            <TextField label="Reason" value={vReason} max={NOTE} onChange={setVReason} />
            <button type="button" onClick={issueVoucher} disabled={!roster.length || new TextEncoder().encode(vReason).length > NOTE} className="rounded-lg bg-accent-soft px-4 py-2.5 text-sm font-semibold text-accent ring-1 ring-accent disabled:opacity-40">
              Sign the voucher (valid 14 days, single use)
            </button>
            <ul className="max-h-40 overflow-y-auto border-t border-grid pt-2 font-mono text-[11px] text-mist">
              {issued
                .filter((i) => i.kind === "voucher")
                .slice(0, 10)
                .map((i) => (
                  <li key={i.id}>
                    <button type="button" className="hover:text-ink" onClick={() => setCurrent(i)}>
                      {i.docId} · {roster.find((m) => m.id === i.memberId)?.name ?? i.memberId} · {xof(i.amount)}
                    </button>
                  </li>
                ))}
            </ul>
          </Panel>
          {handover}
        </div>
      )}

      {tab === "wallet" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Receive · member wallet or pay-out desk" aside={<ModeSelect mode={mode} onChange={setMode} />}>
            <AirReceiver ghost={ghost} mode={mode} onFrame={receive} />
            <h3 className="panel-title mt-2">Wallet on this phone</h3>
            {purse.length === 0 ? (
              <p className="font-mono text-[11px] text-mute">No receipt yet.</p>
            ) : (
              <ul className="divide-y divide-grid font-mono text-[11px]">
                {purse.map((w) => (
                  <li key={w.id} className="flex justify-between gap-2 py-1.5">
                    <span className="text-ink">
                      {w.kind === "receipt" ? `Receipt · round ${w.cycle}` : "Aid voucher"} · {w.docId}
                      {w.validUntil !== undefined && w.validUntil < Date.now() / 1000 ? <span className="text-alarm"> · expired</span> : null}
                    </span>
                    <span className={w.kind === "receipt" ? "text-phosphor" : "text-accent"}>{xof(w.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Verdict">
            <ResultCard key={received?.seq ?? 0} verification={received?.v ?? null} channel={received ? (received.channel === "sound" ? "microphone" : "camera") : "microphone or camera"} replay={received?.check} />
            {received?.v.ok && gate && !gate.ok && <IssuerGate gate={gate} verified={received.v.value} label={gateLabel} onPinned={() => receive(received.frame, received.channel)} />}
            {received?.refused && <p className="rounded-lg border border-alarm/60 bg-alarm/10 p-2 font-mono text-[11px] text-alarm">{received.refused}</p>}
            {isVoucher && gate?.ok && (
              <button
                type="button"
                onClick={redeemVoucher}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold ring-1 disabled:opacity-40 ${received?.check?.status === "replay" ? "bg-alarm/15 text-alarm ring-alarm/50" : "bg-accent-soft text-accent ring-accent"}`}
              >
                {received?.check?.status === "replay"
                  ? `Already redeemed ${new Date(received.check.entry.firstSeen).toLocaleString()}: refuse`
                  : received?.check?.status === "first"
                    ? "Redeemed ✓ (press again to test a second presentation)"
                    : "Redeem the voucher (pay-out desk)"}
              </button>
            )}
            <CryptLedger
              scope={PAID_OUT}
              note="Pay-out desk ledger (the treasurer's or merchant's device, never the beneficiary's): append-only, the same voucher presented again is refused even offline. Only the verifier catches a voucher paid out on two devices."
            />
          </Panel>
        </div>
      )}

      {tab === "sync" && <ProofOutboxPanel ghost={ghost} />}
    </div>
  );
}

function ModeSelect({ mode, onChange }: { mode: FskMode; onChange: (m: FskMode) => void }) {
  return (
    <select value={mode} onChange={(e) => onChange(e.target.value as FskMode)} className="rounded-md border border-grid bg-void px-2 py-1 font-mono text-[11px]" aria-label="Modem mode">
      <option value="robust">sound: robust</option>
      <option value="fast">sound: fast</option>
    </select>
  );
}

function NewMember({ next }: { next: number }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [share, setShare] = useState(25_000);
  const add = () => {
    if (members.insert(() => shortId("MBR"), (id) => ({ id, name: name.trim(), number: next, phone: phone.trim(), share }))) {
      setName("");
      setPhone("");
    }
  };
  return (
    <Panel title="Add a member">
      <TextField label="Name" value={name} max={40} onChange={setName} />
      <div className="grid grid-cols-2 gap-2">
        <TextField label="Phone (stays on this device)" value={phone} onChange={setPhone} />
        <NumberField label="Share per round" value={share} min={500} max={1_000_000} step={500} onChange={setShare} suffix="XOF" />
      </div>
      <button type="button" onClick={add} disabled={!name.trim()} className="rounded-lg px-3 py-2 text-sm text-accent ring-1 ring-accent hover:bg-accent-soft disabled:opacity-40">
        Add member #{next}
      </button>
    </Panel>
  );
}
