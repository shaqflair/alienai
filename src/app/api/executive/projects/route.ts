import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

const ss = (x: any) => (typeof x === "string" ? x : x == null ? "" : String(x));

function parseBool(x: string | null): boolean {
  if (!x) return false;
  const v = x.toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

const CLOSED_STATES = [
  "closed",
  "cancelled",
  "canceled",
  "archived",
  "completed",
  "inactive",
  "on_hold",
  "paused",
  "suspended",
];

function isProjectActive(p: any): boolean {
  if (p?.deleted_at) return false;
  if (p?.closed_at) return false;

  // ✅ match your schema: lifecycle_status exists, lifecycle_state does not
  const st = ss(p?.status ?? p?.lifecycle_status ?? p?.state).toLowerCase().trim();
  if (!st) return true; // unknown => assume active
  return !CLOSED_STATES.some((s) => st.includes(s));
}

async function getOrgIds(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(50);

  return Array.from(new Set((data ?? []).map((m: any) => ss(m?.organisation_id)).filter(Boolean)));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const activeOnly = parseBool(url.searchParams.get("active_only"));

    const supabase = await createClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });

    const orgIds = await getOrgIds(supabase, user.id);
    if (!orgIds.length) return noStoreJson({ ok: false, error: "no_active_org" }, { status: 400 });

    // ✅ select only columns that exist in your projects schema
    const { data: rows, error } = await supabase
      .from("projects")
      .select(
        "id, title, project_code, project_manager_id, organisation_id, status, lifecycle_status, created_at, updated_at, deleted_at, closed_at"
      )
      .in("organisation_id", orgIds)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false });

    if (error) return noStoreJson({ ok: false, error: error.message }, { status: 500 });

    const filtered = (rows ?? []).filter((p: any) => (activeOnly ? isProjectActive(p) : true));

    return noStoreJson({
      ok: true,
      items: filtered.map((p: any) => ({
        id: ss(p?.id),
        title: p?.title ?? null,
        project_code: p?.project_code ?? null,
        project_manager_id: p?.project_manager_id ?? null,
        status: p?.status ?? p?.lifecycle_status ?? null,
        updated_at: p?.updated_at ?? null,
      })),
      meta: { active_only: activeOnly, total: filtered.length },
    });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}