// src/app/api/portfolio/resource-activity/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  loadResourceActivity,
  parseResourceActivityFiltersFromBody,
  parseResourceActivityFiltersFromUrl,
} from "@/lib/server/portfolio/loadResourceActivity";

export const runtime = "nodejs";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

async function handle(req: NextRequest, opts: { days: number; filters: any }) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();

  const user = auth?.user ?? null;
  if (authErr || !user) {
    return withNoStore(
      NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    );
  }

  const payload = await loadResourceActivity({
    userId: user.id,
    days: opts.days,
    filters: opts.filters,
    supabase,
  });

  return withNoStore(NextResponse.json(payload));
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") ?? "30", 10);
    const filters = parseResourceActivityFiltersFromUrl(url);
    return await handle(req, { days, filters });
  } catch (e: any) {
    console.error("[resource-activity][GET]", e);
    return withNoStore(
      NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 }),
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = parseInt(String(body?.days ?? body?.windowDays ?? 30), 10);
    const filters = parseResourceActivityFiltersFromBody(body);
    return await handle(req, { days, filters });
  } catch (e: any) {
    console.error("[resource-activity][POST]", e);
    return withNoStore(
      NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 }),
    );
  }
}