import { join } from "node:path";

import type { NextConfig } from "next";

// Static export: the whole app (HTML, JS, WASM) is served from one origin,
// with no server code and no runtime network dependency (US-04).
// The skeleton packages ship TypeScript source and are compiled by Next.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  transpilePackages: ["ghostpacket-sdk", "ghostpacket-ui"],
  turbopack: { root: join(process.cwd(), "..", "..") },
};

export default nextConfig;
