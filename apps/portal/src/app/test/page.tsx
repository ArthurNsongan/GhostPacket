"use client";

import HighSpeedLab from "ghostpacket-ui/HighSpeedLab";

import { WithGhost } from "@/components/AppShell";
import FieldModeView from "@/components/FieldModeView";

export default function Page() {
  return (
    <WithGhost>
      {(g) => (
        <>
          <FieldModeView ghost={g} />
          <HighSpeedLab ghost={g} variant="field" />
        </>
      )}
    </WithGhost>
  );
}