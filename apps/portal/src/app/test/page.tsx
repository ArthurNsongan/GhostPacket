"use client";
import { Panel } from "ghostpacket-ui/FormKit";
import HighSpeedLab from "ghostpacket-ui/HighSpeedLab";
import WhisperIdentity from "ghostpacket-ui/WhisperIdentity";
import { WithGhost } from "@/components/AppShell";
import FieldModeView from "@/components/FieldModeView";
export default function Page() {
  return (
    <WithGhost>
      {(g) => (
        <>
          <FieldModeView ghost={g} />
          <HighSpeedLab ghost={g} variant="field" />
          <Panel title="Ultrasonic Whisper · silent key exchange, PC ↔ phone">
            <WhisperIdentity ghost={g} label="Field issuer" variant="field" />
          </Panel>
        </>
      )}
    </WithGhost>
  );
}