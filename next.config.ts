import type { NextConfig } from "next";

const isVercel = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const isTauri = process.env.TAURI_BUILD === "true";

// Heavy packages that must never be bundled into the client.
// Applied on all non-Tauri targets (Vercel, self-hosted, local dev).
const SERVER_ONLY_PACKAGES = [
  "@sparticuz/chromium",
  "puppeteer-core",
  "pdfkit",
  "@napi-rs/canvas",
  "postmark",
  "resend",
  "stripe",
  "exceljs",
  "html-to-docx",
];

const nextConfig: NextConfig = {
  // ─── TypeScript / ESLint ────────────────────────────────────────────────────
  // Remove ignoreBuildErrors once type issues are resolved.
  typescript: {
    ignoreBuildErrors: true,
  },

  // ─── Images ─────────────────────────────────────────────────────────────────
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

  // ─── Server external packages ───────────────────────────────────────────────
  // Keep heavy / native packages out of the bundle on all server targets.
  // (Tauri uses `output: export` — fully static, no server — so skip there.)
  ...(!isTauri && {
    serverExternalPackages: SERVER_ONLY_PACKAGES,
  }),

  // ─── Output mode ────────────────────────────────────────────────────────────
  ...(isTauri
    ? {
        output: "export",
        trailingSlash: true,
      }
    : isVercel
    ? {
        output: "standalone",
      }
    : {}),

  // ─── Security: HTTP → HTTPS redirect ────────────────────────────────────────
  // Forces all HTTP traffic to HTTPS on Vercel / server targets.
  // Skipped for Tauri (static export, no server).
  ...(!isTauri && {
    async redirects() {
      return [
        {
          source: "/(.*)",
          has: [
            {
              type: "header",
              key: "x-forwarded-proto",
              value: "http",
            },
          ],
          destination: "https://www.aliena.co.uk/:path*",
          permanent: true,
        },
      ];
    },
  }),

  // ─── Security headers ───────────────────────────────────────────────────────
  // Applied on all server targets. Skipped for Tauri static export.
  ...(!isTauri && {
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            // Prevent clickjacking — no iframing of any page
            {
              key: "X-Frame-Options",
              value: "DENY",
            },
            // Prevent MIME-type sniffing
            {
              key: "X-Content-Type-Options",
              value: "nosniff",
            },
            // Control referrer information sent to other sites
            {
              key: "Referrer-Policy",
              value: "strict-origin-when-cross-origin",
            },
            // Restrict browser features not needed by the app
            {
              key: "Permissions-Policy",
              value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
            },
            // HSTS — force HTTPS for 2 years, include subdomains
            {
              key: "Strict-Transport-Security",
              value: "max-age=63072000; includeSubDomains; preload",
            },
            // Content Security Policy
            // Note: 'unsafe-inline' and 'unsafe-eval' are required for Next.js.
            // Tighten these once you have a nonce-based CSP in place.
            {
              key: "Content-Security-Policy",
              value: [
                "default-src 'self'",
                "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob: https:",
                "font-src 'self' data:",
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
  }),

  // ─── Experimental ───────────────────────────────────────────────────────────
  experimental: {
    // Optimise client-side imports for large icon / UI libs.
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "chart.js",
      "@tiptap/react",
      "@tiptap/starter-kit",
      "date-fns",
    ],
  },

  // ─── Turbopack (default in Next.js 16) ──────────────────────────────────────
  // Empty config satisfies Next.js when a webpack config is also present.
  turbopack: {},

  // ─── Webpack fallback (only used when --webpack flag is explicitly passed) ──
  webpack(config, { isServer }) {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
        canvas: false,
      };
      SERVER_ONLY_PACKAGES.forEach((pkg) => {
        config.resolve.alias[pkg] = false;
      });
    }
    return config;
  },
};

export default nextConfig;