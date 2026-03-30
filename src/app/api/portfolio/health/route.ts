// src/app/api/portfolio/health/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  loadPortfolioHealth,
  parsePortfolioHealthFiltersFromBody,
  parsePortfolioHealthFiltersFromUrl,
} from "@/lib/server/portfolio/loadPortfolioHealth";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

async function handle(req: Request, method: "GET" | "POST") {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user?.id) {
      return jsonErr("Not authenticated", 401, { authErr: authErr?.message });
    }

    const url = new URL(req.url);
    const days = url.searchParams.get("days");
    const filters =
      method === "GET"
        ? parsePortfolioHealthFiltersFromUrl(url)
        : parsePortfolioHealthFiltersFromBody(await req.json().catch(() => null));

    const payload = await loadPortfolioHealth({
      userId: auth.user.id,
      days,
      filters,
      supabase,
    });

    return jsonOk(payload);
  } catch (e: any) {
    return jsonErr("Portfolio health route failed", 500, {
      detail: String(e?.message || e),
      stack:
        process.env.NODE_ENV === "development"
          ? String(e?.stack || "")
          : undefined,
    });
  }
}

export async function GET(req: Request) {
  return handle(req, "GET");
}

export async function POST(req: Request) {
  return handle(req, "POST");
}