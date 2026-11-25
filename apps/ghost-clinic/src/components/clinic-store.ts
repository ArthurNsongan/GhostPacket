// GhostClinic local data. Imported first by every clinic module: the storage
// namespace must be set before the SDK reads anything, so the clinic's ledger,
// outbox and records never mix with the portal's or the tontine's (same origin).
import { setStorageNamespace, readJson, writeJson } from "ghostpacket-sdk/storage";
import { collection, type RecordBase } from "ghostpacket-sdk/records";
import type { PrescriptionItem } from "ghostpacket-sdk/types";

setStorageNamespace("clinic");

export interface Patient extends RecordBase {
  name: string;
  age: number;
  sex: "F" | "M";
  village: string;
  allergies: string;
}

export interface IssuedRx extends RecordBase {
  patientId: string;
  docId: string;
  frameB64: string;
  frameLen: number;
  fingerprint: string;
  encrypted: boolean;
  items: PrescriptionItem[];
}

export interface ClinicSettings {
  clinic: string;
  practitioner: string;
}

export const patients = collection<Patient>("patients", 500);
export const prescriptions = collection<IssuedRx>("prescriptions", 300);

const SETTINGS = "ghostclinic.settings.v1";
const SEEDED = "ghostclinic.seeded.v1";

export function settings(): ClinicSettings {
  return readJson<ClinicSettings>(SETTINGS, { clinic: "Ndiob Rural Health Post, Fatick", practitioner: "Nurse Moussa Sarr" });
}

export function saveSettings(s: ClinicSettings): void {
  writeJson(SETTINGS, s);
}

/** Demo ward on first launch, so a judge sees records immediately. */
export function seedOnce(): void {
  if (readJson<boolean>(SEEDED, false)) return;
  writeJson(SEEDED, true);
  if (patients.list().length > 0) return;
  const demo: Omit<Patient, "createdAt" | "updatedAt">[] = [
    { id: "PAT-0815", name: "Awa Faye", age: 34, sex: "F", village: "Ndiob", allergies: "none known" },
    { id: "PAT-0816", name: "Ibrahima Sène", age: 7, sex: "M", village: "Diakhao", allergies: "penicillin" },
    { id: "PAT-0817", name: "Mariama Ba", age: 61, sex: "F", village: "Niakhar", allergies: "none known" },
  ];
  demo.reverse().forEach((p) => patients.put(p));
}

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}
