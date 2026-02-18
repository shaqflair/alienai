import "server-only";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function has(name: string) {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

export async function GET() {
  return NextResponse.json(
    {
      ok: true,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: has("NEXT_PUBLIC_SUPABASE_URL"),
        NEXT_PUBLIC_SUPABASE_ANON_KEY: has("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        APP_ORIGIN: has("APP_ORIGIN"),
        NEXT_PUBLIC_APP_ORIGIN: has("NEXT_PUBLIC_APP_ORIGIN"),
        VERCEL: has("VERCEL"),
        VERCEL_ENV: process.env.VERCEL_ENV || null,
      },
    },
    { status: 200 }
  );
}
