// src/app/api/success-stories/route.ts
// ✅ Already org-scoped via resolveActiveOrgId + loadOrgProjects.
//    Fixed: projectRef() now always uses UUID (consistent with projects list fix).
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

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) { return safeStr(x).trim().toLowerCase(); }
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}
function clampDays(x: string | null) {
  const n = Number(x);
  return new Set([7, 14, 30, 60]).has(n) ? n : 30;
}
function asNum(x: any) { const n = Number(x); return Number.isFinite(n) ? n : null; }
function moneyGBP(n: number) { return "£" + Math.round(n).toLocaleString("en-GB"); }
function sinceIso(days: number) {
  const d = new Date(); d.setDate(d.getDate() - days); return d.toISOString();
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

function isoDateOnly(x: any): string {
  if (!x) return "";
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
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

// ✅ Always use project UUID in hrefs (consistent with projects list fix)
function projectRef(p: AllowedProject | undefined | null) {
  return safeStr(p?.id).trim();
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
  happened_at?: string | null;
  happened_at_uk?: string | null;
};

function hrefFor(
  kind: "milestones" | "raid" | "change" | "lessons" | "wbs",
  projectId: string,
  days: number
) {
  if (!projectId) return null;
  if (kind === "wbs") return `/projects/${projectId}/wbs?days=${days}`;
  if (kind === "milestones") return `/projects/${projectId}/schedule?days=${days}`;
  if (kind === "raid") return `/projects/${projectId}/raid?days=${days}`;
  if (kind === "change") return `/projects/${projectId}/change?days=${days}`;
  if (kind === "lessons") return `/projects/${projectId}/lessons?days=${days}`;
  return `/projects/${projectId}`;
}

export async function GET(req: Request) {
  try {
    const cookieStore = await cookies();
    const supabase = await createClient(cookieStore as any);
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const category = safeStr(url.searchParams.get("category")).trim();
    const fv = asNum(url.searchParams.get("fv"));

    const orgId = await resolveActiveOrgId(supabase, user.id);
    if (!orgId) {
      return jsonOk({
        days, items: [], projects: [],
        meta: { projectCount: 0, since_iso: sinceIso(days), scope: "org:none" },
      });
    }

    const allowedProjects = await loadOrgProjects(supabase, orgId);
    const allowedIds = new Set(allowedProjects.map((p) => p.id));

    if (projectId && !allowedIds.has(projectId)) {
      return jsonOk({
        days, items: [],
        projects: allowedProjects.map((p) => ({ id: p.id, title: p.title })),
        meta: { projectCount: allowedProjects.length, since_iso: sinceIso(days), scope: "org", denied_project_id: true },
      });
    }

    const scopeProjectIds = projectId ? [projectId] : allowedProjects.map((p) => p.id);
    const since = sinceIso(days);
    const stories: Story[] = [];
    const projById = new Map<string, AllowedProject>();
    for (const p of allowedProjects) projById.set(p.id, p);

    // 0) Commercial headline (only if favourable)
    if (fv != null && fv > 0) {
      const nowIso = new Date().toISOString();
      stories.push({
        id: `commercial_fv_${days}`,
        category: "Commercial",
        title: "Favourable Forecast Variance",
        summary: "A positive forecast variance was recorded, indicating effective cost control and forecasting discipline.",
        value_label: `${moneyGBP(fv)} under forecast`,
        href: "/success-stories",
        happened_at: nowIso,
        happened_at_uk: fmtDateUK(nowIso),
      });
    }

    // 1) Milestones completed
    {
      const { data: ms, error } = await supabase
        .from("schedule_milestones")
        .select("id, project_id, milestone_name, status, progress_pct, end_date, updated_at")
        .in("project_id", scopeProjectIds).gte("updated_at", since).limit(500);

      if (!error) {
        for (const m of ms || []) {
          const st = safeLower(m?.status); const pct = Number(m?.progress_pct ?? 0);
          const isDone = st === "completed" || st === "done" || st === "closed" || pct >= 100;
          if (!isDone) continue;
          const pid = safeStr(m?.project_id).trim();
          const p = projById.get(pid) || null;
          const happenedAt = safeStr(m?.end_date).trim() || safeStr(m?.updated_at).trim();
          stories.push({
            id: `milestone_${m.id}`, category: "Delivery", title: "Milestone Achieved",
            summary: `${safeStr(m?.milestone_name).trim() || "Milestone"} reached completion in the selected window.`,
            value_label: pct >= 100 ? "100% complete" : "Completed",
            project_id: pid || null, project_title: p?.title || null,
            href: pid ? hrefFor("milestones", pid, days) : null,
            happened_at: happenedAt || null, happened_at_uk: fmtDateUK(happenedAt),
          });
        }
      }
    }

    // 2) RAID mitigated/closed
    {
      const { data: ri, error } = await supabase
        .from("raid_items")
        .select("id, project_id, type, title, status, updated_at, public_id")
        .in("project_id", scopeProjectIds).gte("updated_at", since).limit(800);

      if (!error) {
        for (const r of ri || []) {
          const stRaw = safeStr(r?.status).trim(); const st = safeLower(stRaw);
          if (!(st === "mitigated" || st === "closed")) continue;
          const pid = safeStr(r?.project_id).trim();
          const p = projById.get(pid) || null;
          const kind = safeStr(r?.type).trim() || "RAID";
          const title = safeStr(r?.title).trim() || safeStr(r?.public_id).trim() || "RAID item";
          stories.push({
            id: `raid_${r.id}`, category: "Risk", title: `${kind} Resolved`,
            summary: `${title} was moved to ${stRaw || "Resolved"} in the last ${days} days.`,
            value_label: stRaw || "Resolved",
            project_id: pid || null, project_title: p?.title || null,
            href: pid ? hrefFor("raid", pid, days) : null,
            happened_at: safeStr(r?.updated_at).trim() || null,
            happened_at_uk: fmtDateUK(r?.updated_at),
          });
        }
      }
    }

    // 3) Change implemented/closed
    {
      const { data: cr, error } = await supabase
        .from("change_requests")
        .select("id, project_id, title, status, updated_at, public_id, decision_status, decision_at, delivery_status")
        .in("project_id", scopeProjectIds).gte("updated_at", since).limit(500);

      if (!error) {
        for (const c of cr || []) {
          const st = safeLower(c?.status); const ds = safeLower((c as any)?.delivery_status);
          if (!(st === "implemented" || st === "closed" || ds === "implemented" || ds === "closed")) continue;
          const pid = safeStr(c?.project_id).trim();
          const p = projById.get(pid) || null;
          const happenedAt = safeStr(c?.decision_at).trim() || safeStr(c?.updated_at).trim();
          stories.push({
            id: `cr_${c.id}`, category: "Governance", title: "Change Successfully Delivered",
            summary: `${safeStr(c?.title).trim() || "Change request"} reached ${safeStr(c?.status).trim() || safeStr((c as any)?.delivery_status).trim() || "implemented"} within the selected window.`,
            value_label: safeStr(c?.status).trim() || safeStr((c as any)?.delivery_status).trim() || "Implemented",
            project_id: pid || null, project_title: p?.title || null,
            href: pid ? hrefFor("change", pid, days) : null,
            happened_at: happenedAt || null, happened_at_uk: fmtDateUK(happenedAt),
          });
        }
      }
    }

    // 4) Positive lessons
    {
      const { data: ls, error } = await supabase
        .from("lessons_learned")
        .select("id, project_id, category, description, impact, is_published, published_at, created_at")
        .in("project_id", scopeProjectIds).gte("created_at", since).limit(500);

      if (!error) {
        for (const l of ls || []) {
          const impact = safeStr(l?.impact).trim();
          const published = Boolean(l?.is_published);
          const isPositive = impact === "Positive" || safeLower(l?.category) === "what_went_well";
          if (!published && !isPositive) continue;
          const pid = safeStr(l?.project_id).trim();
          const p = projById.get(pid) || null;
          const happenedAt = safeStr(l?.published_at).trim() || safeStr(l?.created_at).trim();
          stories.push({
            id: `lesson_${l.id}`, category: "Learning",
            title: published ? "Lesson Published" : "Positive Lesson Captured",
            summary: published
              ? "A lesson was published to strengthen delivery maturity and reuse what works."
              : "A positive learning was captured to reinforce successful delivery behaviours.",
            value_label: published ? "Published" : "Captured",
            project_id: pid || null, project_title: p?.title || null,
            href: pid ? hrefFor("lessons", pid, days) : null,
            happened_at: happenedAt || null, happened_at_uk: fmtDateUK(happenedAt),
          });
        }
      }
    }

    // 5) WBS items completed
    {
      const { data: wbs, error } = await supabase
        .from("wbs_items")
        .select("id, project_id, name, status, updated_at")
        .in("project_id", scopeProjectIds).gte("updated_at", since).limit(800);

      if (!error) {
        for (const w of wbs || []) {
          const st = safeLower(w?.status);
          if (!(st === "done" || st === "completed" || st === "closed")) continue;
          const pid = safeStr(w?.project_id).trim();
          const p = projById.get(pid) || null;
          stories.push({
            id: `wbs_${w.id}`, category: "Delivery", title: "Work Package Completed",
            summary: `${safeStr(w?.name).trim() || "WBS item"} was completed within the selected window.`,
            value_label: safeStr(w?.status).trim() || "Done",
            project_id: pid || null, project_title: p?.title || null,
            href: pid ? hrefFor("wbs", pid, days) : null,
            happened_at: safeStr(w?.updated_at).trim() || null,
            happened_at_uk: fmtDateUK(w?.updated_at),
          });
        }
      }
    }

    const filtered = category
      ? stories.filter((s) => safeLower(s.category) === safeLower(category))
      : stories;

    filtered.sort((a, b) => isoDateOnly(b.happened_at).localeCompare(isoDateOnly(a.happened_at)));
    for (const s of filtered) if (!s.happened_at_uk) s.happened_at_uk = fmtDateUK(s.happened_at) || null;

    return jsonOk({
      days,
      items: filtered.slice(0, 250),
      projects: allowedProjects.map((p) => ({ id: p.id, title: p.title })),
      meta: {
        scope: "org", organisation_id: orgId,
        projectCount: scopeProjectIds.length, since_iso: since,
        total_items: filtered.length,
      },
    });
  } catch (e: any) {
    const msg = e?.message || "Unknown error";
    if (safeLower(msg) === "unauthorized") return jsonErr("Unauthorized", 401);
    return jsonErr(msg, 500);
  }
}