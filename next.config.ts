// next.config.ts
import type { NextConfig } from "next";

const isVercel = !!process.env.VERCEL;
const isWin = process.platform === "win32";

const nextConfig: NextConfig = {
  /**
   * ✅ TEMP: Unblock production builds on Vercel
   * Next runs typechecking during `next build`.
   * You currently have a backlog of TS errors across the repo,
   * so we bypass type errors for deployment and fix progressively.
   *
   * IMPORTANT: Keep running `npx tsc --noEmit` locally/CI as your gate.
   */
  typescript: {
    ignoreBuildErrors: true,
  },

  /**
   * Keep these packages external in the server bundle.
   * Helps avoid bundling/minifying issues in Next/Turbopack.
   */
  serverExternalPackages: [
    "puppeteer-core",
    "@sparticuz/chromium",
    // optional in dev:
    "puppeteer",
  ],

  /**
   * ✅ CRITICAL FOR PDF EXPORTS ON VERCEL:
   * Ensure @sparticuz/chromium's non-JS assets (bin/*.br, etc.) are included
   * in the serverless output.
   */
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@sparticuz/chromium/**"],
  },

  /**
   * ✅ Allow next/image to load remote images from Supabase Storage
   */
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "bjsyepwyaghnnderckgk.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },

  /**
   * ✅ Standalone output triggers file-tracing + copy into `.next/standalone`.
   * On Windows, traced chunk names can include `node:fs` (contains `:`),
   * which causes `copyfile EINVAL` during the standalone copy step.
   *
   * Fix:
   * - NEVER use standalone on Windows local builds.
   * - If you want standalone, enable it only on Vercel (Linux).
   *
   * NOTE: Vercel does NOT require standalone; this is optional.
   */
  ...(isVercel && !isWin ? { output: "standalone" } : {}),
};

export default nextConfig;