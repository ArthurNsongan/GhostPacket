"use client";

import { WithGhost } from "ghostpacket-ui/GhostContext";

import ClinicApp from "@/components/ClinicApp";

export default function Page() {
  return <WithGhost>{(g) => <ClinicApp ghost={g} />}</WithGhost>;
}
