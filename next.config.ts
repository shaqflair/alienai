import type { NextConfig } from "next";
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const isTauri = process.env.TAURI_BUILD === "true";
const nextConfig: NextConfig = {
  // Keep if you truly need it, but try to remove ASAP.
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: isTauri,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "bjsyepwyaghnnderckgk.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  // Tauri/static export friendliness (recommended)
  ...(isTauri
    ? {
        output: "export",
        trailingSlash: true,
      }
    : {
        // Only for server builds (e.g., Vercel / self-host)
        ...(isVercel
          ? {
              output: "standalone",
              serverExternalPackages: [
                "puppeteer-core",
                "@sparticuz/chromium",
                "puppeteer",
              ],
              // Removed outputFileTracingIncludes for @sparticuz/chromium —
              // it caused Vercel builds to hang indefinitely (~170MB binary).
              // Chromium is loaded at runtime via the serverExternalPackages
              // exclusion above, so tracing is not needed.
            }
          : {}),
      }),
};
export default nextConfig;