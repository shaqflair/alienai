// src/app/api/success-stories/summary/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

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

function clamp01to100(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** ✅ UK display date (dd/mm/yyyy) */
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
    return `${String(dd).padStart(2, "0")}/${String(mm).padStart(
      2,
      "0"
    )}/${String(yyyy)}`;
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
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

/* ---------------- org scope helpers ---------------- */

async function requireUser(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function resolveActiveOrgId(
  supabase: any,
  userId: string
): Promise<string | null> {
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
  if (cookieOrgId && looksLikeUuid(cookieOrgId) && set.has(cookieOrgId))
    return cookieOrgId;

  return orgIds[0];
}

type AllowedProject = { id: string; title: string; project_code: string | null };

async function loadOrgProjects(
  supabase: any,
  orgId: string
): Promise<AllowedProject[]> {
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

function hrefFor(
  kind: "milestones" | "raid" | "change" | "lessons" | "wbs",
  projectIdForRoute: string
) {
  if (!projectIdForRoute) return null;
  if (kind === "wbs") return `/projects/${projectIdForRoute}/wbs`;
  if (kind === "milestones") return `/projects/${projectIdForRoute}/schedule`;
  if (kind === "raid") return `/projects/${projectIdForRoute}/raid`;

  // ✅ Project change board route (NOT /change)
  if (kind === "change") return `/projects/${projectIdForRoute}/change`;

  if (kind === "lessons") return `/projects/${projectIdForRoute}/lessons`;
  return `/projects/${projectIdForRoute}`;
}

/* ---------------- scoring ---------------- */

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

/* ---------------- types ---------------- */

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

/* ---------------- v1 response shape ---------------- */

type V1Breakdown = {
  milestones_done: number;
  wbs_done: number;
  raid_resolved: number;
  changes_delivered: number;
  lessons_positive: number;
};

type V1Top = {
  id: string;
  category?: string | null;
  title: string;
  summary: string;
  happened_at?: string | null;
  project_id?: string | null;
  project_title?: string | null;
  href?: string | null;
};

function toV1Top(w: Win): V1Top {
  return {
    id: w.id,
    category: w.category ?? null,
    title: w.title,
    summary: w.summary,
    happened_at: w.happened_at ?? null,
    project_id: w.project_id ?? null,
    project_title: w.project_title ?? null,
    href: w.href ?? null,
  };
}

export async function GET(req: Request) {
  try {
    // ✅ Ensure auth cookies are bound for route handlers
    const cookieStore = await cookies();
    const supabase = await createClient(cookieStore as any);

    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const projectId = safeStr(url.searchParams.get("projectId")).trim(); // optional UUID scope

    const orgId = await resolveActiveOrgId(supabase, user.id);

    // helper: return v1-shape
    const respondV1 = (args: {
      days: number;
      score: number;
      prev_score: number;
      breakdown: V1Breakdown;
      top: V1Top[];
      meta?: any;
    }) => {
      const score = clamp01to100(args.score);
      const prev_score = clamp01to100(args.prev_score);
      const delta = score - prev_score;

      // count = total wins in breakdown (not just top list)
      const count =
        asNum(args.breakdown.milestones_done) +
        asNum(args.breakdown.wbs_done) +
        asNum(args.breakdown.raid_resolved) +
        asNum(args.breakdown.changes_delivered) +
        asNum(args.breakdown.lessons_positive);

      return jsonOk({
        days: args.days,
        score,
        prev_score,
        delta,
        count,
        breakdown: args.breakdown,
        top: args.top,
        meta: args.meta ?? {},
      });
    };

    // compute prev_score by calling same endpoint logic for a wider window (no recursion network call; just compute inline)
    const prevDays = days === 7 ? 14 : days === 14 ? 30 : 60;
    // (If days === 60, prevDays stays 60)
    const prevWindow = prevDays;

    // if no org, return empty v1
    if (!orgId) {
      return respondV1({
        days,
        score: 0,
        prev_score: 0,
        breakdown: {
          milestones_done: 0,
          wbs_done: 0,
          raid_resolved: 0,
          changes_delivered: 0,
          lessons_positive: 0,
        },
        top: [],
        meta: { scope: "org:none", project_count: 0, since_iso: isoDaysAgo(days) },
      });
    }

    const allowedProjects = await loadOrgProjects(supabase, orgId);
    const allowedIds = new Set(allowedProjects.map((p) => p.id));

    const scopedProjectIds =
      projectId && allowedIds.has(projectId)
        ? [projectId]
        : allowedProjects.map((p) => p.id);

    const projById = new Map<string, AllowedProject>();
    for (const p of allowedProjects) projById.set(p.id, p);

    async function computeWindow(windowDays: number) {
      const since = isoDaysAgo(windowDays);

      const breakdown: V1Breakdown = {
        milestones_done: 0,
        wbs_done: 0,
        raid_resolved: 0,
        changes_delivered: 0,
        lessons_positive: 0,
      };

      const wins: Win[] = [];

      // 1) milestones completed
      {
        const { data, error } = await supabase
          .from("schedule_milestones")
          .select(
            "id, project_id, milestone_name, status, progress_pct, end_date, updated_at"
          )
          .in("project_id", scopedProjectIds)
          .gte("updated_at", since)
          .limit(500);

        if (!error) {
          for (const m of data || []) {
            const st = safeLower(m?.status);
            const pct = Number(m?.progress_pct ?? 0);
            const isDone =
              st === "completed" || st === "done" || st === "closed" || pct >= 100;
            if (!isDone) continue;

            breakdown.milestones_done += 1;

            const pid = safeStr(m?.project_id).trim();
            const p = projById.get(pid) || null;

            const happenedAt =
              safeStr(m?.end_date).trim() || safeStr(m?.updated_at).trim();
            const routeId = projectRouteId(p);

            wins.push({
              id: `milestone_${m.id}`,
              category: "Delivery",
              title: "Milestone Achieved",
              summary: `${
                safeStr(m?.milestone_name).trim() || "Milestone"
              } reached completion.`,
              happened_at: happenedAt || new Date().toISOString(),
              happened_at_uk: fmtDateUK(happenedAt),
              project_id: pid || null,
              project_title: p?.title || null,
              href: routeId ? hrefFor("milestones", routeId) : null,
            });
          }
        }
      }

      // 2) raid mitigated/closed
      {
        const { data, error } = await supabase
          .from("raid_items")
          .select("id, project_id, type, title, status, updated_at, public_id")
          .in("project_id", scopedProjectIds)
          .gte("updated_at", since)
          .limit(800);

        if (!error) {
          for (const r of data || []) {
            const st = safeLower(r?.status);
            const isWin = st === "mitigated" || st === "closed";
            if (!isWin) continue;

            breakdown.raid_resolved += 1;

            const pid = safeStr(r?.project_id).trim();
            const p = projById.get(pid) || null;

            const kind = safeStr(r?.type).trim() || "RAID";
            const title =
              safeStr(r?.title).trim() ||
              safeStr(r?.public_id).trim() ||
              "RAID item";
            const happenedAt = safeStr(r?.updated_at).trim();
            const routeId = projectRouteId(p);

            wins.push({
              id: `raid_${r.id}`,
              category: "Risk",
              title: `${kind} Resolved`,
              summary: `${title} was resolved within the selected window.`,
              happened_at: happenedAt || new Date().toISOString(),
              happened_at_uk: fmtDateUK(happenedAt),
              project_id: pid || null,
              project_title: p?.title || null,
              href: routeId ? hrefFor("raid", routeId) : null,
            });
          }
        }
      }

      // 3) change implemented/closed
      {
        const { data, error } = await supabase
          .from("change_requests")
          .select("id, project_id, title, status, updated_at, decision_at, delivery_status")
          .in("project_id", scopedProjectIds)
          .gte("updated_at", since)
          .limit(500);

        if (!error) {
          for (const c of data || []) {
            const st = safeLower(c?.status);
            const ds = safeLower((c as any)?.delivery_status);
            const isImplemented =
              st === "implemented" ||
              st === "closed" ||
              ds === "implemented" ||
              ds === "closed";
            if (!isImplemented) continue;

            breakdown.changes_delivered += 1;

            const pid = safeStr(c?.project_id).trim();
            const p = projById.get(pid) || null;

            const happenedAt =
              safeStr((c as any)?.decision_at).trim() ||
              safeStr(c?.updated_at).trim();
            const routeId = projectRouteId(p);

            wins.push({
              id: `cr_${c.id}`,
              category: "Governance",
              title: "Change Delivered",
              summary: `${
                safeStr(c?.title).trim() || "Change request"
              } was delivered successfully.`,
              happened_at: happenedAt || new Date().toISOString(),
              happened_at_uk: fmtDateUK(happenedAt),
              project_id: pid || null,
              project_title: p?.title || null,
              href: routeId ? hrefFor("change", routeId) : null,
            });
          }
        }
      }

      // 4) positive lessons (published OR positive)
      {
        const { data, error } = await supabase
          .from("lessons_learned")
          .select(
            "id, project_id, category, impact, is_published, published_at, created_at"
          )
          .in("project_id", scopedProjectIds)
          .gte("created_at", since)
          .limit(500);

        if (!error) {
          for (const l of data || []) {
            const impact = safeStr(l?.impact).trim();
            const published = Boolean(l?.is_published);
            const isPositive =
              impact === "Positive" ||
              safeLower(l?.category) === "what_went_well";
            if (!published && !isPositive) continue;

            breakdown.lessons_positive += 1;

            const pid = safeStr(l?.project_id).trim();
            const p = projById.get(pid) || null;

            const happenedAt =
              safeStr(l?.published_at).trim() || safeStr(l?.created_at).trim();
            const routeId = projectRouteId(p);

            wins.push({
              id: `lesson_${l.id}`,
              category: "Learning",
              title: published ? "Lesson Published" : "Positive Lesson Captured",
              summary: published
                ? "A lesson was published to support reuse and maturity."
                : "A positive learning was captured to reinforce what works.",
              happened_at: happenedAt || new Date().toISOString(),
              happened_at_uk: fmtDateUK(happenedAt),
              project_id: pid || null,
              project_title: p?.title || null,
              href: routeId ? hrefFor("lessons", routeId) : null,
            });
          }
        }
      }

      // 5) wbs completed
      {
        const { data, error } = await supabase
          .from("wbs_items")
          .select("id, project_id, name, status, updated_at")
          .in("project_id", scopedProjectIds)
          .gte("updated_at", since)
          .limit(800);

        if (!error) {
          for (const w of data || []) {
            const st = safeLower(w?.status);
            if (!(st === "done" || st === "completed" || st === "closed"))
              continue;

            breakdown.wbs_done += 1;

            const pid = safeStr(w?.project_id).trim();
            const p = projById.get(pid) || null;

            const happenedAt = safeStr(w?.updated_at).trim();
            const routeId = projectRouteId(p);

            wins.push({
              id: `wbs_${w.id}`,
              category: "Delivery",
              title: "Work Package Completed",
              summary: `${safeStr(w?.name).trim() || "WBS item"} was completed.`,
              happened_at: happenedAt || new Date().toISOString(),
              happened_at_uk: fmtDateUK(happenedAt),
              project_id: pid || null,
              project_title: p?.title || null,
              href: routeId ? hrefFor("wbs", routeId) : null,
            });
          }
        }
      }

      wins.sort((a, b) =>
        isoSortKey(b.happened_at).localeCompare(isoSortKey(a.happened_at))
      );
      for (const w of wins) {
        if (!w.happened_at_uk) w.happened_at_uk = fmtDateUK(w.happened_at);
      }

      const points = pointsFor(breakdown);
      const score = scoreFromPoints(points, windowDays);

      return { since, breakdown, wins, points, score };
    }

    // compute current + previous
    const [cur, prev] = await Promise.all([
      computeWindow(days),
      computeWindow(prevWindow),
    ]);

    return respondV1({
      days,
      score: cur.score,
      prev_score: prev.score,
      breakdown: cur.breakdown,
      top: cur.wins.slice(0, 5).map(toV1Top),
      meta: {
        scope: projectId && allowedIds.has(projectId) ? "project" : "org",
        organisation_id: orgId,
        project_count: scopedProjectIds.length,
        since_iso: cur.since,
        total_wins: cur.wins.length,
        prev_since_iso: prev.since,
        prev_days: prevWindow,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Unknown error";
    if (safeLower(msg) === "unauthorized") return jsonErr("Unauthorized", 401);
    return jsonErr(msg, 500);
  }
}