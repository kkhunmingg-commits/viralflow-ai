import type { NextConfig } from "next";

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  process.env.NODE_ENV === "development"
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
].join("; ");

const nextConfig: NextConfig = {
  // Owner browser sessions, signed queue URLs and local caches are never server artifacts.
  outputFileTracingExcludes: {
    "/*": ["./.runtime/**/*", "./workers/flow-browser/workspace/**/*", "./workers/flow-browser/selectors.json", "./.git/**/*", "./.env", "./.env.*"],
  },
  outputFileTracingIncludes: {
    "/video-factory/providers": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/linux/x64/ffprobe"],
    "/api/post/create": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/linux/x64/ffprobe"],
    "/api/post/create/product": ["./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/linux/x64/ffprobe"],
    // Real-media composer: Thai caption font plus the binaries it shells out to.
    "/creative-studio/[id]": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/linux/x64/ffprobe"],
    "/video-factory/[id]": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg", "./node_modules/ffprobe-static/bin/linux/x64/ffprobe"],
    // The Windows installer embeds the Flow worker and its setup script.
    "/api/flow-installer": ["./workers/flow-browser/*.mjs", "./workers/flow-browser/installer/setup.ps1"],
    // The installed worker pulls its own files from here (self-update).
    // Drama Studio takes last frames and cuts episodes in this route's background work.
    "/api/flow-worker/[action]": ["./workers/flow-browser/*.mjs", "./workers/flow-browser/installer/setup.ps1", "./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg"],
    "/drama": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg"],
    // The drama tab lives in the clip page; its buttons move a series on, which may check a shot.
    "/post": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg"],
    "/drama/[id]": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg"],
    // Product clips from a pasted link: opening the tab may cut a finished clip in the background.
    "/product-clips": ["./assets/fonts/**", "./node_modules/ffmpeg-static/ffmpeg"],
  },
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: contentSecurityPolicy },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    }, {
      // The browser must always re-check the service worker so fixes reach installed phones.
      source: "/sw.js",
      headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }],
    }];
  },
  // TypeScript is a separate required quality gate (`pnpm typecheck`). This
  // avoids Next spawning a duplicate checker in restricted build runners.
  typescript: { ignoreBuildErrors: true },
  experimental: {
    // Product photos uploaded with a pasted link (resized in the browser first; Vercel caps a request at 4.5 MB).
    serverActions: { bodySizeLimit: "4mb" },
    cpus: 1,
    workerThreads: true,
  },
};

export default nextConfig;

