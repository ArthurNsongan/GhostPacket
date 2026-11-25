import type { Metadata, Viewport } from "next";
import "./globals.css";

import AppShell from "@/components/AppShell";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: { default: "GhostPacket — Spectral Signal Lab", template: "%s" },
  description:
    "Ed25519-signed documents sent 100% offline over sound (4-FSK modem) and light (fountain-coded QR). Rust → WebAssembly.",
  manifest: `${base}/manifest.json`,
  icons: { icon: `${base}/icon.svg` },
};

export const viewport: Viewport = {
  themeColor: "#07080B",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
