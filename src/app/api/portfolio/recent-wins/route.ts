// src/app/api/portfolio/recent-wins/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { loadRecentWins } from "@/lib/server/portfolio/loadRecentWins";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

async function handle(req: NextRequest, days: number, limit: number) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return withNoStore(
      NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    );
  }

  const payload = await loadRecentWins(req, {
    userId: user.id,
    days,
    limit,
    supabase,
  });

  return withNoStore(NextResponse.json(payload));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = Math.min(60, Math.max(7, parseInt(url.searchParams.get("days") ?? "30", 10)));
    const limit = Math.min(20, Math.max(1, parseInt(url.searchParams.get("limit") ?? "8", 10)));
    return await handle(req, days, limit);
  } catch (e: any) {
    return withNoStore(
      NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 }),
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = Math.min(60, Math.max(7, parseInt(String(body?.days ?? 30), 10)));
    const limit = Math.min(20, Math.max(1, parseInt(String(body?.limit ?? 8), 10)));
    return await handle(req, days, limit);
  } catch (e: any) {
    return withNoStore(
      NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 }),
    );
  }
}