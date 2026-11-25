"use client";

import { WithGhost } from "@/components/AppShell";
import FieldModeView from "@/components/FieldModeView";

export default function Page() {
  return <WithGhost>{(g) => <FieldModeView ghost={g} />}</WithGhost>;
}
