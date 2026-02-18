import "server-only";
import { NextResponse } from "next/server";

type EnvCheck = {
  name: string;
  present: boolean;
  scope: "public" | "server";
};

const ENV_VARS: EnvCheck[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", present: false, scope: "public" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", present: false, scope: "public" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", present: false, scope: "server" },

  { name: "APP_BASE_URL", present: false, scope: "server" },
  { name: "NEXT_PUBLIC_APP_BASE_URL", present: false, scope: "public" },

  { name: "RESEND_API_KEY", present: false, scope: "server" },
  { name: "RESEND_FROM", present: false, scope: "server" },
  { name: "RESEND_WEBHOOK_SECRET", present: false, scope: "server" },

  { name: "NEXT_DISABLE_TURBOPACK", present: false, scope: "server" },
  { name: "PUPPETEER_EXECUTABLE_PATH", present: false, scope: "server" },
  { name: "PDF_USE_FULL_PUPPETEER", present: false, scope: "server" },
];

export async function GET() {
  const results = ENV_VARS.map((e) => ({
    ...e,
    present: Boolean(process.env[e.name]),
  }));

  const missing = results.filter((r) => !r.present).map((r) => r.name);

  return NextResponse.json({
    ok: missing.length === 0,
    summary: {
      total: results.length,
      present: results.filter((r) => r.present).length,
      missing: missing.length,
    },
    missing,
    vars: results,
    note: "Values are NOT shown. This endpoint only checks presence.",
  });
}
