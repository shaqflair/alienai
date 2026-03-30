// src/app/api/portfolio/financial-plan-summary/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  loadFinancialPlanSummary,
  parseFinancialPlanSummaryFiltersFromBody,
  parseFinancialPlanSummaryFiltersFromUrl,
} from "@/lib/server/portfolio/loadFinancialPlanSummary";

export const runtime = "nodejs";

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function handle(req: Request, method: "GET" | "POST") {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return noStoreJson({ ok: false, error: "Unauthorized" }, 401);
  }

  const url = new URL(req.url);
  let body: any = null;

  if (method === "POST") {
    body = await req.json().catch(() => ({}));
  }

  const filters =
    method === "GET"
      ? parseFinancialPlanSummaryFiltersFromUrl(url)
      : parseFinancialPlanSummaryFiltersFromBody(body);

  const payload = await loadFinancialPlanSummary({
    userId: user.id,
    filters,
    supabase,
  });

  return noStoreJson(payload);
}

export async function GET(req: Request) {
  try {
    return await handle(req, "GET");
  } catch (e: any) {
    console.error("[fps][GET]", e);
    return noStoreJson({ ok: false, error: safeStr(e?.message || e) }, 500);
  }
}

export async function POST(req: Request) {
  try {
    return await handle(req, "POST");
  } catch (e: any) {
    console.error("[fps][POST]", e);
    return noStoreJson({ ok: false, error: safeStr(e?.message || e) }, 500);
  }
}