// src/app/api/executive/approvals/sla-radar/route.ts
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
  return safeStr(row?.project_id || row?.projectId || row?.project_uuid || row?.projectUuid || "").trim();
}

function safeIso(v: any): string | null {
  const s = safeStr(v).trim();
  if (!s) return null;
  // if already ISO-ish, return it; otherwise Date can normalize
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function riskFromDue(nowMs: number, dueIso: string | null) {
  if (!dueIso) return { breached: false, at_risk: false, overdue_days: 0, hours_to_due: null as number | null };

  const dueMs = new Date(dueIso).getTime();
  if (!Number.isFinite(dueMs)) return { breached: false, at_risk: false, overdue_days: 0, hours_to_due: null as number | null };

  const diffMs = dueMs - nowMs;
  const diffHrs = Math.floor(diffMs / 36e5);

  if (diffMs < 0) {
    const overdueDays = Math.max(1, Math.floor(Math.abs(diffMs) / 864e5));
    return { breached: true, at_risk: false, overdue_days: overdueDays, hours_to_due: diffHrs };
  }

  if (diffHrs <= 48) {
    return { breached: false, at_risk: true, overdue_days: 0, hours_to_due: diffHrs };
  }

  return { breached: false, at_risk: false, overdue_days: 0, hours_to_due: diffHrs };
}

export async function GET() {
  try {
    const supabase = await createClient();
    const _auth = await requireUser(supabase); const user = (_auth as any)?.user ?? _auth;

    const orgIds = await orgIdsForUser(user.id);
    const orgId = safeStr(orgIds[0]).trim();
    if (!orgId) return jsonOk({ orgId: null, scope: "member", items: [] });

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    /**
     * SLA Radar:
     * Prefer:
     * - exec_sla_radar cache/table/view if present (org_id)
     * Fallback:
     * - tickets (sla_due_at|due_at) in org
     * - tasks (due_at) in org
     *
     * Response: { items: [...] }
     */
    const nowMs = Date.now();
    let items: any[] = [];

    // Optional cached view/table
    const { data: cached, error: cachedErr } = await supabase
      .from("exec_sla_radar")
      .select("*")
      .eq("org_id", orgId)
      .limit(300);

    if (!cachedErr && Array.isArray(cached) && cached.length) {
      items = cached
        .map((r: any) => {
          const dueIso = safeIso(r?.sla_due_at ?? r?.due_at ?? r?.due);
          const risk = riskFromDue(nowMs, dueIso);

          return {
            type: safeStr(r?.type || "item"),
            id: r?.id ?? r?.item_id ?? null,
            title: safeStr(r?.title || r?.label || "Untitled"),
            status: safeStr(r?.status || ""),
            priority: r?.priority ?? null,
            due_at: dueIso,
            breached: !!r?.breached || risk.breached,
            at_risk: !!r?.at_risk || risk.at_risk,
            overdue_days: Number.isFinite(Number(r?.overdue_days)) ? Number(r?.overdue_days) : risk.overdue_days,
            hours_to_due: Number.isFinite(Number(r?.hours_to_due)) ? Number(r?.hours_to_due) : risk.hours_to_due,
            updated_at: safeIso(r?.updated_at),
            project_id: safeStr(r?.project_id) || null,
            project_name: safeStr(r?.project_name) || null,
            assignee_id: r?.assignee_id ?? null,
          };
        })
        .filter((x: any) => x.breached || x.at_risk);
    } else {
      // Try tickets first
      const { data: tickets, error: ticketsErr } = await supabase
        .from("tickets")
        .select(
          "id, title, status, priority, due_at, sla_due_at, updated_at, project_id, assignee_id, projects!inner(id, organisation_id, name)"
        )
        .eq("projects.organisation_id", orgId)
        .limit(500);

      if (!ticketsErr && Array.isArray(tickets) && tickets.length) {
        items = tickets
          .map((t: any) => {
            const dueIso = safeIso(t?.sla_due_at ?? t?.due_at);
            const risk = riskFromDue(nowMs, dueIso);

            // ignore closed-ish
            const st = safeStr(t?.status).toLowerCase();
            const closed = ["done", "closed", "completed", "resolved"].includes(st);

            if (closed) return null;
            if (!risk.breached && !risk.at_risk) return null;

            return {
              type: "ticket",
              id: t.id,
              title: safeStr(t?.title || "Untitled"),
              status: t?.status ?? null,
              priority: t?.priority ?? null,
              due_at: dueIso,
              breached: risk.breached,
              at_risk: risk.at_risk,
              overdue_days: risk.overdue_days,
              hours_to_due: risk.hours_to_due,
              updated_at: safeIso(t?.updated_at),
              project_id: safeStr(t?.project_id) || null,
              project_name: safeStr(t?.projects?.name) || null,
              assignee_id: t?.assignee_id ?? null,
            };
          })
          .filter(Boolean) as any[];
      } else {
        // Fallback to tasks
        const { data: tasks, error: tasksErr } = await supabase
          .from("tasks")
          .select(
            "id, title, status, due_at, updated_at, project_id, assignee_id, projects!inner(id, organisation_id, name)"
          )
          .eq("projects.organisation_id", orgId)
          .limit(500);

        if (!tasksErr && Array.isArray(tasks)) {
          items = tasks
            .map((t: any) => {
              const dueIso = safeIso(t?.due_at);
              const risk = riskFromDue(nowMs, dueIso);

              const st = safeStr(t?.status).toLowerCase();
              const closed = ["done", "closed", "completed", "resolved"].includes(st);

              if (closed) return null;
              if (!risk.breached && !risk.at_risk) return null;

              return {
                type: "task",
                id: t.id,
                title: safeStr(t?.title || "Untitled"),
                status: t?.status ?? null,
                due_at: dueIso,
                breached: risk.breached,
                at_risk: risk.at_risk,
                overdue_days: risk.overdue_days,
                hours_to_due: risk.hours_to_due,
                updated_at: safeIso(t?.updated_at),
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
    }

    // sort: breached first, then at-risk, then soonest due
    items.sort((a, b) => {
      const aw = a.breached ? 2 : a.at_risk ? 1 : 0;
      const bw = b.breached ? 2 : b.at_risk ? 1 : 0;
      if (bw !== aw) return bw - aw;

      const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return ad - bd;
    });

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