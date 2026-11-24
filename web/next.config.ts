import type { NextConfig } from "next";

// Static export: the whole app (HTML, JS, WASM) is served from one origin,
// with no server code and no runtime network dependency (US-04).
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
  images: { unoptimized: true },
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
};

export default nextConfig;
