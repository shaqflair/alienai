// FILE: src/app/notifications/_lib/notifications-engine.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

/* =============================================================================
   TYPES
============================================================================= */

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertType =
  | "over_allocation"
  | "under_utilisation"
  | "upcoming_leave"
  | "pipeline_starting"
  | "project_ending"
  | "budget_exhausted";

export type Alert = {
  id:          string;   // deterministic -- same alert same id across refreshes
  type:        AlertType;
  severity:    AlertSeverity;
  title:       string;
  body:        string;
  href:        string;   // where to navigate on click
  meta: {
    personId?:   string;
    personName?: string;
    projectId?:  string;
    projectName?: string;
    weekStart?:  string;
    value?:      number;   // pct / days / weeks
  };
  createdAt:   string;   // ISO
};

/* =============================================================================
   HELPERS
============================================================================= */

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function getMondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

function addWeeks(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n * 7);
  return d.toISOString().split("T")[0];
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "short",
  });
}

function weeksInRange(start: string, end: string): string[] {
  const weeks: string[] = [];
  let cur = getMondayOf(start);
  const endMon = getMondayOf(end);
  while (cur <= endMon && weeks.length < 52) {
    weeks.push(cur);
    cur = addWeeks(cur, 1);
  }
  return weeks;
}

function makeId(...parts: (string | number)[]): string {
  return parts.join("::");
}

/* =============================================================================
   MAIN ENGINE
============================================================================= */

export async function computeAlerts(organisationId: string): Promise<Alert[]> {
  const supabase = await createClient();

  const now       = new Date();
  const today     = now.toISOString().split("T")[0];
  const thisWeek  = getMondayOf(today);
  const nextWeek  = addWeeks(thisWeek, 1);
  const in8Weeks  = addWeeks(thisWeek, 8);
  const in4Weeks  = addWeeks(thisWeek, 4);
  const in2Weeks  = addWeeks(thisWeek, 2);
  const now8wAgo  = addWeeks(thisWeek, -8);

  // -- Parallel data fetches -------------------------------------------------
  const [memberRes, allocRes, exceptionRes, projectRes, roleRes] = await Promise.all([
    supabase
      .from("organisation_members")
      .select(`
        user_id,
        profiles:profiles!organisation_members_user_id_fkey (
          user_id, full_name, default_capacity_days, is_active
        )
      `)
      .eq("organisation_id", organisationId)
      .is("removed_at", null),

    supabase
      .from("allocations")
      .select("person_id, project_id, week_start_date, days_allocated, projects:projects!allocations_project_id_fkey(id, title, project_code, budget_days, finish_date, resource_status, colour)")
      .gte("week_start_date", thisWeek)
      .lte("week_start_date", in8Weeks),

    supabase
      .from("capacity_exceptions")
      .select("person_id, week_start_date, available_days, profiles:profiles!capacity_exceptions_person_id_fkey(full_name, default_capacity_days)")
      .gte("week_start_date", thisWeek)
      .lte("week_start_date", nextWeek),

    supabase
      .from("projects")
      .select("id, title, project_code, colour, start_date, finish_date, resource_status, budget_days, win_probability")
      .eq("organisation_id", organisationId)
      .in("resource_status", ["confirmed", "pipeline"])
      .is("deleted_at", null),

    supabase
      .from("role_requirements")
      .select("project_id, role_title, filled_by_person_id, start_date")
      .is("filled_by_person_id", null)
      .then(r => r).catch(() => ({ data: [] })),
  ]);

  // Also fetch recent allocs for under-util check (last 8 weeks)
  const { data: recentAllocData } = await supabase
    .from("allocations")
    .select("person_id, week_start_date, days_allocated")
    .gte("week_start_date", now8wAgo)
    .lte("week_start_date", thisWeek);

  // -- People map -------------------------------------------------------------
  type PersonMeta = { personId: string; fullName: string; defaultCap: number };
  const peopleMap = new Map<string, PersonMeta>();
  for (const m of memberRes.data ?? []) {
    const p = (m as any).profiles;
    if (!p || p.is_active === false) continue;
    peopleMap.set(String(p.user_id || m.user_id), {
      personId:   String(p.user_id || m.user_id),
      fullName:   safeStr(p.full_name || "Unknown"),
      defaultCap: parseFloat(String(p.default_capacity_days ?? 5)),
    });
  }

  const alerts: Alert[] = [];
  const now8Iso = now.toISOString();

  // -- 1. OVER-ALLOCATION ----------------------------------------------------
  // personId -> weekStart -> total allocated
  const futureAllocByPersonWeek = new Map<string, Map<string, number>>();
  for (const a of allocRes.data ?? []) {
    const pid  = String(a.person_id);
    const week = safeStr(a.week_start_date);
    const days = parseFloat(String(a.days_allocated));
    if (!futureAllocByPersonWeek.has(pid)) futureAllocByPersonWeek.set(pid, new Map());
    futureAllocByPersonWeek.get(pid)!.set(week, (futureAllocByPersonWeek.get(pid)!.get(week) ?? 0) + days);
  }

  for (const [pid, weekMap] of futureAllocByPersonWeek) {
    const person = peopleMap.get(pid);
    if (!person) continue;
    for (const [week, totalAlloc] of weekMap) {
      const cap = person.defaultCap;
      const pct = cap > 0 ? Math.round((totalAlloc / cap) * 100) : 0;
      if (pct <= 100) continue;
      const severity: AlertSeverity = pct > 120 ? "critical" : "warning";
      alerts.push({
        id:       makeId("over_alloc", pid, week),
        type:     "over_allocation",
        severity,
        title:    `${person.fullName} over-allocated ${pct}%`,
        body:     `${totalAlloc}d allocated vs ${cap}d capacity -- week of ${fmtDate(week)}`,
        href:     `/heatmap`,
        meta:     { personId: pid, personName: person.fullName, weekStart: week, value: pct },
        createdAt: now8Iso,
      });
    }
  }

  // -- 2. UNDER-UTILISATION --------------------------------------------------
  // Check last 4 complete weeks -- person allocated < 40% for 2+ consecutive weeks
  const past4Weeks = weeksInRange(addWeeks(thisWeek, -4), addWeeks(thisWeek, -1));

  const recentByPersonWeek = new Map<string, Map<string, number>>();
  for (const a of recentAllocData ?? []) {
    const pid  = String(a.person_id);
    const week = safeStr(a.week_start_date);
    const days = parseFloat(String(a.days_allocated));
    if (!recentByPersonWeek.has(pid)) recentByPersonWeek.set(pid, new Map());
    recentByPersonWeek.get(pid)!.set(week, (recentByPersonWeek.get(pid)!.get(week) ?? 0) + days);
  }

  for (const [pid, person] of peopleMap) {
    const weekMap = recentByPersonWeek.get(pid) ?? new Map();
    let lowStreak = 0;
    for (const w of past4Weeks) {
      const alloc = weekMap.get(w) ?? 0;
      const pct   = person.defaultCap > 0 ? (alloc / person.defaultCap) * 100 : 0;
      if (pct < 40) lowStreak++;
      else lowStreak = 0;
    }
    if (lowStreak >= 2) {
      alerts.push({
        id:       makeId("under_util", pid),
        type:     "under_utilisation",
        severity: "info",
        title:    `${person.fullName} under-utilised`,
        body:     `Below 40% utilisation for ${lowStreak} consecutive weeks`,
        href:     `/heatmap`,
        meta:     { personId: pid, personName: person.fullName, value: lowStreak },
        createdAt: now8Iso,
      });
    }
  }

  // -- 3. UPCOMING LEAVE -----------------------------------------------------
  for (const e of exceptionRes.data ?? []) {
    const pid     = String(e.person_id);
    const week    = safeStr(e.week_start_date);
    const avail   = parseFloat(String(e.available_days));
    const profile = (e.profiles as any);
    const name    = safeStr(profile?.full_name || "Someone");
    const defCap  = parseFloat(String(profile?.default_capacity_days ?? 5));
    const daysLost = Math.max(0, defCap - avail);
    const isThisWeek = week === thisWeek;

    if (daysLost === 0) continue;

    alerts.push({
      id:       makeId("leave", pid, week),
      type:     "upcoming_leave",
      severity: avail === 0 ? "warning" : "info",
      title:    `${name} ${avail === 0 ? "off" : `reduced to ${avail}d`} ${isThisWeek ? "this week" : "next week"}`,
      body:     `${daysLost}d capacity lost -- w/c ${fmtDate(week)}`,
      href:     `/capacity`,
      meta:     { personId: pid, personName: name, weekStart: week, value: daysLost },
      createdAt: now8Iso,
    });
  }

  // -- 4. PIPELINE STARTING SOON WITH UNFILLED ROLES -------------------------
  const unfilledByProject = new Map<string, string[]>();
  for (const r of (roleRes as any).data ?? []) {
    const pid = String(r.project_id);
    if (!unfilledByProject.has(pid)) unfilledByProject.set(pid, []);
    unfilledByProject.get(pid)!.push(safeStr(r.role_title || "TBD"));
  }

  for (const proj of projectRes.data ?? []) {
    if (proj.resource_status !== "pipeline") continue;
    const startDate = proj.start_date ? safeStr(proj.start_date) : null;
    if (!startDate || startDate > in4Weeks || startDate < today) continue;

    const unfilled = unfilledByProject.get(String(proj.id)) ?? [];
    if (!unfilled.length) continue;

    const daysAway = Math.round(
      (new Date(startDate + "T00:00:00").getTime() - now.getTime()) / 86400000
    );

    alerts.push({
      id:       makeId("pipeline_starting", proj.id),
      type:     "pipeline_starting",
      severity: daysAway <= 14 ? "critical" : "warning",
      title:    `${safeStr(proj.title)} starts in ${daysAway}d with unfilled roles`,
      body:     `${unfilled.length} role${unfilled.length !== 1 ? "s" : ""} unfilled: ${unfilled.slice(0, 3).join(", ")}${unfilled.length > 3 ? "..." : ""}`,
      href:     `/projects/${proj.id}`,
      meta:     { projectId: String(proj.id), projectName: safeStr(proj.title), value: unfilled.length },
      createdAt: now8Iso,
    });
  }

  // -- 5. PROJECT ENDING SOON ------------------------------------------------
  for (const proj of projectRes.data ?? []) {
    if (proj.resource_status !== "confirmed") continue;
    const endDate = proj.finish_date ? safeStr(proj.finish_date) : null;
    if (!endDate || endDate > in2Weeks || endDate < today) continue;

    // Check if there are active allocations in the last week
    const projAllocs = (allocRes.data ?? []).filter((a: any) =>
      String(a.project_id) === String(proj.id) &&
      safeStr(a.week_start_date) >= thisWeek
    );
    if (!projAllocs.length) continue;

    const daysAway = Math.round(
      (new Date(endDate + "T00:00:00").getTime() - now.getTime()) / 86400000
    );
    const uniquePeople = new Set(projAllocs.map((a: any) => String(a.person_id))).size;

    alerts.push({
      id:       makeId("project_ending", proj.id),
      type:     "project_ending",
      severity: daysAway <= 7 ? "warning" : "info",
      title:    `${safeStr(proj.title)} ends in ${daysAway}d`,
      body:     `${uniquePeople} people still allocated -- ensure off-boarding and handover`,
      href:     `/projects/${proj.id}`,
      meta:     { projectId: String(proj.id), projectName: safeStr(proj.title), value: daysAway },
      createdAt: now8Iso,
    });
  }

  // -- 6. BUDGET EXHAUSTED ---------------------------------------------------
  // Build total allocated days per project from future+recent allocs
  const allocByProject = new Map<string, number>();
  for (const a of [...(allocRes.data ?? []), ...(recentAllocData ?? [])]) {
    const pid  = String((a as any).project_id);
    const days = parseFloat(String((a as any).days_allocated));
    allocByProject.set(pid, (allocByProject.get(pid) ?? 0) + days);
  }

  for (const proj of projectRes.data ?? []) {
    if (!proj.budget_days) continue;
    const budget    = parseFloat(String(proj.budget_days));
    if (budget <= 0) continue;
    const allocated = allocByProject.get(String(proj.id)) ?? 0;
    const burnPct   = Math.round((allocated / budget) * 100);
    if (burnPct < 90) continue;

    alerts.push({
      id:       makeId("budget", proj.id),
      type:     "budget_exhausted",
      severity: burnPct >= 100 ? "critical" : "warning",
      title:    `${safeStr(proj.title)} at ${burnPct}% budget burn`,
      body:     `${allocated.toFixed(1)}d allocated of ${budget}d budget -- ${burnPct >= 100 ? "over budget" : `${budget - allocated > 0 ? (budget - allocated).toFixed(1) : "0"}d remaining`}`,
      href:     `/projects/${proj.id}`,
      meta:     { projectId: String(proj.id), projectName: safeStr(proj.title), value: burnPct },
      createdAt: now8Iso,
    });
  }

  // -- Sort: critical first, then by type priority ---------------------------
  const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
  const TYPE_ORDER: Record<AlertType, number> = {
    over_allocation:  0,
    budget_exhausted: 1,
    pipeline_starting: 2,
    project_ending:   3,
    upcoming_leave:   4,
    under_utilisation: 5,
  };

  alerts.sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    TYPE_ORDER[a.type] - TYPE_ORDER[b.type]
  );

  return alerts;
}

/* =============================================================================
   DIGEST EMAIL HTML
   Generates a clean HTML email body for Resend
============================================================================= */

export function buildDigestHtml(alerts: Alert[], orgName: string, appUrl: string): string {
  const critical = alerts.filter(a => a.severity === "critical");
  const warnings = alerts.filter(a => a.severity === "warning");
  const info     = alerts.filter(a => a.severity === "info");

  const SEVERITY_COLOURS: Record<AlertSeverity, string> = {
    critical: "#dc2626",
    warning:  "#d97706",
    info:     "#0891b2",
  };

  const SEVERITY_BG: Record<AlertSeverity, string> = {
    critical: "#fef2f2",
    warning:  "#fffbeb",
    info:     "#f0f9ff",
  };

  const TYPE_EMOJI: Record<AlertType, string> = {
    over_allocation:   "",
    under_utilisation: "",
    upcoming_leave:    "[calendar]",
    pipeline_starting: "[!]",
    project_ending:    "[flag]",
    budget_exhausted:  "[money]",
  };

  function alertRow(alert: Alert) {
    const colour = SEVERITY_COLOURS[alert.severity];
    const bg     = SEVERITY_BG[alert.severity];
    const emoji  = TYPE_EMOJI[alert.type];
    return `
      <tr>
        <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9;">
          <div style="display: flex; align-items: flex-start; gap: 12px;">
            <div style="
              background: ${bg}; border: 1px solid ${colour}30;
              border-radius: 8px; padding: 10px 14px; width: 100%;
            ">
              <div style="font-size: 14px; font-weight: 700; color: ${colour}; margin-bottom: 2px;">
                ${emoji} ${alert.title}
              </div>
              <div style="font-size: 12px; color: #64748b;">${alert.body}</div>
              <a href="${appUrl}${alert.href}" style="
                display: inline-block; margin-top: 6px;
                font-size: 11px; color: ${colour}; font-weight: 600;
                text-decoration: none;
              ">View in ResForce -></a>
            </div>
          </div>
        </td>
      </tr>
    `;
  }

  function section(title: string, items: Alert[]) {
    if (!items.length) return "";
    return `
      <tr>
        <td style="padding: 16px 0 4px;">
          <div style="font-size: 11px; font-weight: 800; color: #94a3b8;
                      text-transform: uppercase; letter-spacing: 0.06em;">
            ${title} (${items.length})
          </div>
        </td>
      </tr>
      ${items.map(alertRow).join("")}
    `;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0; padding:0; background:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;">
  <div style="max-width: 600px; margin: 32px auto; background: white;
              border-radius: 16px; border: 1px solid #e2e8f0;
              box-shadow: 0 4px 24px rgba(0,0,0,0.06); overflow: hidden;">

    <!-- Header -->
    <div style="background: linear-gradient(135deg, #0e7490 0%, #0891b2 100%);
                padding: 24px 32px;">
      <div style="font-size: 20px; font-weight: 900; color: white; letter-spacing: -0.5px;">
        ResForce
      </div>
      <div style="font-size: 14px; color: rgba(255,255,255,0.75); margin-top: 4px;">
        Daily resource digest . ${orgName}
      </div>
    </div>

    <!-- Summary strip -->
    <div style="background: #f8fafc; border-bottom: 1px solid #e2e8f0;
                padding: 14px 32px; display: flex; gap: 24px;">
      <div style="text-align: center;">
        <div style="font-size: 22px; font-weight: 800; color: #dc2626; font-family: monospace;">
          ${critical.length}
        </div>
        <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">
          Critical
        </div>
      </div>
      <div style="text-align: center;">
        <div style="font-size: 22px; font-weight: 800; color: #d97706; font-family: monospace;">
          ${warnings.length}
        </div>
        <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">
          Warnings
        </div>
      </div>
      <div style="text-align: center;">
        <div style="font-size: 22px; font-weight: 800; color: #0891b2; font-family: monospace;">
          ${info.length}
        </div>
        <div style="font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">
          Info
        </div>
      </div>
      <div style="margin-left: auto; align-self: center;">
        <a href="${appUrl}/notifications" style="
          background: #0e7490; color: white; padding: 8px 16px;
          border-radius: 8px; font-size: 12px; font-weight: 700;
          text-decoration: none; display: inline-block;
        ">View all -></a>
      </div>
    </div>

    <!-- Alerts -->
    <div style="padding: 8px 32px 32px;">
      <table style="width: 100%; border-collapse: collapse;">
        ${section("Critical", critical)}
        ${section("Warnings", warnings)}
        ${section("Info", info)}
        ${alerts.length === 0 ? `
          <tr><td style="padding: 32px 0; text-align: center; color: #94a3b8; font-size: 14px;">
            [check] No alerts -- everything looks healthy
          </td></tr>
        ` : ""}
      </table>
    </div>

    <!-- Footer -->
    <div style="background: #f8fafc; border-top: 1px solid #e2e8f0;
                padding: 16px 32px; font-size: 11px; color: #94a3b8; text-align: center;">
      ResForce . You're receiving this because you're an org admin .
      <a href="${appUrl}/settings" style="color: #0891b2;">Manage notifications</a>
    </div>
  </div>
</body>
</html>
  `.trim();
}