import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

type Role = "owner" | "admin" | "member";

function normalizeRole(x: any): Role {
  const v = String(x || "").trim().toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

export async function GET() {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return err(authErr.message, 401);
  if (!auth?.user) return err("Not authenticated", 401);

  const { data, error } = await sb
    .from("organisation_members")
    .select(
      `
      role,
      removed_at,
      organisations:organisations ( id, name )
    `
    )
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (error) return err(error.message, 400);

  const items =
    (data ?? [])
      .map((r: any) => {
        const org = r.organisations;
        if (!org?.id) return null;
        return {
          orgId: org.id,
          orgName: org.name,
          role: normalizeRole(r.role),
        };
      })
      .filter(Boolean) ?? [];

  return ok({ items });
}