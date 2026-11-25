import type { Metadata, Viewport } from "next";
import "./globals.css";

import { themeBootScript } from "ghostpacket-sdk/theme";

import TontineShell from "@/components/TontineShell";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "GhostTontine — The Midnight Vault",
  description: "Offline savings-group treasury: Ed25519-signed contribution receipts and one-time aid vouchers over sound or light, with anti-replay. Built on the GhostPacket skeleton.",
  manifest: `${base}/manifest.json`,
  icons: { icon: `${base}/icon.svg` },
};

export const viewport: Viewport = { themeColor: "#120e16", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-app="tontine" data-theme="haunted" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript("tontine") }} />
      </head>
      <body className="font-sans antialiased">
        <TontineShell>{children}</TontineShell>
      </body>
    </html>
  );
}
