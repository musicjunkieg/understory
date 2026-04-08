import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    viewTransition: true,
  },
  allowedDevOrigins: [
    "127.0.0.1",
    "bryans-mac-mini.wildebeest-puffin.ts.net",
  ],
};

export default nextConfig;
