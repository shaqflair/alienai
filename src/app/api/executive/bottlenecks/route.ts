// src/app/api/executive/bottlenecks/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { orgIdsForUser, requireUser, safeStr } from "../approvals/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function isExecutiveForOrg(supabase: any, userId: string, orgId: string) {
  // Single-org exec gate: owner on any active project in org
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
  return (data || []).map((r: any) => safeStr(r?.project_id).trim()).filter(Boolean);
}

function pickProjectId(row: any): string {
  return safeStr(row?.project_id || row?.projectId || row?.project_uuid || row?.projectUuid || row?.project || "").trim();
}

function safeIso(v: any): string | null {
  const s = safeStr(v).trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const orgIds = await orgIdsForUser(user.id);
    const orgId = safeStr(orgIds[0]).trim();
    if (!orgId) return jsonOk({ orgId: null, scope: "member", items: [] });

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    /**
     * Bottlenecks: highlight work stuck too long / excessive WIP / blocked flows.
     * Prefer:
     * - workflow_items table
     * Fallback:
     * - tasks table
     *
     * Defensive: missing tables/views return empty (no cockpit blanking).
     */
    let items: any[] = [];
    const now = Date.now();

    // 1) workflow_items (preferred)
    {
      const { data, error } = await supabase
        .from("workflow_items")
        .select(
          "id, title, status, stage, created_at, updated_at, project_id, owner_id, projects!inner(id, organisation_id, name)"
        )
        .eq("projects.organisation_id", orgId)
        .limit(300);

      if (!error && Array.isArray(data) && data.length) {
        items = data
          .map((w: any) => {
            const updated = safeIso(w?.updated_at) ?? safeIso(w?.created_at);
            if (!updated) return null;

            const updatedMs = new Date(updated).getTime();
            if (!Number.isFinite(updatedMs)) return null;

            const ageDays = Math.floor((now - updatedMs) / 864e5);
            if (ageDays < 7) return null;

            const st = safeStr(w?.status).toLowerCase();
            const closed = ["done", "closed", "completed", "resolved"].includes(st);
            if (closed) return null;

            return {
              type: "workflow_item",
              id: w.id,
              title: safeStr(w?.title) || "Untitled",
              status: w?.status ?? null,
              stage: w?.stage ?? null,
              stagnant_days: ageDays,
              updated_at: updated,
              project_id: safeStr(w?.project_id) || null,
              project_name: safeStr(w?.projects?.name) || null,
              owner_id: w?.owner_id ?? null,
            };
          })
          .filter(Boolean) as any[];
      }
    }

    // 2) tasks fallback
    if (items.length === 0) {
      const { data, error } = await supabase
        .from("tasks")
        .select(
          "id, title, status, created_at, updated_at, due_at, project_id, assignee_id, projects!inner(id, organisation_id, name)"
        )
        .eq("projects.organisation_id", orgId)
        .limit(300);

      if (!error && Array.isArray(data) && data.length) {
        items = data
          .map((t: any) => {
            const st = safeStr(t?.status).toLowerCase();
            const closed = ["done", "closed", "completed", "resolved"].includes(st);
            if (closed) return null;

            const updated = safeIso(t?.updated_at) ?? safeIso(t?.created_at);
            if (!updated) return null;

            const updatedMs = new Date(updated).getTime();
            if (!Number.isFinite(updatedMs)) return null;

            const ageDays = Math.floor((now - updatedMs) / 864e5);
            if (ageDays < 7) return null;

            return {
              type: "task",
              id: t.id,
              title: safeStr(t?.title) || "Untitled",
              status: t?.status ?? null,
              stagnant_days: ageDays,
              due_at: safeIso(t?.due_at),
              updated_at: updated,
              project_id: safeStr(t?.project_id) || null,
              project_name: safeStr(t?.projects?.name) || null,
              assignee_id: t?.assignee_id ?? null,
            };
          })
          .filter(Boolean) as any[];
      } else {
        items = [];
      }
    }

    // Sort: most stagnant first
    items.sort((a, b) => (b.stagnant_days ?? 0) - (a.stagnant_days ?? 0));

    if (isExec) return jsonOk({ orgId, scope: "org", items });

    const myProjectIds = await myProjectIdsInOrg(supabase, user.id, orgId);
    const allowed = new Set(myProjectIds);
    const scoped = items.filter((it) => {
      const pid = pickProjectId(it);
      return pid ? allowed.has(pid) : false;
    });

    return jsonOk({ orgId, scope: "member", items: scoped });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonErr(msg, status);
  }
}