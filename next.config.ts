import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // TypeScript is a separate required quality gate (`pnpm typecheck`). This
  // avoids Next spawning a duplicate checker in restricted build runners.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    cpus: 1,
    workerThreads: true,
  },
};

export default nextConfig;

