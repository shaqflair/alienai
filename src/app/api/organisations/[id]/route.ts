//src/app/api/organisations/[id]/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function ok(data: any, status = 200) {
  return noStoreJson({ ok: true, ...data }, status);
}

function err(error: string, status = 400) {
  return noStoreJson({ ok: false, error }, status);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

/* ---------------- auth helpers ---------------- */

async function requireOrgOwnerOrAdmin(sb: any, userId: string, organisationId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const role = String(data?.role || "").toLowerCase();
  if (!(role === "owner" || role === "admin")) {
    throw new Error("Admin permission required");
  }
}

/* ---------------- handler ---------------- */

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return err(authErr.message, 401);
  if (!auth?.user) return err("Not authenticated", 401);

  const resolvedParams = await params;
  const organisationId = String(resolvedParams?.id || "").trim();
  if (!organisationId) return err("Missing organisation id", 400);
  if (!isUuid(organisationId)) return err("Invalid organisation id", 400);

  try {
    await requireOrgOwnerOrAdmin(sb, auth.user.id, organisationId);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // Cascade will remove memberships/invites
  const { error } = await sb.from("organisations").delete().eq("id", organisationId);
  if (error) return err(error.message, 400);

  return ok({ deleted: true });
}