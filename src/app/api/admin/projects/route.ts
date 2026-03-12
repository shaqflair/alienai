import "server-only";

import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ok(data: any = {}, status = 200) {
  return noStoreJson({ ok: true, ...data }, status);
}

function err(error: string, status = 400, extra?: Record<string, any>) {
  return noStoreJson({ ok: false, error, ...(extra || {}) }, status);
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/* ---------------- handler ---------------- */

export async function GET() {
  try {
    // Throws if user is not a platform admin
    await requirePlatformAdmin();

    const admin = createAdminClient();

    const { data, error } = await admin
      .from("projects")
      .select(`
        id,
        project_code,
        organisation_id,
        title,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) {
      return err(error.message, 500);
    }

    const items =
      (data ?? []).map((p: any) => ({
        id: safeStr(p.id),
        project_code: safeStr(p.project_code) || null,
        organisation_id: safeStr(p.organisation_id) || null,
        title: safeStr(p.title),
        created_at: p.created_at ?? null,
      })) ?? [];

    return ok({ items });
  } catch (e: any) {
    const msg = safeStr(e?.message ?? e);

    const lower = msg.toLowerCase();

    const status =
      lower.includes("forbidden")
        ? 403
        : lower.includes("auth") || lower.includes("unauthorized")
        ? 401
        : 400;

    return err(msg || "Unknown error", status);
  }
}