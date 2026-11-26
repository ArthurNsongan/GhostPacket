"use client";
import { Panel } from "ghostpacket-ui/FormKit";
import HighSpeedLab from "ghostpacket-ui/HighSpeedLab";
import WhisperIdentity from "ghostpacket-ui/WhisperIdentity";
import { WithGhost } from "@/components/AppShell";
import DualCanvasWorkbench from "@/components/DualCanvasWorkbench";
export default function Page() {
  return (
    <WithGhost>
      {(g) => (
        <>
          <DualCanvasWorkbench ghost={g} />
          <HighSpeedLab ghost={g} variant="virtual" />
          <Panel title="Ultrasonic Whisper · silent key exchange">
            <WhisperIdentity ghost={g} label="Portal demo issuer" variant="virtual" />
          </Panel>
        </>
      )}
    </WithGhost>
  );
}