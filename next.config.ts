import type { NextConfig } from "next";

const isTauri = process.env.TAURI_BUILD === "true";
const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";

const SERVER_ONLY_PACKAGES = [
  "@sparticuz/chromium",
  "puppeteer-core",
  "puppeteer",
  "pdfkit",
  "@napi-rs/canvas",
  "postmark",
  "resend",
  "stripe",
  "exceljs",
  "html-to-docx",
];

const nextConfig: NextConfig = {
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

  ...(isTauri
    ? {
        output: "export",
        trailingSlash: true,
      }
    : isVercel
    ? {
        output: "standalone",
        serverExternalPackages: SERVER_ONLY_PACKAGES,
      }
    : {}),

  async headers() {
    if (isTauri) return [];
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://fonts.googleapis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https://fonts.gstatic.com https://fonts.gstatic.com",
              "connect-src 'self' https://*.supabase.co https://api.openai.com https://api.anthropic.com wss://*.supabase.co",
              "media-src 'self'",
              "object-src 'none'",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;


