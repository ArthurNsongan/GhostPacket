"use client";

// A small ghost that tells a first-time visitor what to tap next. Haunted Mode
// only (hidden in Clean Field Mode and under reduced motion), placed beside
// the controls it points at, never over them; one click dismisses it for good.
import { useEffect, useState } from "react";

import { readJson, writeJson } from "ghostpacket-sdk/storage";

import { Ghostling } from "./GhostCrew";

const KEY = "ghostpacket.guide.dismissed.v1";

export default function GhostGuide({ id, children }: { id: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  // Read after mount: the static export renders without storage.
  useEffect(() => setOpen(!readJson<string[]>(KEY, []).includes(id)), [id]);
  if (!open) return null;
  const dismiss = () => {
    writeJson(KEY, [...readJson<string[]>(KEY, []), id].slice(-20));
    setOpen(false);
  };
  return (
    <div className="haunt-only guide-whisper mt-5 flex max-w-xl items-center gap-3 motion-reduce:hidden" role="note">
      <span className="shrink-0" aria-hidden>
        <Ghostling size={30} />
      </span>
      <p className="rounded-2xl rounded-tl-sm bg-ink/[0.06] px-4 py-2.5 text-[13px] leading-snug text-ink">
        {children}{" "}
        <button type="button" onClick={dismiss} className="ml-1 text-[12px] text-mute underline-offset-2 hover:text-ink hover:underline" aria-label="Dismiss the ghost guide">
          got it
        </button>
      </p>
    </div>
  );
}
