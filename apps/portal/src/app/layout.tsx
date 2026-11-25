import type { Metadata, Viewport } from "next";
import "./globals.css";

import { themeBootScript } from "ghostpacket-sdk/theme";

import AppShell from "@/components/AppShell";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "GhostPacket — The Haunted Telegraph", template: "%s" },
  description:
    "Ed25519-signed documents sent 100% offline over sound (4-FSK modem) and light (fountain-coded QR). Rust → WebAssembly. One skeleton, several apps.",
  manifest: `${base}/manifest.json`,
  icons: { icon: `${base}/icon.svg` },
};

export const viewport: Viewport = {
  themeColor: "#06050A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The boot script sets data-theme from local storage before first paint.
    <html lang="en" data-app="portal" data-theme="haunted" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript("portal") }} />
      </head>
      <body className="font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
