"use client";

import HighSpeedLab from "ghostpacket-ui/HighSpeedLab";

import { WithGhost } from "@/components/AppShell";
import DualCanvasWorkbench from "@/components/DualCanvasWorkbench";

export default function Page() {
  return (
    <WithGhost>
      {(g) => (
        <>
          <DualCanvasWorkbench ghost={g} />
          <HighSpeedLab ghost={g} variant="virtual" />
        </>
      )}
    </WithGhost>
  );
}