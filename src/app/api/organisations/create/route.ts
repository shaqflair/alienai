// src/app/api/organisations/create/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ok(data: any, status = 200) {
  return noStoreJson({ ok: true, ...data }, status);
}

function err(error: string, status = 400, extra?: Record<string, any>) {
  return noStoreJson({ ok: false, error, ...(extra || {}) }, status);
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
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

/* ---------------- handler ---------------- */

export async function POST(req: Request) {
  try {
    const sb = await createClient();

    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) return err(sbErrText(authErr), 401);
    if (!auth?.user) return err("Not authenticated", 401);

    const userId = safeStr(auth.user.id).trim();
    if (!userId || !isUuid(userId)) return err("Invalid authenticated user", 401);

    const body = await req.json().catch(() => ({}));
    const name = safeStr((body as any)?.name).trim();

    if (!name) return err("Organisation name required", 400);
    if (name.length > 120) return err("Organisation name is too long", 400);

    // 1) create org
    const { data: org, error: orgErr } = await sb
      .from("organisations")
      .insert({
        name,
        created_by: userId,
      })
      .select("id, name, created_at")
      .single();

    if (orgErr) return err(sbErrText(orgErr), 400);
    if (!org?.id) return err("Failed to create organisation", 400);

    // 2) create membership for creator as owner
    const { error: memErr } = await sb.from("organisation_members").insert({
      organisation_id: org.id,
      user_id: userId,
      role: "owner",
      removed_at: null,
    });

    if (memErr) {
      // Best-effort cleanup to avoid leaving an orphan org
      await sb.from("organisations").delete().eq("id", org.id);

      return err(
        `Organisation created but failed to create owner membership: ${sbErrText(memErr)}`,
        400
      );
    }

    // 3) switch creator into the new org immediately
    // Important for dashboard/org-scoped queries.
    const { error: profileErr } = await sb
      .from("profiles")
      .update({ active_organisation_id: org.id })
      .eq("user_id", userId);

    if (profileErr) {
      // Keep org + membership, but surface the partial failure clearly.
      return err(
        `Organisation created, but failed to set active organisation: ${sbErrText(profileErr)}`,
        500,
        {
          organisation: org,
          partial_success: true,
        }
      );
    }

    return ok(
      {
        organisation: org,
        active_organisation_id: org.id,
        role: "owner",
      },
      201
    );
  } catch (e: any) {
    return err(e?.message || "Unknown error", 500);
  }
}