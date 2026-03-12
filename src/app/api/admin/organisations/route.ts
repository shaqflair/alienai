import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
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

function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

/* ---------------- handler ---------------- */

export async function GET() {
  try {
    const sb = await createClient();

    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) return err(sbErrText(authErr), 401);
    if (!auth?.user) return err("Unauthenticated", 401);

    const userId = safeStr(auth.user.id).trim();
    if (!userId || !isUuid(userId)) return err("Invalid authenticated user", 401);

    // Gate: user must be a platform admin.
    // Keep this on the normal server client so auth context is enforced.
    const { data: pa, error: paErr } = await sb
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (paErr) return err(sbErrText(paErr), 403);
    if (!pa) return err("Forbidden", 403);

    // Use service role for global read after platform-admin gate passes.
    const admin = createAdminClient();

    const { data, error } = await admin
      .from("organisations")
      .select("id, name, created_at")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (error) return err(sbErrText(error), 500);

    const items = (data ?? []).map((org: any) => ({
      id: safeStr(org?.id),
      name: safeStr(org?.name),
      created_at: org?.created_at ?? null,
    }));

    return ok({ items });
  } catch (e: any) {
    return err(e?.message || "Unknown error", 500);
  }
}