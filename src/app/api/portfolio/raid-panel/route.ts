// src/app/api/portfolio/raid-panel/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  loadRaidPanel,
  parseRaidPanelFiltersFromBody,
  parseRaidPanelFiltersFromUrl,
} from "@/lib/server/portfolio/loadRaidPanel";

export const runtime = "nodejs";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error: message, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

async function handle(req: Request, method: "GET" | "POST") {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return err("Not authenticated", 401);

  const url = new URL(req.url);
  let body: any = null;

  if (method === "POST") {
    body = await req.json().catch(() => ({}));
  }

  const days =
    method === "GET"
      ? url.searchParams.get("days")
      : body?.days ?? body?.windowDays ?? "30";

  const filters =
    method === "GET"
      ? parseRaidPanelFiltersFromUrl(url)
      : parseRaidPanelFiltersFromBody(body);

  const payload = await loadRaidPanel({
    userId: auth.user.id,
    days,
    filters,
    supabase,
  });

  return ok(payload);
}

export async function GET(req: Request) {
  try {
    return await handle(req, "GET");
  } catch (e: any) {
    console.error("[raid-panel][GET]", e);
    return err(safeStr(e?.message || e), 500);
  }
}

export async function POST(req: Request) {
  try {
    return await handle(req, "POST");
  } catch (e: any) {
    console.error("[raid-panel][POST]", e);
    return err(safeStr(e?.message || e), 500);
  }
}