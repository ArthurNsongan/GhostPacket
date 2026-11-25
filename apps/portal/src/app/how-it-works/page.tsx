import type { Metadata } from "next";

import HowItWorksView from "@/components/HowItWorksView";

export const metadata: Metadata = { title: "How it works · Security · SDK — GhostPacket" };

export default function Page() {
  return <HowItWorksView />;
}
