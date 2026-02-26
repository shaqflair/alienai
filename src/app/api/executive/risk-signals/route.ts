// src/app/api/executive/approvals/risk-signals/route.ts
// ✅ FIX: All 4 queries now filter .is("projects.deleted_at", null)
// ✅ FIX: In-memory filter skips risks/incidents/tasks/tickets from closed/cancelled projects
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

function isOpenStatus(status: any) {
  const s = safeStr(status).toLowerCase().trim();
  return !["closed", "resolved", "mitigated", "done", "completed"].includes(s);
}

function isHighSeverityOrPriority(x: any) {
  const s = safeStr(x).toLowerCase().trim();
  return ["high", "critical", "sev1", "sev2", "p0", "p1"].includes(s);
}

// ✅ NEW: skip items whose joined project is in a closed/cancelled/archived state
const CLOSED_PROJECT_STATUSES = [
  "closed", "cancelled", "canceled", "deleted", "archived",
  "completed", "inactive", "on_hold", "paused", "suspended",
];

function isClosedProject(row: any): boolean {
  const proj = (row as any).projects;
  if (!proj) return false;
  // If deleted_at is populated the .is() filter should have caught it, but belt-and-braces:
  if (proj.deleted_at) return true;
  if (proj.archived_at) return true;
  if (proj.cancelled_at) return true;
  const st = safeStr(proj.status ?? proj.lifecycle_state ?? proj.state).toLowerCase().trim();
  return CLOSED_PROJECT_STATUSES.some(s => st.includes(s));
}

export async function GET() {
  try {
    const supabase = await createClient();
    const _auth = await requireUser(supabase); const user = (_auth as any)?.user ?? _auth;

    const orgIds = await orgIdsForUser(user.id);
    const orgId = safeStr(orgIds[0]).trim();
    if (!orgId) return jsonOk({ orgId: null, scope: "member", items: [] });

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    const items: any[] = [];

    // ── Optional cache view ───────────────────────────────────────────────────
    {
      const { data: cached, error } = await supabase
        .from("exec_risk_signals")
        .select("*")
        .eq("org_id", orgId)
        .limit(300);

      if (!error && Array.isArray(cached) && cached.length) {
        for (const r of cached) {
          items.push({
            type: safeStr(r?.type || "signal"),
            id: r?.id ?? r?.item_id ?? null,
            title: safeStr(r?.title || r?.label || "Untitled"),
            severity: r?.severity ?? r?.priority ?? null,
            status: r?.status ?? null,
            started_at: safeIso(r?.started_at),
            due_at: safeIso(r?.due_at),
            updated_at: safeIso(r?.updated_at),
            project_id: safeStr(r?.project_id) || null,
            project_name: safeStr(r?.project_name) || null,
            owner_id: r?.owner_id ?? r?.assignee_id ?? null,
          });
        }
      }
    }

    if (items.length === 0) {

      // ── 1. Risks ─────────────────────────────────────────────────────────────
      // ✅ Added: deleted_at, status, lifecycle_state to project select + .is("projects.deleted_at", null)
      {
        const { data, error } = await supabase
          .from("risks")
          .select(
            "id, title, severity, status, updated_at, project_id, owner_id, projects!inner(id, organisation_id, name, deleted_at, status, lifecycle_state)"
          )
          .eq("projects.organisation_id", orgId)
          .is("projects.deleted_at", null)  // ✅ exclude deleted projects at DB level
          .limit(200);

        if (!error && Array.isArray(data)) {
          for (const r of data) {
            if (isClosedProject(r)) continue;          // ✅ skip closed/cancelled
            if (!isOpenStatus(r?.status)) continue;
            if (!isHighSeverityOrPriority(r?.severity)) continue;
            items.push({
              type: "risk",
              id: r.id,
              title: safeStr(r?.title || "Untitled"),
              severity: r?.severity ?? null,
              status: r?.status ?? null,
              updated_at: safeIso(r?.updated_at),
              project_id: safeStr(r?.project_id) || null,
              project_name: safeStr((r as any).projects?.name) || null,
              owner_id: r?.owner_id ?? null,
            });
          }
        }
      }

      // ── 2. Incidents ─────────────────────────────────────────────────────────
      // ✅ Same pattern
      {
        const { data, error } = await supabase
          .from("incidents")
          .select(
            "id, title, severity, status, started_at, updated_at, project_id, commander_id, projects!inner(id, organisation_id, name, deleted_at, status, lifecycle_state)"
          )
          .eq("projects.organisation_id", orgId)
          .is("projects.deleted_at", null)  // ✅
          .limit(200);

        if (!error && Array.isArray(data)) {
          for (const r of data) {
            if (isClosedProject(r)) continue;          // ✅
            if (!isOpenStatus(r?.status)) continue;
            if (!isHighSeverityOrPriority(r?.severity)) continue;
            items.push({
              type: "incident",
              id: r.id,
              title: safeStr(r?.title || "Untitled"),
              severity: r?.severity ?? null,
              status: r?.status ?? null,
              started_at: safeIso(r?.started_at),
              updated_at: safeIso(r?.updated_at),
              project_id: safeStr(r?.project_id) || null,
              project_name: safeStr((r as any).projects?.name) || null,
              owner_id: r?.commander_id ?? null,
            });
          }
        }
      }

      // ── 3. Blocked tasks ─────────────────────────────────────────────────────
      // ✅ Same pattern
      {
        const { data, error } = await supabase
          .from("tasks")
          .select(
            "id, title, status, due_at, updated_at, project_id, assignee_id, blocked_by, projects!inner(id, organisation_id, name, deleted_at, status, lifecycle_state)"
          )
          .eq("projects.organisation_id", orgId)
          .is("projects.deleted_at", null)  // ✅
          .in("status", ["blocked"])
          .limit(200);

        if (!error && Array.isArray(data)) {
          for (const t of data) {
            if (isClosedProject(t)) continue;          // ✅
            items.push({
              type: "task",
              id: t.id,
              title: safeStr(t?.title || "Untitled"),
              status: t?.status ?? null,
              due_at: safeIso(t?.due_at),
              updated_at: safeIso(t?.updated_at),
              project_id: safeStr(t?.project_id) || null,
              project_name: safeStr((t as any).projects?.name) || null,
              owner_id: t?.assignee_id ?? null,
              blocked_by: t?.blocked_by ?? null,
            });
          }
        }
      }

      // ── 4. Overdue high-priority tickets ─────────────────────────────────────
      // ✅ Same pattern
      {
        const { data, error } = await supabase
          .from("tickets")
          .select(
            "id, title, status, priority, due_at, sla_due_at, updated_at, project_id, assignee_id, projects!inner(id, organisation_id, name, deleted_at, status, lifecycle_state)"
          )
          .eq("projects.organisation_id", orgId)
          .is("projects.deleted_at", null)  // ✅
          .limit(200);

        if (!error && Array.isArray(data)) {
          const now = Date.now();
          for (const t of data) {
            if (isClosedProject(t)) continue;          // ✅
            const status = safeStr(t?.status).toLowerCase().trim();
            if (["done", "closed", "completed", "resolved"].includes(status)) continue;
            const pr = safeStr(t?.priority).toLowerCase().trim();
            if (!isHighSeverityOrPriority(pr)) continue;
            const dueIso = safeIso((t as any).sla_due_at ?? (t as any).due_at);
            if (!dueIso) continue;
            const dueMs = new Date(dueIso).getTime();
            if (!Number.isFinite(dueMs) || dueMs >= now) continue;
            items.push({
              type: "ticket",
              id: t.id,
              title: safeStr(t?.title || "Untitled"),
              status: t?.status ?? null,
              priority: t?.priority ?? null,
              due_at: dueIso,
              updated_at: safeIso(t?.updated_at),
              project_id: safeStr(t?.project_id) || null,
              project_name: safeStr((t as any).projects?.name) || null,
              owner_id: t?.assignee_id ?? null,
            });
          }
        }
      }
    }

    // De-dupe
    const seen = new Set<string>();
    const deduped = items.filter((x) => {
      const k = `${safeStr(x?.type)}:${safeStr(x?.id)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Sort: incidents/risks first; newest updates first
    const typeRank: Record<string, number> = { incident: 0, risk: 1, ticket: 2, task: 3, signal: 4 };
    deduped.sort((a, b) => {
      const ar = typeRank[safeStr(a?.type)] ?? 9;
      const br = typeRank[safeStr(b?.type)] ?? 9;
      if (ar !== br) return ar - br;
      const au = a?.updated_at ? new Date(a.updated_at).getTime() : 0;
      const bu = b?.updated_at ? new Date(b.updated_at).getTime() : 0;
      return bu - au;
    });

    if (isExec) return jsonOk({ orgId, scope: "org", items: deduped });

    const myProjectIds = await myProjectIdsInOrg(supabase, user.id, orgId);
    const allowed = new Set(myProjectIds);
    const scoped = deduped.filter((it) => {
      const pid = pickProjectId(it);
      return pid ? allowed.has(pid) : false;
    });

    return jsonOk({ orgId, scope: "member", items: scoped });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonErr(msg, status);
  }
}: 500;
    return jsonErr(msg, status);
  }
}