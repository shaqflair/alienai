// src/app/api/portfolio/milestones-due/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  loadMilestonesDue,
  parseMilestonesDueFiltersFromBody,
  parseMilestonesDueFiltersFromUrl,
} from "@/lib/server/portfolio/loadMilestonesDue";

export const runtime = "nodejs";

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
  const userId = auth?.user?.id || null;
  if (authErr || !userId) return err("Not authenticated", 401);

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
      ? parseMilestonesDueFiltersFromUrl(url)
      : parseMilestonesDueFiltersFromBody(body);

  const payload = await loadMilestonesDue({
    userId,
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
    console.error("[GET /api/portfolio/milestones-due]", e);
    return err(String(e?.message || e || "Failed"), 500);
  }
}

export async function POST(req: Request) {
  try {
    return await handle(req, "POST");
  } catch (e: any) {
    console.error("[POST /api/portfolio/milestones-due]", e);
    return err(String(e?.message || e || "Failed"), 500);
  }
}