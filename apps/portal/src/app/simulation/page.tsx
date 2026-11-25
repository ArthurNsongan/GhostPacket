"use client";

import { WithGhost } from "@/components/AppShell";
import DualCanvasWorkbench from "@/components/DualCanvasWorkbench";

export default function Page() {
  return <WithGhost>{(g) => <DualCanvasWorkbench ghost={g} />}</WithGhost>;
}
