// src/app/api/success-stories/summary/route.ts
// ✅ Already org-scoped via resolveActiveOrgId + loadOrgProjects.
//    Fixed: projectRouteId() now always uses UUID (consistent with projects list fix).
import "server-only";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

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

function clampDays(x: string | null) {
  const n = Number(x);
  return new Set([7, 14, 30, 60]).has(n) ? n : 30;
}
function isoDaysAgo(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString();
}
function safeStr(x: unknown) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function safeLower(x: unknown) { return safeStr(x).trim().toLowerCase(); }
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}
function asNum(x: any, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }
function clamp01to100(x: any) {
  const n = Number(x); if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3].padStart(2,"0")}/${m[2].padStart(2,"0")}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
}

function isoSortKey(x: any): string {
  if (!x) return ""; const s = String(x).trim(); if (!s) return "";
  const d = new Date(s); return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

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
    .map((r: any) => safeStr(r?.organisation_id).trim()).filter(Boolean);
  if (!orgIds.length) return null;
  const set = new Set(orgIds);
  if (cookieOrgId && looksLikeUuid(cookieOrgId) && set.has(cookieOrgId)) return cookieOrgId;
  return orgIds[0];
}

type AllowedProject = { id: string; title: string; project_code: string | null };

async function loadOrgProjects(supabase: any, orgId: string): Promise<AllowedProject[]> {
  const { data, error } = await supabase
    .from("projects").select("id,title,project_code,deleted_at")
    .eq("organisation_id", orgId).is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(5000);
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : [])
    .map((p: any) => ({
      id: safeStr(p?.id).trim(),
      title: safeStr(p?.title).trim() || "Project",
      project_code: safeStr(p?.project_code).trim() || null,
    }))
    .filter((p: any) => Boolean(p.id));
}

// ✅ Always use project UUID in hrefs (consistent with projects list fix)
function projectRouteId(p: AllowedProject | undefined | null) {
  return safeStr(p?.id).trim();
}

function hrefFor(kind: "milestones" | "raid" | "change" | "lessons" | "wbs", projectId: string) {
  if (!projectId) return null;
  if (kind === "wbs") return `/projects/${projectId}/wbs`;
  if (kind === "milestones") return `/projects/${projectId}/schedule`;
  if (kind === "raid") return `/projects/${projectId}/raid`;
  if (kind === "change") return `/projects/${projectId}/change`;
  if (kind === "lessons") return `/projects/${projectId}/lessons`;
  return `/projects/${projectId}`;
}

function pointsFor(breakdown: {
  milestones_done: number; wbs_done: number; raid_resolved: number;
  changes_delivered: number; lessons_positive: number;
}) {
  return (
    breakdown.milestones_done * 3 + breakdown.wbs_done * 1 +
    breakdown.raid_resolved * 2 + breakdown.changes_delivered * 2 +
    breakdown.lessons_positive * 1
  );
}

function scoreFromPoints(points: number, days: number) {
  const target = Math.max(6, Math.round((20 * days) / 30));
  return Math.max(0, Math.min(100, Math.round((points / target) * 100)));
}

type Win = {
  id: string; category: string; title: string; summary: string;
  happened_at: string; happened_at_uk?: string | null;
  project_id?: string | null; project_title?: string | null; href?: string | null;
};
type V1Breakdown = {
  milestones_done: number; wbs_done: number; raid_resolved: number;
  changes_delivered: number; lessons_positive: number;
};
type V1Top = {
  id: string; category?: string | null; title: string; summary: string;
  happened_at?: string | null; project_id?: string | null;
  project_title?: string | null; href?: string | null;
};
function toV1Top(w: Win): V1Top {
  return { id: w.id, category: w.category ?? null, title: w.title, summary: w.summary,
    happened_at: w.happened_at ?? null, project_id: w.project_id ?? null,
    project_title: w.project_title ?? null, href: w.href ?? null };
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = await createClient(cookieStore as any);
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const prevDays = days === 7 ? 14 : days === 14 ? 30 : 60;

    const orgId = await resolveActiveOrgId(supabase, user.id);

    const respondV1 = (args: { days: number; score: number; prev_score: number; breakdown: V1Breakdown; top: V1Top[]; meta?: any }) => {
      const score = clamp01to100(args.score);
      const prev_score = clamp01to100(args.prev_score);
      const delta = score - prev_score;
      const count = Object.values(args.breakdown).reduce((a, b) => a + asNum(b), 0);
      return jsonOk({ days: args.days, score, prev_score, delta, count, breakdown: args.breakdown, top: args.top, meta: args.meta ?? {} });
    };

    if (!orgId) {
      return respondV1({
        days, score: 0, prev_score: 0,
        breakdown: { milestones_done: 0, wbs_done: 0, raid_resolved: 0, changes_delivered: 0, lessons_positive: 0 },
        top: [],
        meta: { scope: "org:none", projectCount: 0, since_iso: isoDaysAgo(days) },
      });
    }

    const allowedProjects = await loadOrgProjects(supabase, orgId);
    const allowedIds = new Set(allowedProjects.map((p) => p.id));
    const scopedProjectIds = projectId && allowedIds.has(projectId)
      ? [projectId]
      : allowedProjects.map((p) => p.id);

    const projById = new Map<string, AllowedProject>();
    for (const p of allowedProjects) projById.set(p.id, p);

    async function computeWindow(windowDays: number) {
      const since = isoDaysAgo(windowDays);
      const breakdown: V1Breakdown = { milestones_done: 0, wbs_done: 0, raid_resolved: 0, changes_delivered: 0, lessons_positive: 0 };
      const wins: Win[] = [];

      // 1) Milestones
      {
        const { data, error } = await supabase
          .from("schedule_milestones")
          .select("id, project_id, milestone_name, status, progress_pct, end_date, updated_at")
          .in("project_id", scopedProjectIds).gte("updated_at", since).limit(500);
        if (!error) {
          for (const m of data || []) {
            const st = safeLower(m?.status); const pct = Number(m?.progress_pct ?? 0);
            if (!(st === "completed" || st === "done" || st === "closed" || pct >= 100)) continue;
            breakdown.milestones_done += 1;
            const pid = safeStr(m?.project_id).trim();
            const p = projById.get(pid) || null;
            const happenedAt = safeStr(m?.end_date).trim() || safeStr(m?.updated_at).trim();
            wins.push({
              id: `milestone_${m.id}`, category: "Delivery", title: "Milestone Achieved",
              summary: `${safeStr(m?.milestone_name).trim() || "Milestone"} reached completion.`,
              happened_at: happenedAt || new Date().toISOString(), happened_at_uk: fmtDateUK(happenedAt),
              project_id: pid || null, project_title: p?.title || null,
              href: pid ? hrefFor("milestones", pid) : null,
            });
          }
        }
      }

      // 2) RAID
      {
        const { data, error } = await supabase
          .from("raid_items").select("id, project_id, type, title, status, updated_at, public_id")
          .in("project_id", scopedProjectIds).gte("updated_at", since).limit(800);
        if (!error) {
          for (const r of data || []) {
            const st = safeLower(r?.status);
            if (!(st === "mitigated" || st === "closed")) continue;
            breakdown.raid_resolved += 1;
            const pid = safeStr(r?.project_id).trim();
            const p = projById.get(pid) || null;
            const kind = safeStr(r?.type).trim() || "RAID";
            const title = safeStr(r?.title).trim() || safeStr(r?.public_id).trim() || "RAID item";
            wins.push({
              id: `raid_${r.id}`, category: "Risk", title: `${kind} Resolved`,
              summary: `${title} was resolved within the selected window.`,
              happened_at: safeStr(r?.updated_at).trim() || new Date().toISOString(),
              happened_at_uk: fmtDateUK(r?.updated_at),
              project_id: pid || null, project_title: p?.title || null,
              href: pid ? hrefFor("raid", pid) : null,
            });
          }
        }
      }

      // 3) Changes
      {
        const { data, error } = await supabase
          .from("change_requests").select("id, project_id, title, status, updated_at, decision_at, delivery_status")
          .in("project_id", scopedProjectIds).gte("updated_at", since).limit(500);
        if (!error) {
          for (const c of data || []) {
            const st = safeLower(c?.status); const ds = safeLower((c as any)?.delivery_status);
            if (!(st === "implemented" || st === "closed" || ds === "implemented" || ds === "closed")) continue;
            breakdown.changes_delivered += 1;
            const pid = safeStr(c?.project_id).trim();
            const p = projById.get(pid) || null;
            const happenedAt = safeStr((c as any)?.decision_at).trim() || safeStr(c?.updated_at).trim();
            wins.push({
              id: `cr_${c.id}`, category: "Governance", title: "Change Delivered",
              summary: `${safeStr(c?.title).trim() || "Change request"} was delivered successfully.`,
              happened_at: happenedAt || new Date().toISOString(), happened_at_uk: fmtDateUK(happenedAt),
              project_id: pid || null, project_title: p?.title || null,
              href: pid ? hrefFor("change", pid) : null,
            });
          }
        }
      }

      // 4) Lessons
      {
        const { data, error } = await supabase
          .from("lessons_learned").select("id, project_id, category, impact, is_published, published_at, created_at")
          .in("project_id", scopedProjectIds).gte("created_at", since).limit(500);
        if (!error) {
          for (const l of data || []) {
            const impact = safeStr(l?.impact).trim();
            const published = Boolean(l?.is_published);
            const isPositive = impact === "Positive" || safeLower(l?.category) === "what_went_well";
            if (!published && !isPositive) continue;
            breakdown.lessons_positive += 1;
            const pid = safeStr(l?.project_id).trim();
            const p = projById.get(pid) || null;
            const happenedAt = safeStr(l?.published_at).trim() || safeStr(l?.created_at).trim();
            wins.push({
              id: `lesson_${l.id}`, category: "Learning",
              title: published ? "Lesson Published" : "Positive Lesson Captured",
              summary: published
                ? "A lesson was published to support reuse and maturity."
                : "A positive learning was captured to reinforce what works.",
              happened_at: happenedAt || new Date().toISOString(), happened_at_uk: fmtDateUK(happenedAt),
              project_id: pid || null, project_title: p?.title || null,
              href: pid ? hrefFor("lessons", pid) : null,
            });
          }
        }
      }

      // 5) WBS
      {
        const { data, error } = await supabase
          .from("wbs_items").select("id, project_id, name, status, updated_at")
          .in("project_id", scopedProjectIds).gte("updated_at", since).limit(800);
        if (!error) {
          for (const w of data || []) {
            const st = safeLower(w?.status);
            if (!(st === "done" || st === "completed" || st === "closed")) continue;
            breakdown.wbs_done += 1;
            const pid = safeStr(w?.project_id).trim();
            const p = projById.get(pid) || null;
            wins.push({
              id: `wbs_${w.id}`, category: "Delivery", title: "Work Package Completed",
              summary: `${safeStr(w?.name).trim() || "WBS item"} was completed.`,
              happened_at: safeStr(w?.updated_at).trim() || new Date().toISOString(),
              happened_at_uk: fmtDateUK(w?.updated_at),
              project_id: pid || null, project_title: p?.title || null,
              href: pid ? hrefFor("wbs", pid) : null,
            });
          }
        }
      }

      wins.sort((a, b) => isoSortKey(b.happened_at).localeCompare(isoSortKey(a.happened_at)));
      for (const w of wins) if (!w.happened_at_uk) w.happened_at_uk = fmtDateUK(w.happened_at);

      return { since, breakdown, wins, score: scoreFromPoints(pointsFor(breakdown), windowDays) };
    }

    const [cur, prev] = await Promise.all([computeWindow(days), computeWindow(prevDays)]);

    return respondV1({
      days, score: cur.score, prev_score: prev.score,
      breakdown: cur.breakdown,
      top: cur.wins.slice(0, 5).map(toV1Top),
      meta: {
        scope: projectId && allowedIds.has(projectId) ? "project" : "org",
        organisation_id: orgId,
        projectCount: scopedProjectIds.length,
        since_iso: cur.since, total_wins: cur.wins.length,
        prev_since_iso: prev.since, prev_days: prevDays,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Unknown error";
    if (safeLower(msg) === "unauthorized") return jsonErr("Unauthorized", 401);
    return jsonErr(msg, 500);
  }
}