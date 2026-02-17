import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

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

/* ---------------- utils ---------------- */

function clampDays(x: string | null) {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

function isoDaysAgo(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function asNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

/** âœ… UK display date (dd/mm/yyyy) */
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

/** Keep stable sort key for timestamps */
function isoSortKey(x: any): string {
  if (!x) return "";
  const s = String(x).trim();
  if (!s) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

type Win = {
  id: string;
  category: "Delivery" | "Risk" | "Governance" | "Learning" | string;
  title: string;
  summary: string;

  happened_at: string;
  happened_at_uk?: string | null;

  project_id?: string | null;
  project_title?: string | null;
  href?: string | null;
};

function pointsFor(breakdown: {
  milestones_done: number;
  wbs_done: number;
  raid_resolved: number;
  changes_delivered: number;
  lessons_positive: number;
}) {
  const w = {
    milestones_done: 3,
    wbs_done: 1,
    raid_resolved: 2,
    changes_delivered: 2,
    lessons_positive: 1,
  };
  return (
    breakdown.milestones_done * w.milestones_done +
    breakdown.wbs_done * w.wbs_done +
    breakdown.raid_resolved * w.raid_resolved +
    breakdown.changes_delivered * w.changes_delivered +
    breakdown.lessons_positive * w.lessons_positive
  );
}

function scoreFromPoints(points: number, days: number) {
  const target = Math.max(6, Math.round((20 * days) / 30));
  const raw = Math.round((points / target) * 100);
  return Math.max(0, Math.min(100, raw));
}

/* ---------------- org scope helpers ---------------- */

async function requireUser(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function resolveActiveOrgId(supabase: any, userId: string): Promise<string | null> {
  const cookieStore = await cookies();
  const cookieOrgId = safeStr(cookieStore.get("active_org_id")?.value).trim();

  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, created_at, removed_at")
    .eq("user_id", userId)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);

  const orgIds = (Array.isArray(data) ? data : [])
    .map((r: any) => safeStr(r?.organisation_id).trim())
    .filter(Boolean);

  if (!orgIds.length) return null;

  const set = new Set(orgIds);
  if (cookieOrgId && looksLikeUuid(cookieOrgId) && set.has(cookieOrgId)) return cookieOrgId;

  return orgIds[0];
}

type AllowedProject = { id: string; title: string; project_code: string | null };

async function loadOrgProjects(supabase: any, orgId: string): Promise<AllowedProject[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id,title,project_code,deleted_at")
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5000);

  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data : [])
    .map((p: any) => ({
      id: safeStr(p?.id).trim(),
      title: safeStr(p?.title).trim() || "Project",
      project_code: safeStr(p?.project_code).trim() || null,
    }))
    .filter((p: any) => Boolean(p.id));
}

function projectRouteId(p: AllowedProject | undefined | null) {
  return safeStr(p?.project_code).trim() || safeStr(p?.id).trim();
}

function hrefFor(kind: "milestones" | "raid" | "change" | "lessons" | "wbs", projectIdForRoute: string) {
  if (!projectIdForRoute) return null;
  if (kind === "wbs") return `/projects/${projectIdForRoute}/wbs`;
  if (kind === "milestones") return `/projects/${projectIdForRoute}/schedule`;
  if (kind === "raid") return `/projects/${projectIdForRoute}/raid`;
  if (kind === "change") return `/projects/${projectIdForRoute}/changes`;
  if (kind === "lessons") return `/projects/${projectIdForRoute}/lessons`;
  return `/projects/${projectIdForRoute}`;
}

async function computeSummary(
  supabase: any,
  projectIds: string[],
  projectMetaById: Map<string, AllowedProject>,
  sinceIso: string,
  untilIso?: string
) {
  const applyLt = (q: any, col: string) => (untilIso ? q.lt(col, untilIso) : q);

  const breakdown = {
    milestones_done: 0,
    wbs_done: 0,
    raid_resolved: 0,
    changes_delivered: 0,
    lessons_positive: 0,
  };

  const wins: Win[] = [];

  // 1) schedule_milestones success: status done/completed/closed OR progress_pct>=100
  {
    let q = supabase
      .from("schedule_milestones")
      .select("id, project_id, milestone_name, status, progress_pct, end_date, updated_at")
      .in("project_id", projectIds)
      .gte("updated_at", sinceIso)
      .limit(400);

    q = applyLt(q, "updated_at");

    const { data, error } = await q;
    if (!error) {
      for (const m of data || []) {
        const st = safeLower(m?.status);
        const pct = asNum(m?.progress_pct, 0);
        const done = st === "completed" || st === "done" || st === "closed" || pct >= 100;
        if (!done) continue;

        breakdown.milestones_done += 1;

        const pid = safeStr(m?.project_id).trim();
        const meta = projectMetaById.get(pid) || null;
        const happenedAt = safeStr(m?.end_date).trim() || safeStr(m?.updated_at).trim() || new Date().toISOString();

        wins.push({
          id: `milestone_${m.id}`,
          category: "Delivery",
          title: "Milestone Achieved",
          summary: `${safeStr(m?.milestone_name).trim() || "Milestone"} reached completion.`,
          happened_at: happenedAt,
          happened_at_uk: fmtDateUK(happenedAt),
          project_id: pid || null,
          project_title: meta?.title || null,
          href: meta ? hrefFor("milestones", projectRouteId(meta)) : null,
        });
      }
    }
  }

  // 2) wbs_items success: status done/completed/closed
  {
    let q = supabase
      .from("wbs_items")
      .select("id, project_id, name, status, updated_at")
      .in("project_id", projectIds)
      .gte("updated_at", sinceIso)
      .limit(800);

    q = applyLt(q, "updated_at");

    const { data, error } = await q;
    if (!error) {
      for (const w of data || []) {
        const st = safeLower(w?.status);
        if (!(st === "done" || st === "completed" || st === "closed")) continue;

        breakdown.wbs_done += 1;

        const pid = safeStr(w?.project_id).trim();
        const meta = projectMetaById.get(pid) || null;
        const happenedAt = safeStr(w?.updated_at).trim() || new Date().toISOString();

        wins.push({
          id: `wbs_${w.id}`,
          category: "Delivery",
          title: "Work Package Completed",
          summary: `${safeStr(w?.name).trim() || "WBS item"} marked done.`,
          happened_at: happenedAt,
          happened_at_uk: fmtDateUK(happenedAt),
          project_id: pid || null,
          project_title: meta?.title || null,
          href: meta ? hrefFor("wbs", projectRouteId(meta)) : null,
        });
      }
    }
  }

  // 3) raid_items success: status in (Mitigated, Closed)
  {
    let q = supabase
      .from("raid_items")
      .select("id, project_id, type, title, public_id, status, updated_at")
      .in("project_id", projectIds)
      .gte("updated_at", sinceIso)
      .limit(800);

    q = applyLt(q, "updated_at");

    const { data, error } = await q;
    if (!error) {
      for (const r of data || []) {
        const st = safeLower(r?.status);
        if (!(st === "mitigated" || st === "closed")) continue;

        breakdown.raid_resolved += 1;

        const pid = safeStr(r?.project_id).trim();
        const meta = projectMetaById.get(pid) || null;
        const kind = safeStr(r?.type).trim() || "RAID";
        const label = safeStr(r?.title).trim() || safeStr(r?.public_id).trim() || "Item";
        const happenedAt = safeStr(r?.updated_at).trim() || new Date().toISOString();

        wins.push({
          id: `raid_${r.id}`,
          category: "Risk",
          title: `${kind} Resolved`,
          summary: `${label} moved to ${safeStr(r?.status).trim() || "Resolved"}.`,
          happened_at: happenedAt,
          happened_at_uk: fmtDateUK(happenedAt),
          project_id: pid || null,
          project_title: meta?.title || null,
          href: meta ? hrefFor("raid", projectRouteId(meta)) : null,
        });
      }
    }
  }

  // 4) change_requests success: implemented/closed (status OR delivery_status)
  {
    let q = supabase
      .from("change_requests")
      .select("id, project_id, title, status, delivery_status, decision_at, updated_at")
      .in("project_id", projectIds)
      .gte("updated_at", sinceIso)
      .limit(600);

    q = applyLt(q, "updated_at");

    const { data, error } = await q;
    if (!error) {
      for (const c of data || []) {
        const st = safeLower(c?.status);
        const ds = safeLower((c as any)?.delivery_status);
        const ok = st === "implemented" || st === "closed" || ds === "implemented" || ds === "closed";
        if (!ok) continue;

        breakdown.changes_delivered += 1;

        const pid = safeStr(c?.project_id).trim();
        const meta = projectMetaById.get(pid) || null;
        const happenedAt =
          safeStr(c?.decision_at).trim() || safeStr(c?.updated_at).trim() || new Date().toISOString();

        wins.push({
          id: `cr_${c.id}`,
          category: "Governance",
          title: "Change Delivered",
          summary: `${safeStr(c?.title).trim() || "Change request"} reached ${
            safeStr(c?.status).trim() || safeStr((c as any)?.delivery_status).trim() || "implemented"
          }.`,
          happened_at: happenedAt,
          happened_at_uk: fmtDateUK(happenedAt),
          project_id: pid || null,
          project_title: meta?.title || null,
          href: meta ? hrefFor("change", projectRouteId(meta)) : null,
        });
      }
    }
  }

  // 5) lessons_learned success: published OR positive
  {
    let q = supabase
      .from("lessons_learned")
      .select("id, project_id, category, impact, is_published, published_at, created_at")
      .in("project_id", projectIds)
      .gte("created_at", sinceIso)
      .limit(400);

    q = applyLt(q, "created_at");

    const { data, error } = await q;
    if (!error) {
      for (const l of data || []) {
        const cat = safeLower(l?.category);
        const impact = safeStr(l?.impact).trim();
        const published = Boolean(l?.is_published);
        const positive = published || impact === "Positive" || cat === "what_went_well";
        if (!positive) continue;

        breakdown.lessons_positive += 1;

        const pid = safeStr(l?.project_id).trim();
        const meta = projectMetaById.get(pid) || null;
        const happenedAt =
          safeStr(l?.published_at).trim() || safeStr(l?.created_at).trim() || new Date().toISOString();

        wins.push({
          id: `lesson_${l.id}`,
          category: "Learning",
          title: published ? "Lesson Published" : "Positive Lesson Captured",
          summary: published ? "Lesson published to scale good practice." : "Positive lesson logged to reinforce what works.",
          happened_at: happenedAt,
          happened_at_uk: fmtDateUK(happenedAt),
          project_id: pid || null,
          project_title: meta?.title || null,
          href: meta ? hrefFor("lessons", projectRouteId(meta)) : null,
        });
      }
    }
  }

  wins.sort((a, b) => isoSortKey(b.happened_at).localeCompare(isoSortKey(a.happened_at)));

  const points = pointsFor(breakdown);
  const count =
    breakdown.milestones_done +
    breakdown.wbs_done +
    breakdown.raid_resolved +
    breakdown.changes_delivered +
    breakdown.lessons_positive;

  return {
    breakdown,
    count,
    points,
    top: wins.slice(0, 5),
  };
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const projectId = safeStr(url.searchParams.get("projectId")).trim(); // UUID

    const orgId = await resolveActiveOrgId(supabase, user.id);
    if (!orgId) {
      return jsonOk({
        days,
        score: 0,
        prev_score: 0,
        delta: 0,
        count: 0,
        breakdown: {
          milestones_done: 0,
          wbs_done: 0,
          raid_resolved: 0,
          changes_delivered: 0,
          lessons_positive: 0,
        },
        top: [],
      });
    }

    const allowedProjects = await loadOrgProjects(supabase, orgId);
    const allowedSet = new Set(allowedProjects.map((p) => p.id));

    if (projectId && !allowedSet.has(projectId)) {
      // Donâ€™t leak other org project existence
      return jsonOk({
        days,
        score: 0,
        prev_score: 0,
        delta: 0,
        count: 0,
        breakdown: {
          milestones_done: 0,
          wbs_done: 0,
          raid_resolved: 0,
          changes_delivered: 0,
          lessons_positive: 0,
        },
        top: [],
      });
    }

    const scopeProjectIds = projectId ? [projectId] : allowedProjects.map((p) => p.id);

    if (!scopeProjectIds.length) {
      return jsonOk({
        days,
        score: 0,
        prev_score: 0,
        delta: 0,
        count: 0,
        breakdown: {
          milestones_done: 0,
          wbs_done: 0,
          raid_resolved: 0,
          changes_delivered: 0,
          lessons_positive: 0,
        },
        top: [],
      });
    }

    const projectMetaById = new Map<string, AllowedProject>();
    for (const p of allowedProjects) projectMetaById.set(p.id, p);

    const start = isoDaysAgo(days);
    const startPrev = isoDaysAgo(days * 2);
    const startCurrent = start;

    const cur = await computeSummary(supabase, scopeProjectIds, projectMetaById, start);
    const prev = await computeSummary(supabase, scopeProjectIds, projectMetaById, startPrev, startCurrent);

    const score = scoreFromPoints(cur.points, days);
    const prevScore = scoreFromPoints(prev.points, days);
    const delta = score - prevScore;

    return jsonOk({
      days,
      score,
      prev_score: prevScore,
      delta,
      count: cur.count,
      breakdown: cur.breakdown,
      top: cur.top,
      meta: {
        scope: "org",
        organisation_id: orgId,
        project_count: scopeProjectIds.length,
      },
    });
  } catch (e: any) {
    return jsonErr(e?.message || "Unknown error", 500);
  }
}


