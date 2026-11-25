"use client";

import { WithGhost } from "ghostpacket-ui/GhostContext";

import TontineApp from "@/components/TontineApp";

export default function Page() {
  return <WithGhost>{(g) => <TontineApp ghost={g} />}</WithGhost>;
}
