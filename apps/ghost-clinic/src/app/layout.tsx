import type { Metadata, Viewport } from "next";
import "./globals.css";

import { themeBootScript } from "ghostpacket-sdk/theme";

import ClinicShell from "@/components/ClinicShell";

const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "GhostClinic — The Apothecary's Ward",
  description: "Offline rural clinic: patient records and Ed25519-signed prescriptions handed to the pharmacy over sound or light. Built on the GhostPacket skeleton.",
  manifest: `${base}/manifest.json`,
  icons: { icon: `${base}/icon.svg` },
};

export const viewport: Viewport = { themeColor: "#120e16", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-app="clinic" data-theme="haunted" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript("clinic") }} />
      </head>
      <body className="font-sans antialiased">
        <ClinicShell>{children}</ClinicShell>
      </body>
    </html>
  );
}
