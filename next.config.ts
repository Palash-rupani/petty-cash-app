import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  experimental: {
    serverActions: {
      // Allow uploads up to 50MB (covers large retail data files)
      bodySizeLimit: '50mb',
    },
  },
};

export default nextConfig;
