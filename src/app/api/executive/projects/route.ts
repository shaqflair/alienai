// src/app/api/executive/projects/route.ts
// Executive Projects feed for Cockpit / Approvals UI
// ✅ Filters deleted projects at DB level
// ✅ Non-exec users only see projects they’re a member of
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { orgIdsForUser, requireUser, safeStr } from "../approvals/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function isExecutiveForOrg(supabase: any, userId: string, orgId: string) {
  // “Exec” = owner on any project in org (matches your other executive routes)
  const { data, error } = await supabase
    .from("project_members")
    .select("id, projects!inner(id, organisation_id)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data;
}

async function myProjectIdsInOrg(supabase: any, userId: string, orgId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id, projects!inner(id, organisation_id)")
    .eq("user_id", userId)
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId);

  if (error) throw new Error(error.message);

  return (data || [])
    .map((r: any) => safeStr(r?.project_id).trim())
    .filter(Boolean);
}

const CLOSED_PROJECT_STATUSES = [
  "closed",
  "cancelled",
  "canceled",
  "deleted",
  "archived",
  "completed",
  "inactive",
  "on_hold",
  "paused",
  "suspended",
];

function isClosedStatus(x: any) {
  const s = safeStr(x).toLowerCase().trim();
  if (!s) return false;
  return CLOSED_PROJECT_STATUSES.some((k) => s.includes(k));
}

export async function GET() {
  try {
    const supabase = await createClient();
    const _auth = await requireUser(supabase);
    const user = (_auth as any)?.user ?? _auth;

    const orgIds = await orgIdsForUser(user.id);
    const orgId = safeStr(orgIds?.[0]).trim();
    if (!orgId) return jsonOk({ orgId: null, scope: "member", total: 0, projects: [] });

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    // Pull org projects (non-deleted). We’ll scope down in-memory for members if needed.
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, project_code, status, lifecycle_state, deleted_at, updated_at, created_at")
      .eq("organisation_id", orgId)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) return jsonErr(error.message, 500);

    let rows = Array.isArray(data) ? data : [];

    // belt-and-braces: skip closed/cancelled/archived
    rows = rows.filter((p: any) => {
      if (p?.deleted_at) return false;
      const st = p?.status ?? p?.lifecycle_state;
      return !isClosedStatus(st);
    });

    if (!isExec) {
      const myIds = await myProjectIdsInOrg(supabase, user.id, orgId);
      const allowed = new Set(myIds);
      rows = rows.filter((p: any) => allowed.has(safeStr(p?.id).trim()));
    }

    const projects = rows.map((p: any) => ({
      id: p?.id,
      name: safeStr(p?.name || "Untitled"),
      project_code: safeStr(p?.project_code || ""),
      status: p?.status ?? p?.lifecycle_state ?? null,
      updated_at: p?.updated_at ?? null,
      created_at: p?.created_at ?? null,
    }));

    return jsonOk({
      orgId,
      scope: isExec ? "org" : "member",
      total: projects.length,
      projects,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonErr(msg, status);
  }
}