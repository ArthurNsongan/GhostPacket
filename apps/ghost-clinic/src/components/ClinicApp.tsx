"use client";

import "./clinic-store";

import { useEffect, useMemo, useState } from "react";

import { findRedemption, guardScope, onLedgerChange, readLedger, redeemOnce, type LedgerCheck } from "ghostpacket-sdk/ledger";
import { issuerPinned, redemptionGate } from "ghostpacket-sdk/redemption-policy";
import { docIdBytes, freeId, shortId } from "ghostpacket-sdk/records";
import { FLAG_FOUNTAIN, FLAG_FSK, type Channel, type DocumentDraft, type FskMode, type PrescriptionItem, type VerifiedFrame } from "ghostpacket-sdk/types";
import type { Result } from "ghostpacket-sdk/wasm-bridge";
import { AirReceiver, AirSender, VirtualHandover } from "ghostpacket-ui/AirTransfer";
import CryptLedger from "ghostpacket-ui/CryptLedger";
import { Hero, NumberField, Panel, Stat, TabBar, TextField } from "ghostpacket-ui/FormKit";
import type { GhostState } from "ghostpacket-ui/GhostContext";
import { IdentityQr } from "ghostpacket-ui/IdentityCard";
import IssuerGate from "ghostpacket-ui/IssuerGate";
import { EncryptionToggle, encryptionBlocked, type EncryptionSetting } from "ghostpacket-ui/MessageComposer";
import ProofOutboxPanel from "ghostpacket-ui/ProofOutboxPanel";
import ResultCard from "ghostpacket-ui/ResultCard";
import ImageAttach, { type ImageSource } from "ghostpacket-ui/ImageAttach";
import SpectralImageReveal from "ghostpacket-ui/SpectralImageReveal";
import type { ImageBudget } from "ghostpacket-sdk/image-codec";

import { fromB64, patients, prescriptions, saveSettings, seedOnce, settings, toB64, type IssuedRx, type Patient } from "./clinic-store";

type Tab = "ward" | "prescribe" | "pharmacy" | "sync";
const FIELD = 64;
const NOTE = 120;
const MAX_ITEMS = 8;
/** Real prescriptions: no DEMO flag. */
const FLAGS = FLAG_FSK | FLAG_FOUNTAIN;
/** Dispensing log: append-only, fails closed. */
const DISPENSED = "dispensed";
guardScope(DISPENSED);

interface Received {
  frame: Uint8Array;
  channel: Channel;
  v: Result<VerifiedFrame>;
  dispensed: LedgerCheck | null;
  /** Ledger refused to record (full or write failed): do not dispense. */
  refused?: string;
  seq: number;
}

function useCollection<T>(read: () => T, subscribe: (fn: () => void) => () => void): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    setValue(read());
    return subscribe(() => setValue(read()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return value;
}

export default function ClinicApp({ ghost }: { ghost: GhostState }) {
  const { core, seed, keyInfo, sdk } = ghost;
  useState(() => seedOnce());
  const ward = useCollection(() => patients.list(), patients.onChange);
  const issued = useCollection(() => prescriptions.list(), prescriptions.onChange);
  const [tab, setTab] = useState<Tab>("ward");
  const [mode, setMode] = useState<FskMode>("robust");

  // Prescription being written.
  const [patientId, setPatientId] = useState<string>("");
  const [items, setItems] = useState<PrescriptionItem[]>([{ drug: "Artemether-lumefantrine 20/120", dosage: "4 tablets morning and evening", days: 3 }]);
  const [note, setNote] = useState("Malaria RDT positive. Return if vomiting.");
  const [encryption, setEncryption] = useState<EncryptionSetting>({ on: false, passphrase: "" });
  const [sealed, setSealed] = useState<IssuedRx | null>(null);
  const [sealError, setSealError] = useState<string | null>(null);
  // Clinical photo attached to the prescription (GPKT v2, ChromaCrypt / OFDM).
  const [photoSrc, setPhotoSrc] = useState<{ source: ImageSource; budget: ImageBudget } | null>(null);
  const [photoCaption, setPhotoCaption] = useState("Malaria RDT, two lines");
  const [photo, setPhoto] = useState<{ frame: Uint8Array; docId: string; rx: string; encrypted: boolean } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<boolean[]>([]);

  // Pharmacy side.
  const [passphrase, setPassphrase] = useState("");
  const [received, setReceived] = useState<Received | null>(null);
  const [seq, setSeq] = useState(0);
  const [pins, setPins] = useState(0);

  const conf = useMemo(() => settings(), []);
  const [clinic, setClinic] = useState(conf.clinic);
  const [practitioner, setPractitioner] = useState(conf.practitioner);
  useEffect(() => saveSettings({ clinic, practitioner }), [clinic, practitioner]);

  const patient = ward.find((p) => p.id === patientId) ?? ward[0];
  const dispensedCount = useCollection(() => readLedger("dispensed").length, onLedgerChange);

  // ---- prescribe -----------------------------------------------------------
  const seal = () => {
    if (!patient) return;
    setSealError(null);
    // RX-XXXXX: 8 ASCII bytes; drawn again if this clinic already used it.
    const docId = freeId(() => shortId("RX", 5), (id) => !!prescriptions.get(id));
    if (!docId) return setSealError("No free prescription id: archive old prescriptions");
    const draft: DocumentDraft = {
      docId: docIdBytes(docId),
      timestamp: Math.floor(Date.now() / 1000),
      body: {
        medicalPrescription: {
          clinic: clinic.trim(),
          practitioner: practitioner.trim(),
          // Signed reference only: the patient's name never leaves the ward.
          patientRef: `${patient.id} (${patient.sex}, ${patient.age} y)`,
          items: items.filter((i) => i.drug.trim()).map((i) => ({ drug: i.drug.trim(), dosage: i.dosage.trim(), days: i.days })),
          note: note.trim(),
        },
      },
    };
    const pass = encryption.on ? encryption.passphrase : undefined;
    const enc = core.encode(draft, seed, FLAGS, pass);
    if (!enc.ok) return setSealError(`${enc.error.code}: ${enc.error.message}`);
    const rx: Omit<IssuedRx, "createdAt" | "updatedAt"> = {
      id: docId,
      patientId: patient.id,
      docId,
      frameB64: toB64(enc.value.frame),
      frameLen: enc.value.frameLen,
      fingerprint: enc.value.fingerprint,
      encrypted: enc.value.encrypted,
      items: draft.body && "medicalPrescription" in draft.body ? draft.body.medicalPrescription.items : [],
    };
    if (!prescriptions.put(rx)) return setSealError("Prescription log full (300): sync and archive first");
    setSealed(prescriptions.get(docId) ?? null);
  };

  const sealPhoto = async () => {
    if (!photoSrc || !sealed || !patient) return;
    setPhotoBusy(true);
    setPhotoError(null);
    const docId = `IMG-${sealed.docId.slice(3, 7)}`;
    const res = await sdk.sealImage(
      photoSrc.source,
      { title: "Clinical photo", subjectRef: `${patient.id} (${patient.sex}, ${patient.age} y)`, caption: photoCaption.trim(), relatedDocId: docIdBytes(sealed.docId), docId: docIdBytes(docId) },
      { budget: photoSrc.budget, passphrase: encryption.on ? encryption.passphrase : undefined },
    );
    setPhotoBusy(false);
    if (!res.ok) return setPhotoError(`${res.error.code}: ${res.error.message}`);
    setPhoto({ frame: res.value.frame, docId, rx: sealed.docId, encrypted: res.value.encrypted });
  };

  // ---- pharmacy ------------------------------------------------------------
  const receive = (frame: Uint8Array, channel: Channel, phrase = passphrase) => {
    setReveal([]);
    // Signature check first (TOFU); who may be dispensed is decided by redemptionGate below.
    const v = core.verify(frame, [], phrase || undefined);
    const dispensed = v.ok ? findRedemption(DISPENSED, v.value) : null;
    const n = seq + 1;
    setSeq(n);
    setReceived({ frame, channel, v, dispensed: dispensed ? { status: "replay", entry: dispensed } : null, seq: n });
    setTab("pharmacy");
  };

  const dispense = () => {
    if (!received?.v.ok || !redemptionGate(received.v.value, { kind: "medicalPrescription", selfKeyHex: keyInfo.publicKeyHex }).ok) return;
    const out = redeemOnce(DISPENSED, received.v.value, received.channel);
    const n = seq + 1;
    setSeq(n);
    if (out.status === "unavailable") return setReceived({ ...received, refused: `${out.code}: ${out.message}`, seq: n });
    // The proof uploaded later is "this prescription was dispensed here".
    if (out.status === "first" && !sdk.queueProof(received.frame, received.v.value, received.channel)) {
      setReceived({ ...received, dispensed: out, refused: "Outbox full: sync before the next prescription", seq: n });
      return;
    }
    setReceived({ ...received, dispensed: out, refused: undefined, seq: n });
  };
  // Photos are attachments: verified and shown, never "dispensed".
  const receivedPhoto = received?.v.ok && "imageDocument" in received.v.value.document.body ? received.v.value.document.body.imageDocument : null;
  // The relatedDocId is only a claim: it links to a prescription only if the issuer is trusted here.
  const photoPinned = received?.v.ok && receivedPhoto ? issuerPinned(received.v.value, keyInfo.publicKeyHex) : false;
  const gate = received?.v.ok && !receivedPhoto ? redemptionGate(received.v.value, { kind: "medicalPrescription", selfKeyHex: keyInfo.publicKeyHex }) : null;
  void pins;

  const locked = received && !received.v.ok && ["PASSPHRASE_REQUIRED", "DECRYPTION_FAILED"].includes(received.v.error.code);
  const sealedFrame = sealed ? fromB64(sealed.frameB64) : null;
  const tooLong = [clinic, practitioner, ...items.flatMap((i) => [i.drug, i.dosage])].some((s) => new TextEncoder().encode(s).length > FIELD) || new TextEncoder().encode(note).length > NOTE;

  return (
    <div className="flex flex-col gap-4">
      <Hero kicker="GhostClinic · The Apothecary's Ward · offline" title="Prescriptions that walk to the pharmacy" accent="without a network.">
        Patient records stay on this device. A prescription is signed with Ed25519 (optionally encrypted), then handed to the pharmacy phone over sound or a QR stream. The pharmacy verifies it offline, dispenses once, and
        refuses a second presentation. Proofs sync to a verifier later.
      </Hero>

      <TabBar
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "ward", label: "Ward", badge: ward.length },
          { id: "prescribe", label: "Prescribe & hand over" },
          { id: "pharmacy", label: "Pharmacy · receive & dispense" },
          { id: "sync", label: "Sync" },
        ]}
      />

      {tab === "ward" && (
        <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <Panel title="Patients on this device">
            <div className="grid grid-cols-3 gap-2">
              <Stat value={ward.length} label="patients" />
              <Stat value={issued.length} label="prescriptions signed" tone="text-accent" />
              <Stat value={dispensedCount} label="dispensed at this pharmacy" tone="text-ion" />
            </div>
            <ul className="divide-y divide-grid">
              {ward.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    <span className="text-ink">{p.name}</span>{" "}
                    <span className="font-mono text-[11px] text-mute">
                      {p.id} · {p.sex}, {p.age} y · {p.village} · allergies: {p.allergies || "none known"}
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <span className="font-mono text-[11px] text-mute">{issued.filter((r) => r.patientId === p.id).length} Rx</span>
                    <button
                      type="button"
                      onClick={() => {
                        setPatientId(p.id);
                        setSealed(null);
                        setTab("prescribe");
                      }}
                      className="btn-accent px-3 py-1 text-[12px]"
                    >
                      Prescribe
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
          <div className="flex flex-col gap-4">
            <NewPatient />
            <Panel title="This clinic">
              <TextField label="Clinic" value={clinic} onChange={setClinic} max={FIELD} />
              <TextField label="Practitioner" value={practitioner} onChange={setPractitioner} max={FIELD} />
              <p className="text-[12px] text-mist">The pharmacy can scan this identity QR once to pin the clinic&apos;s key.</p>
              <IdentityQr keyInfo={keyInfo} />
            </Panel>
          </div>
        </div>
      )}

      {tab === "prescribe" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="New prescription" aside={<span className="font-mono text-[11px] text-mute">signed by {keyInfo.fingerprint}</span>}>
            <label className="block text-[12px] text-mist">
              Patient
              <select value={patient?.id ?? ""} onChange={(e) => setPatientId(e.target.value)} className="mt-1 w-full rounded-md bg-panel-2 px-2 py-1.5 text-sm text-ink">
                {ward.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.id}
                  </option>
                ))}
              </select>
            </label>
            {patient && (
              <p className="font-mono text-[11px] text-mute">
                Signed reference: {patient.id} ({patient.sex}, {patient.age} y) · allergies: <span className={patient.allergies && patient.allergies !== "none known" ? "text-alarm" : ""}>{patient.allergies || "none known"}</span>
              </p>
            )}
            {items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_84px_28px] items-end gap-2">
                <TextField label={`Drug ${i + 1}`} value={it.drug} max={FIELD} onChange={(drug) => setItems(items.map((x, j) => (j === i ? { ...x, drug } : x)))} />
                <TextField label="Dosage" value={it.dosage} max={FIELD} onChange={(dosage) => setItems(items.map((x, j) => (j === i ? { ...x, dosage } : x)))} />
                <NumberField label="Days" value={it.days} min={1} max={90} onChange={(days) => setItems(items.map((x, j) => (j === i ? { ...x, days } : x)))} />
                <button type="button" aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))} disabled={items.length === 1} className="mb-1 text-mute hover:text-alarm disabled:opacity-30">
                  ×
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setItems([...items, { drug: "", dosage: "", days: 1 }])} disabled={items.length >= MAX_ITEMS} className="self-start font-mono text-[11px] text-accent disabled:opacity-40">
              + add a drug ({items.length}/{MAX_ITEMS})
            </button>
            <TextField label="Note" value={note} onChange={setNote} max={NOTE} />
            <EncryptionToggle value={encryption} onChange={setEncryption} limits={core.limits} />
            <button
              type="button"
              onClick={seal}
              disabled={!patient || tooLong || encryptionBlocked(encryption) || !items.some((i) => i.drug.trim())}
              className="btn-accent px-5 py-2.5 text-sm"
            >
              Sign the prescription
            </button>
            {sealError && <p className="font-mono text-xs text-alarm">{sealError}</p>}
          </Panel>

          <Panel title="Hand over to the pharmacy" aside={<ModeSelect mode={mode} onChange={setMode} />}>
            {sealed && sealedFrame ? (
              <>
                <p className="font-mono text-xs text-ink">
                  {sealed.docId} · {sealed.frameLen} B{sealed.encrypted ? " · E2EE" : ""} · {sealed.items.length} drug(s) · {sealed.fingerprint}
                </p>
                <VirtualHandover ghost={ghost} frame={sealedFrame} onFrame={(f, c) => receive(f, c, encryption.on ? encryption.passphrase : passphrase)} label="Hand over to the pharmacy (virtual, 30 % QR loss)" />
                <p className="text-[12px] text-mist">Two real devices: open GhostClinic on the pharmacy phone, choose “Pharmacy”, then send from here.</p>
                {!sealed.encrypted && (
                  <p className="rounded-md bg-amber/10 p-2 text-[12px] text-amber">
                    Not encrypted: anyone in the waiting room can capture the drugs and the note. Turn on end-to-end encryption for sensitive prescriptions (the patient name is never in the frame).
                  </p>
                )}
                <AirSender ghost={ghost} frame={sealedFrame} mode={mode} caption={`GhostClinic ${sealed.docId}`} />
              </>
            ) : (
              <p className="font-mono text-xs text-mute">Sign a prescription first.</p>
            )}
            {issued.length > 0 && (
              <ul className="max-h-40 overflow-y-auto border-t border-grid pt-2 font-mono text-[11px] text-mist">
                {issued.slice(0, 12).map((r) => (
                  <li key={r.id}>
                    <button type="button" className="hover:text-ink" onClick={() => setSealed(r)}>
                      {r.docId} · {r.patientId} · {r.items.length} drug(s){r.encrypted ? " · E2EE" : ""} · {new Date(r.createdAt).toLocaleString()}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Attach a clinical photo · GPKT v2" className="lg:col-span-2">
            <p className="text-[12px] text-mist">
              A rapid-test strip or a wound photo, re-encoded on this device, signed with the same key and linked to the prescription. Too big for a QR burst: it travels as ChromaCrypt color matrices (≈ 525 B per image, 15 per second) or as an
              OFDM chord.
            </p>
            {sealed ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <ImageAttach onChange={(source, budget) => setPhotoSrc(source ? { source, budget } : null)} disabled={photoBusy} />
                  <TextField label="Caption" value={photoCaption} onChange={setPhotoCaption} max={NOTE} />
                  <button type="button" onClick={() => void sealPhoto()} disabled={!photoSrc || photoBusy || encryptionBlocked(encryption)} className="btn-accent self-start px-5 py-2 text-sm">
                    {photoBusy ? "Signing…" : `Sign the photo for ${sealed.docId}`}
                  </button>
                  {photoError && <p className="font-mono text-xs text-alarm">{photoError}</p>}
                </div>
                <div className="flex flex-col gap-3">
                  {photo ? (
                    <>
                      <p className="font-mono text-xs text-ink">
                        {photo.docId} → {photo.rx} · {(photo.frame.length / 1024).toFixed(1)} KB GPKT v2{photo.encrypted ? " · E2EE" : ""}
                      </p>
                      <VirtualHandover
                        ghost={ghost}
                        frame={photo.frame}
                        transport="chroma"
                        onPartial={setReveal}
                        onFrame={(f, c) => receive(f, c, encryption.on ? encryption.passphrase : passphrase)}
                        label="Hand over the photo (virtual ChromaCrypt, 30 % loss)"
                      />
                      <AirSender ghost={ghost} frame={photo.frame} mode={mode} caption={`GhostClinic ${photo.docId}`} />
                    </>
                  ) : (
                    <p className="font-mono text-xs text-mute">Choose a photo (or the sample), then sign it.</p>
                  )}
                </div>
              </div>
            ) : (
              <p className="font-mono text-xs text-mute">Sign a prescription first: the photo is linked to it.</p>
            )}
          </Panel>
        </div>
      )}

      {tab === "pharmacy" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Receive a prescription or a photo" aside={<ModeSelect mode={mode} onChange={setMode} />}>
            <AirReceiver ghost={ghost} mode={mode} onFrame={(f, c) => receive(f, c)} onPartial={setReveal} />
            {reveal.length > 0 && !reveal.every(Boolean) && <SpectralImageReveal decoded={reveal} label="A large frame is arriving: each block burns through the fog" />}
            <TextField label="Passphrase for encrypted prescriptions (optional)" value={passphrase} onChange={setPassphrase} mono />
            {locked && received && (
              <button type="button" onClick={() => receive(received.frame, received.channel)} disabled={!passphrase} className="rounded-lg bg-ion/90 px-3 py-2 text-sm font-semibold text-void disabled:opacity-40">
                Unlock with this passphrase
              </button>
            )}
          </Panel>
          <Panel title="Verdict · dispense once">
            <ResultCard key={received?.seq ?? 0} verification={received?.v ?? null} channel={received ? (received.channel === "sound" ? "microphone" : "camera") : "microphone or camera"} replay={received?.dispensed} />
            {received?.v.ok && gate && !gate.ok && (
              <IssuerGate gate={gate} verified={received.v.value} label={"medicalPrescription" in received.v.value.document.body ? received.v.value.document.body.medicalPrescription.clinic : "Issuer"} onPinned={() => setPins((p) => p + 1)} />
            )}
            {received?.refused && <p className="rounded-lg bg-alarm/10 p-2 font-mono text-[11px] text-alarm">{received.refused}</p>}
            {receivedPhoto &&
              (photoPinned ? (
                <p className="rounded-lg bg-phosphor/10 p-2 text-[12px] text-phosphor">
                  Signed attachment for {String.fromCharCode(...receivedPhoto.relatedDocId).trim() || "a prescription"}: shown after Ed25519 verification, nothing to dispense.
                </p>
              ) : (
                <p className="rounded-lg bg-ink/[0.045] p-2 text-[12px] text-mist">
                  Unlinked attachment: the signature is valid, but issuer {received?.v.ok ? received.v.value.fingerprint : ""} is not pinned on this device, so its claim to belong to{" "}
                  {String.fromCharCode(...receivedPhoto.relatedDocId).trim() || "a prescription"} is not trusted. Pin the clinic&apos;s key first.
                </p>
              ))}
            {received?.v.ok && gate?.ok && (
              <button
                type="button"
                onClick={dispense}
                className={`rounded-lg px-4 py-2.5 text-sm font-semibold ${received.dispensed?.status === "replay" ? "bg-alarm/15 text-alarm" : "bg-accent-soft text-accent"}`}
              >
                {received.dispensed?.status === "replay"
                  ? `Already dispensed ${new Date(received.dispensed.entry.firstSeen).toLocaleString()}: refuse`
                  : received.dispensed?.status === "first"
                    ? "Dispensed ✓ (press again to test a second presentation)"
                    : "Dispense the medicines"}
              </button>
            )}
            <CryptLedger scope={DISPENSED} note="Dispensing log on this device: a prescription presented a second time is refused, even offline." />
          </Panel>
        </div>
      )}

      {tab === "sync" && <ProofOutboxPanel ghost={ghost} />}
    </div>
  );
}

function ModeSelect({ mode, onChange }: { mode: FskMode; onChange: (m: FskMode) => void }) {
  return (
    <select value={mode} onChange={(e) => onChange(e.target.value as FskMode)} className="rounded-md bg-panel-2 px-2 py-1 font-mono text-[11px]" aria-label="Modem mode">
      <option value="robust">sound: robust</option>
      <option value="fast">sound: fast</option>
    </select>
  );
}

function NewPatient() {
  const [name, setName] = useState("");
  const [age, setAge] = useState(30);
  const [sex, setSex] = useState<"F" | "M">("F");
  const [village, setVillage] = useState("");
  const [allergies, setAllergies] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const add = () => {
    const p = patients.insert(() => shortId("PAT"), (id) => ({ id, name: name.trim(), age, sex, village: village.trim(), allergies: allergies.trim() }) as Omit<Patient, "createdAt" | "updatedAt">);
    setMsg(p ? `${p.id} added` : "Ward full (500 records)");
    if (p) {
      setName("");
      setVillage("");
      setAllergies("");
    }
  };
  return (
    <Panel title="Admit a patient">
      <TextField label="Name (stays on this device)" value={name} onChange={setName} />
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Age" value={age} min={0} max={120} onChange={setAge} suffix="y" />
        <label className="block text-[12px] text-mist">
          Sex
          <select value={sex} onChange={(e) => setSex(e.target.value as "F" | "M")} className="mt-1 w-full rounded-md bg-panel-2 px-2 py-1.5 text-sm text-ink">
            <option value="F">F</option>
            <option value="M">M</option>
          </select>
        </label>
      </div>
      <TextField label="Village" value={village} onChange={setVillage} />
      <TextField label="Allergies" value={allergies} onChange={setAllergies} placeholder="none known" />
      <button type="button" onClick={add} disabled={!name.trim()} className="btn-accent px-4 py-2 text-sm">
        Admit
      </button>
      {msg && <p className="font-mono text-[11px] text-mute">{msg}</p>}
    </Panel>
  );
}
