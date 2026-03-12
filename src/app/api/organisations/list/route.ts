import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

type Role = "owner" | "admin" | "member";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function normalizeRole(x: unknown): Role {
  const v = safeStr(x).trim().toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
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

export async function GET() {
  try {
    const sb = await createClient();

    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) return err(authErr.message, 401);
    if (!auth?.user) return err("Not authenticated", 401);

    const userId = safeStr(auth.user.id).trim();
    if (!userId || !isUuid(userId)) return err("Invalid authenticated user", 401);

    const { data: profile, error: profileErr } = await sb
      .from("profiles")
      .select("user_id, active_organisation_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileErr) {
      return err(`Failed to read profile: ${sbErrText(profileErr)}`, 400);
    }

    const activeOrganisationId = safeStr(profile?.active_organisation_id).trim() || null;

    const { data, error } = await sb
      .from("organisation_members")
      .select(
        `
        role,
        removed_at,
        organisations:organisations ( id, name )
      `
      )
      .eq("user_id", userId)
      .is("removed_at", null)
      .order("created_at", { ascending: true });

    if (error) return err(sbErrText(error), 400);

    const items =
      (data ?? [])
        .map((r: any) => {
          const org = r?.organisations;
          const orgId = safeStr(org?.id).trim();
          if (!orgId) return null;

          return {
            orgId,
            orgName: safeStr(org?.name),
            role: normalizeRole(r?.role),
            isActive: activeOrganisationId === orgId,
          };
        })
        .filter(Boolean) ?? [];

    return ok({
      active_organisation_id: activeOrganisationId,
      items,
    });
  } catch (e: any) {
    return err(e?.message || "Unknown error", 500);
  }
}