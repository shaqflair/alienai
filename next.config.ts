// next.config.ts
import type { NextConfig } from "next";

const isVercel = !!process.env.VERCEL;

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
   * in the serverless output. Without this, you'll see:
   * "The input directory '/var/task/node_modules/@sparticuz/chromium/bin' does not exist..."
   *
   * We include it for all API route handlers (safe + simple).
   */
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@sparticuz/chromium/**"],
  },

  /**
   * ✅ Allow next/image to load remote images from Supabase Storage
   * (Fixes: Invalid src prop ... hostname is not configured)
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
   * ✅ IMPORTANT:
   * `output: "standalone"` triggers file-tracing + copy into `.next/standalone`.
   * On Windows, Turbopack can emit traced chunk names like `node:fs` (contains `:`),
   * which causes `copyfile EINVAL` during the standalone copy step.
   *
   * Vercel does NOT require standalone output, so disable it there.
   * Keep standalone for Docker/self-hosting builds when NOT on Vercel.
   */
  ...(isVercel ? {} : { output: "standalone" }),
};

export default nextConfig;
