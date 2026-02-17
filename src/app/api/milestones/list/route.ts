import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function clampDays(x: string | null, fallback = 30) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : fallback;
}

type Scope = "overdue" | "all" | "window";
function safeScope(x: string | null): Scope {
  const v = String(x || "").toLowerCase();
  if (v === "overdue" || v === "all" || v === "window") return v as Scope;
  return "window";
}

type StatusFilter = "" | "planned" | "in_progress" | "at_risk" | "completed" | "overdue";
function safeStatus(x: string | null): StatusFilter {
  const v = String(x || "").trim().toLowerCase().replace(/\s+/g, "_");
  if (v === "planned") return "planned";
  if (v === "in_progress") return "in_progress";
  if (v === "at_risk") return "at_risk";
  if (v === "completed" || v === "done") return "completed";
  if (v === "overdue") return "overdue";
  return "";
}

/** yyyy-mm-dd (UTC) */
function utcDateOnlyISO(d = new Date()) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function addUtcDays(dateISO: string, days: number) {
  const [y, m, d] = dateISO.split("-").map((x) => Number(x));
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return utcDateOnlyISO(dt);
}

/** âœ… UK display dd/mm/yyyy from ISO yyyy-mm-dd or timestamp-ish strings */
function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!yyyy || !mm || !dd) return null;
    return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function normStatus(x: any) {
  return safeStr(x).trim().toLowerCase().replace(/\s+/g, "_");
}

function isDoneStatus(s: any) {
  return new Set(["done", "completed", "closed", "cancelled", "canceled"]).has(normStatus(s));
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * âœ… Deep-link should go to the schedule ARTIFACT if present.
 * Default:
 *   /projects/:projectId/artifacts/:artifactId?focus=milestone&milestoneId=:id
 * Fallback:
 *   /projects/:projectId/schedule?milestoneId=:id
 */
function makeOpenHref(projectId: string, milestoneId: string, sourceArtifactId?: string | null) {
  if (sourceArtifactId) {
    const sp = new URLSearchParams();
    sp.set("focus", "milestone");
    sp.set("milestoneId", milestoneId);
    return `/projects/${projectId}/artifacts/${sourceArtifactId}?${sp.toString()}`;
  }
  return `/projects/${projectId}/schedule?milestoneId=${encodeURIComponent(milestoneId)}`;
}

function safeIsoDateOnly(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return utcDateOnlyISO(d);
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const url = new URL(req.url);

  const days = clampDays(url.searchParams.get("days"), 30);
  const scope = safeScope(url.searchParams.get("scope"));
  const status = safeStatus(url.searchParams.get("status"));

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  const { data: memberships, error: memErr } = await supabase
    .from("project_members")
    .select("project_id, removed_at")
    .eq("user_id", userId)
    .is("removed_at", null);

  if (memErr) {
    return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  }

  const projectIds = (memberships || []).map((m: any) => m.project_id).filter(Boolean);

  if (!projectIds.length) {
    return NextResponse.json({
      ok: true,
      days,
      scope,
      status,
      count: 0,
      chips: { planned: 0, at_risk: 0, overdue: 0 },
      kpis: {
        planned: 0,
        at_risk: 0,
        overdue: 0,
        ai_high_risk: 0,
        slip_avg_days: 0,
        slip_max_days: 0,
      },
      items: [],
    });
  }

  // =========================
  // âœ… KPI rollup (SINGLE RPC)
  // =========================
  let kpis = {
    planned: 0,
    at_risk: 0,
    overdue: 0,
    ai_high_risk: 0,
    slip_avg_days: 0,
    slip_max_days: 0,
  };

  try {
    const { data, error } = await supabase.rpc("get_schedule_milestones_kpis_portfolio", {
      p_project_ids: projectIds,
      p_window_days: days,
    });
    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;

    kpis.planned = num(row?.planned);
    kpis.at_risk = num(row?.at_risk);
    kpis.overdue = num(row?.overdue);
    kpis.ai_high_risk = num(row?.ai_high_risk);
    kpis.slip_avg_days = num(row?.slip_avg_days);
    kpis.slip_max_days = num(row?.slip_max_days);
  } catch {
    // keep zeros
  }

  // =========================
  // âœ… Milestones list
  // =========================
  let q = supabase
    .from("schedule_milestones")
    .select(
      `
      id,
      project_id,
      milestone_name,
      start_date,
      end_date,
      baseline_start,
      baseline_end,
      status,
      risk_score,
      ai_delay_prob,
      last_risk_reason,
      source_artifact_id,
      projects:projects ( id, title )
    `
    )
    .in("project_id", projectIds);

  const todayStr = utcDateOnlyISO(new Date());
  const toStr = addUtcDays(todayStr, days);

  // âœ… window must be AND-bounded
  if (scope === "window") {
    q = q.or(
      `and(end_date.gte.${todayStr},end_date.lte.${toStr}),and(end_date.is.null,start_date.gte.${todayStr},start_date.lte.${toStr})`
    );
  } else if (scope === "overdue") {
    q = q.or(`end_date.lt.${todayStr},and(end_date.is.null,start_date.lt.${todayStr})`);
    // exclude done-like (broad match)
    q = q.not("status", "ilike", "%done%");
    q = q.not("status", "ilike", "%completed%");
    q = q.not("status", "ilike", "%closed%");
    q = q.not("status", "ilike", "%cancelled%");
    q = q.not("status", "ilike", "%canceled%");
  }

  // âœ… status filter (chips)
  if (status) {
    if (status === "at_risk") {
      q = q.or("status.ilike.%at_risk%,status.ilike.%at risk%");
    } else if (status === "in_progress") {
      q = q.or("status.ilike.%in_progress%,status.ilike.%in progress%");
    } else if (status === "completed") {
      q = q.or("status.ilike.%completed%,status.ilike.%done%,status.ilike.%closed%");
    } else if (status === "overdue") {
      q = q.or(`end_date.lt.${todayStr},and(end_date.is.null,start_date.lt.${todayStr})`);
      q = q.not("status", "ilike", "%done%");
      q = q.not("status", "ilike", "%completed%");
      q = q.not("status", "ilike", "%closed%");
      q = q.not("status", "ilike", "%cancelled%");
      q = q.not("status", "ilike", "%canceled%");
    } else {
      // planned
      q = q.or(`status.ilike.%${status.replace(/_/g, " ")}%,status.ilike.%${status}%`);
    }
  }

  const { data: items, error } = await q.order("end_date", { ascending: true, nullsFirst: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const out = (items || []).map((m: any) => {
    const endISO = safeIsoDateOnly(m?.end_date);
    const startISO = safeIsoDateOnly(m?.start_date);
    const baseEndISO = safeIsoDateOnly(m?.baseline_end);
    const baseStartISO = safeIsoDateOnly(m?.baseline_start);

    const due_iso = endISO || startISO || null;

    // slip using date-only (UTC midnight) to avoid timezone drift
    const curForSlip = endISO || startISO || null;
    const baseForSlip = baseEndISO || baseStartISO || null;

    const slip_days =
      curForSlip && baseForSlip
        ? Math.round(
            (new Date(curForSlip + "T00:00:00Z").getTime() -
              new Date(baseForSlip + "T00:00:00Z").getTime()) /
              86400000
          )
        : null;

    const project_id = safeStr(m.project_id);
    const milestone_id = safeStr(m.id);
    const source_artifact_id = m?.source_artifact_id ? safeStr(m.source_artifact_id) : null;

    return {
      id: milestone_id,
      project_id,
      project_title: m?.projects?.title || "Project",
      milestone_name: safeStr(m.milestone_name) || "(untitled)",

      // âœ… dates: return ISO + UK display fields
      due_date: due_iso, // yyyy-mm-dd
      due_date_uk: fmtDateUK(due_iso),

      start_date: startISO,
      start_date_uk: fmtDateUK(startISO),

      end_date: endISO,
      end_date_uk: fmtDateUK(endISO),

      baseline_start: baseStartISO,
      baseline_start_uk: fmtDateUK(baseStartISO),

      baseline_end: baseEndISO,
      baseline_end_uk: fmtDateUK(baseEndISO),

      status: safeStr(m.status) || "planned",
      risk_score: num(m.risk_score, 0),
      ai_delay_prob: num(m.ai_delay_prob, 0),
      last_risk_reason: safeStr(m.last_risk_reason),

      slip_days,
      is_done: isDoneStatus(m.status),

      source_artifact_id,
      open_href: makeOpenHref(project_id, milestone_id, source_artifact_id),
    };
  });

  return NextResponse.json({
    ok: true,
    days,
    scope,
    status,
    count: out.length,
    chips: {
      planned: num(kpis.planned),
      at_risk: num(kpis.at_risk),
      overdue: num(kpis.overdue),
    },
    kpis,
    items: out,
  });
}


