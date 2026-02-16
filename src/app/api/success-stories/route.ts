import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

/* ---------------- utils ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampDays(x: string | null) {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

function asNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function moneyGBP(n: number) {
  return "£" + Math.round(n).toLocaleString("en-GB");
}

/** ISO timestamp for query filters (fine to stay ISO for DB comparisons) */
function sinceIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/** ✅ UK date display (dd/mm/yyyy) from ISO yyyy-mm-dd or timestamp-ish strings */
function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;

  // yyyy-mm-dd
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

/** Normalize to ISO date-only for sorting (yyyy-mm-dd) */
function isoDateOnly(x: any): string {
  if (!x) return "";
  const s = String(x).trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

type Story = {
  id: string;
  category: string;
  title: string;
  summary: string;
  value_label?: string | null;

  project_id?: string | null;
  project_title?: string | null;
  href?: string | null;

  /** kept for backwards-compat (ISO-ish), used for sorting */
  happened_at?: string | null;

  /** ✅ UI-friendly UK date */
  happened_at_uk?: string | null;
};

export async function GET(req: Request) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401);
  if (!auth?.user) return jsonErr("Unauthorized", 401);

  const url = new URL(req.url);
  const days = clampDays(url.searchParams.get("days"));
  const projectId = safeStr(url.searchParams.get("projectId")).trim();
  const category = safeStr(url.searchParams.get("category")).trim();
  const fv = asNum(url.searchParams.get("fv")); // optional: forecast variance from tile

  // ✅ projects user can see
  const { data: memberRows, error: memErr } = await supabase
    .from("project_members")
    .select("project_id, projects:projects(id,title)")
    .eq("user_id", auth.user.id)
    .is("removed_at", null);

  if (memErr) return jsonErr(memErr.message, 400);

  const allowedProjects = (memberRows || [])
    .map((r: any) => ({
      id: String(r?.project_id || ""),
      title: String(r?.projects?.title || "Project"),
    }))
    .filter((p: any) => Boolean(p.id));

  const allowedIds = new Set(allowedProjects.map((p) => p.id));

  if (projectId && !allowedIds.has(projectId)) {
    return jsonErr("Forbidden (not a member of that project)", 403);
  }

  const scopeProjectIds = projectId ? [projectId] : Array.from(allowedIds);
  const since = sinceIso(days);

  const stories: Story[] = [];

  // 0) Optional: Commercial headline (only if favourable)
  // Assumption: fv > 0 means favourable (under forecast). Flip if your sign convention differs.
  if (fv != null && fv > 0) {
    const nowIso = new Date().toISOString();
    stories.push({
      id: `commercial_fv_${days}`,
      category: "Commercial",
      title: "Favourable Forecast Variance",
      summary: "A positive forecast variance was recorded, indicating effective cost control and forecasting discipline.",
      value_label: `${moneyGBP(fv)} under forecast`,
      href: "/",
      happened_at: nowIso,
      happened_at_uk: fmtDateUK(nowIso),
    });
  }

  // 1) DELIVERY: Schedule milestones completed
  {
    const { data: ms, error } = await supabase
      .from("schedule_milestones")
      .select("id, project_id, milestone_name, status, progress_pct, end_date, updated_at")
      .in("project_id", scopeProjectIds)
      .gte("updated_at", since)
      .limit(500);

    if (!error) {
      for (const m of ms || []) {
        const st = String(m?.status || "").toLowerCase();
        const pct = Number(m?.progress_pct ?? 0);
        const isDone = st === "completed" || pct >= 100;
        if (!isDone) continue;

        const pid = String(m?.project_id || "");
        const p = allowedProjects.find((x) => x.id === pid);

        const happenedAt = String(m?.end_date || m?.updated_at || "");

        stories.push({
          id: `milestone_${m.id}`,
          category: "Delivery",
          title: "Milestone Achieved",
          summary: `${String(m?.milestone_name || "Milestone")} reached completion in the selected window.`,
          value_label: pct >= 100 ? "100% complete" : "Completed",
          project_id: pid,
          project_title: p?.title || null,
          href: pid ? `/projects/${pid}/milestones?days=${days}` : null,
          happened_at: happenedAt || null,
          happened_at_uk: fmtDateUK(happenedAt),
        });
      }
    }
  }

  // 2) RISK: RAID mitigated/closed
  {
    const { data: ri, error } = await supabase
      .from("raid_items")
      .select("id, project_id, type, title, status, updated_at, public_id")
      .in("project_id", scopeProjectIds)
      .gte("updated_at", since)
      .limit(800);

    if (!error) {
      for (const r of ri || []) {
        const st = String(r?.status || "");
        const isWin = st === "Mitigated" || st === "Closed";
        if (!isWin) continue;

        const pid = String(r?.project_id || "");
        const p = allowedProjects.find((x) => x.id === pid);

        const kind = String(r?.type || "RAID");
        const title = String(r?.title || r?.public_id || "RAID item");

        const happenedAt = String(r?.updated_at || "");

        stories.push({
          id: `raid_${r.id}`,
          category: "Risk",
          title: `${kind} Resolved`,
          summary: `${title} was moved to ${st} in the last ${days} days.`,
          value_label: st,
          project_id: pid,
          project_title: p?.title || null,
          href: pid ? `/projects/${pid}/raid?days=${days}` : null,
          happened_at: happenedAt || null,
          happened_at_uk: fmtDateUK(happenedAt),
        });
      }
    }
  }

  // 3) GOVERNANCE: Change implemented/closed
  {
    const { data: cr, error } = await supabase
      .from("change_requests")
      .select("id, project_id, title, status, updated_at, public_id, decision_status, decision_at")
      .in("project_id", scopeProjectIds)
      .gte("updated_at", since)
      .limit(500);

    if (!error) {
      for (const c of cr || []) {
        const st = String(c?.status || "").toLowerCase();
        const isImplemented = st === "implemented" || st === "closed";
        if (!isImplemented) continue;

        const pid = String(c?.project_id || "");
        const p = allowedProjects.find((x) => x.id === pid);

        const happenedAt = String(c?.decision_at || c?.updated_at || "");

        stories.push({
          id: `cr_${c.id}`,
          category: "Governance",
          title: "Change Successfully Delivered",
          summary: `${String(c?.title || "Change request")} reached ${String(c?.status || "implemented")} within the selected window.`,
          value_label: String(c?.status || "implemented"),
          project_id: pid,
          project_title: p?.title || null,
          href: pid ? `/projects/${pid}/change?days=${days}` : null,
          happened_at: happenedAt || null,
          happened_at_uk: fmtDateUK(happenedAt),
        });
      }
    }
  }

  // 4) LEARNING: Positive lessons published (and/or impact = Positive)
  {
    const { data: ls, error } = await supabase
      .from("lessons_learned")
      .select("id, project_id, category, description, impact, is_published, published_at, created_at")
      .in("project_id", scopeProjectIds)
      .gte("created_at", since)
      .limit(500);

    if (!error) {
      for (const l of ls || []) {
        const impact = String(l?.impact || "");
        const published = Boolean(l?.is_published);
        const isPositive = impact === "Positive" || String(l?.category || "") === "what_went_well";

        // ✅ keep Success Stories uplifting: require either published OR positive
        if (!published && !isPositive) continue;

        const pid = String(l?.project_id || "");
        const p = allowedProjects.find((x) => x.id === pid);

        const happenedAt = String(l?.published_at || l?.created_at || "");

        stories.push({
          id: `lesson_${l.id}`,
          category: "Learning",
          title: published ? "Lesson Published" : "Positive Lesson Captured",
          summary: published
            ? "A lesson was published to strengthen delivery maturity and reuse what works."
            : "A positive learning was captured to reinforce successful delivery behaviours.",
          value_label: published ? "Published" : "Captured",
          project_id: pid,
          project_title: p?.title || null,
          href: pid ? `/projects/${pid}/lessons?days=${days}` : null,
          happened_at: happenedAt || null,
          happened_at_uk: fmtDateUK(happenedAt),
        });
      }
    }
  }

  // 5) DELIVERY: WBS items completed
  {
    const { data: wbs, error } = await supabase
      .from("wbs_items")
      .select("id, project_id, name, status, updated_at")
      .in("project_id", scopeProjectIds)
      .gte("updated_at", since)
      .limit(800);

    if (!error) {
      for (const w of wbs || []) {
        const st = String(w?.status || "").toLowerCase();
        if (st !== "done") continue;

        const pid = String(w?.project_id || "");
        const p = allowedProjects.find((x) => x.id === pid);

        const happenedAt = String(w?.updated_at || "");

        stories.push({
          id: `wbs_${w.id}`,
          category: "Delivery",
          title: "Work Package Completed",
          summary: `${String(w?.name || "WBS item")} was completed within the selected window.`,
          value_label: "Done",
          project_id: pid,
          project_title: p?.title || null,
          href: pid ? `/projects/${pid}/wbs?days=${days}` : null,
          happened_at: happenedAt || null,
          happened_at_uk: fmtDateUK(happenedAt),
        });
      }
    }
  }

  // Category filter
  const filtered = category
    ? stories.filter((s) => String(s.category || "").toLowerCase() === category.toLowerCase())
    : stories;

  // Sort newest first (robust)
  filtered.sort((a, b) => isoDateOnly(b.happened_at) .localeCompare(isoDateOnly(a.happened_at)));

  // ✅ ensure UK date always present (even if happened_at was blank/odd)
  for (const s of filtered) {
    if (!s.happened_at_uk) s.happened_at_uk = fmtDateUK(s.happened_at) || null;
  }

  return jsonOk({
    days,
    items: filtered.slice(0, 250),
    projects: allowedProjects,
    meta: {
      project_count: scopeProjectIds.length,
      since_iso: since,
    },
  });
}
