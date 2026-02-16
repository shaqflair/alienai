// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
   * Recommended for production deployments (Docker / many serverless setups).
   * Safe to include even if you don't use it.
   */
  output: "standalone",
};

export default nextConfig;
