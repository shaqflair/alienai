import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

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

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user?.id) {
      return jsonErr("Not authenticated", 401, { authErr: authErr?.message });
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "100");
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;

    const severity = safeStr(url.searchParams.get("severity")).trim().toLowerCase();
    const status = safeStr(url.searchParams.get("status")).trim().toLowerCase();
    const route = safeStr(url.searchParams.get("route")).trim();

    let query = supabase
      .from("platform_events")
      .select(
        "id,event_type,severity,source,title,message,route,project_id,artifact_id,metadata,fingerprint,status,first_seen_at,last_seen_at,occurrence_count,created_at,updated_at",
      )
      .order("last_seen_at", { ascending: false })
      .limit(limit);

    // Apply conditional filters if present in query string
    if (severity) query = query.eq("severity", severity);
    if (status) query = query.eq("status", status);
    if (route) query = query.eq("route", route);

    const { data, error } = await query;

    if (error) {
      return jsonErr("Failed to fetch platform events", 500, { detail: error.message });
    }

    return jsonOk({
      items: Array.isArray(data) ? data : [],
      count: Array.isArray(data) ? data.length : 0,
    });
  } catch (e: any) {
    return jsonErr("Platform event list failed", 500, {
      detail: safeStr(e?.message || e),
    });
  }
}