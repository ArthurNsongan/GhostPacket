// GhostTontine local data. Imported first by every tontine module: the storage
// namespace isolates the treasury from the portal and the clinic (same origin).
import { setStorageNamespace, readJson, writeJson } from "ghostpacket-sdk/storage";
import { collection, type RecordBase } from "ghostpacket-sdk/records";

setStorageNamespace("tontine");

export interface Member extends RecordBase {
  name: string;
  number: number;
  phone: string;
  /** Contribution per round, in XOF. */
  share: number;
}

export interface Issued extends RecordBase {
  kind: "receipt" | "voucher";
  memberId: string;
  docId: string;
  cycle: number;
  amount: number;
  frameB64: string;
  frameLen: number;
  fingerprint: string;
}

/** What a member's phone keeps after verifying a document (no frame, no free text). */
export interface WalletEntry extends RecordBase {
  kind: "receipt" | "voucher";
  docId: string;
  group: string;
  amount: number;
  cycle: number;
  fingerprint: string;
  validUntil?: number;
}

export interface Group {
  group: string;
  collector: string;
  currency: string;
  cycle: number;
}

export const members = collection<Member>("members", 200);
export const issued = collection<Issued>("issued", 500);
export const wallet = collection<WalletEntry>("wallet", 300);

const GROUP = "ghosttontine.group.v1";
const SEEDED = "ghosttontine.seeded.v1";

export function group(): Group {
  return readJson<Group>(GROUP, { group: "Médina Women’s Tontine, Dakar", collector: "Fatou Ndiaye, treasurer", currency: "XOF", cycle: 9 });
}

export function saveGroup(g: Group): void {
  writeJson(GROUP, g);
}

export function seedOnce(): void {
  if (readJson<boolean>(SEEDED, false)) return;
  writeJson(SEEDED, true);
  if (members.list().length > 0) return;
  const demo = [
    { id: "MBR-0017", name: "Aminata Diop", number: 17, phone: "77 412 33 08", share: 25_000 },
    { id: "MBR-0018", name: "Khady Sow", number: 18, phone: "76 220 81 45", share: 25_000 },
    { id: "MBR-0019", name: "Ndeye Fall", number: 19, phone: "78 903 12 77", share: 25_000 },
    { id: "MBR-0020", name: "Coumba Gueye", number: 20, phone: "77 655 40 19", share: 25_000 },
  ];
  demo.reverse().forEach((m) => members.put(m));
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

export function xof(n: number): string {
  return `${n.toLocaleString("en-US").replace(/,/g, " ")} XOF`;
}
