import type { Metadata } from "next";

import HomeView from "@/components/HomeView";

export const metadata: Metadata = { title: "GhostPacket — signed documents over sound and light" };

export default function Page() {
  return <HomeView />;
}
