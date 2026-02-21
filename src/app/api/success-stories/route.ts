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

/** ISO timestamp for query filters */
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

/* ---------------- org scope helpers ---------------- */

async function requireUser(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function resolveActiveOrgId(supabase: any, userId: string): Promise<string | null> {
  // ✅ Next 16: cookies() is async
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

function projectRef(p: AllowedProject | undefined | null) {
  // ✅ prefer project_code for routes, fallback to UUID
  return safeStr(p?.project_code).trim() || safeStr(p?.id).trim();
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

function hrefFor(kind: "milestones" | "raid" | "change" | "lessons" | "wbs", projectRouteId: string, days: number) {
  if (!projectRouteId) return null;

  if (kind === "wbs") return `/projects/${projectRouteId}/wbs?days=${days}`;
  if (kind === "milestones") return `/projects/${projectRouteId}/schedule?days=${days}`;
  if (kind === "raid") return `/projects/${projectRouteId}/raid?days=${days}`;
  if (kind === "change") return `/projects/${projectRouteId}/changes?days=${days}`;
  if (kind === "lessons") return `/projects/${projectRouteId}/lessons?days=${days}`;

  return `/projects/${projectRouteId}`;
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const projectId = safeStr(url.searchParams.get("projectId")).trim(); // UUID (from dropdown)
    const category = safeStr(url.searchParams.get("category")).trim();
    const fv = asNum(url.searchParams.get("fv")); // optional: forecast variance passed from tile

    const orgId = await resolveActiveOrgId(supabase, user.id);
    if (!orgId) {
      return jsonOk({
        days,
        items: [],
        projects: [],
        meta: { project_count: 0, since_iso: sinceIso(days), scope: "org:none" },
      });
    }

    const allowedProjects = await loadOrgProjects(supabase, orgId);
    const allowedIds = new Set(allowedProjects.map((p) => p.id));

    if (projectId && !allowedIds.has(projectId)) {
      // Do not leak existence of other org projects
      return jsonOk({
        days,
        items: [],
        projects: allowedProjects.map((p) => ({ id: p.id, title: p.title })),
        meta: { project_count: allowedProjects.length, since_iso: sinceIso(days), scope: "org" },
      });
    }

    const scopeProjectIds = projectId ? [projectId] : allowedProjects.map((p) => p.id);
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
        href: "/success-stories",
        happened_at: nowIso,
        happened_at_uk: fmtDateUK(nowIso),
      });
    }

    // helper: project lookup
    const projById = new Map<string, AllowedProject>();
    for (const p of allowedProjects) projById.set(p.id, p);

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
          const st = safeLower(m?.status);
          const pct = Number(m?.progress_pct ?? 0);
          const isDone = st === "completed" || st === "done" || st === "closed" || pct >= 100;
          if (!isDone) continue;

          const pid = safeStr(m?.project_id).trim();
          const p = projById.get(pid) || null;

          const happenedAt = safeStr(m?.end_date).trim() || safeStr(m?.updated_at).trim();
          const routeId = projectRef(p);

          stories.push({
            id: `milestone_${m.id}`,
            category: "Delivery",
            title: "Milestone Achieved",
            summary: `${safeStr(m?.milestone_name).trim() || "Milestone"} reached completion in the selected window.`,
            value_label: pct >= 100 ? "100% complete" : "Completed",
            project_id: pid || null,
            project_title: p?.title || null,
            href: routeId ? hrefFor("milestones", routeId, days) : null,
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
          const stRaw = safeStr(r?.status).trim();
          const st = safeLower(stRaw);
          const isWin = st === "mitigated" || st === "closed";
          if (!isWin) continue;

          const pid = safeStr(r?.project_id).trim();
          const p = projById.get(pid) || null;

          const kind = safeStr(r?.type).trim() || "RAID";
          const title = safeStr(r?.title).trim() || safeStr(r?.public_id).trim() || "RAID item";
          const happenedAt = safeStr(r?.updated_at).trim();
          const routeId = projectRef(p);

          stories.push({
            id: `raid_${r.id}`,
            category: "Risk",
            title: `${kind} Resolved`,
            summary: `${title} was moved to ${stRaw || "Resolved"} in the last ${days} days.`,
            value_label: stRaw || "Resolved",
            project_id: pid || null,
            project_title: p?.title || null,
            href: routeId ? hrefFor("raid", routeId, days) : null,
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
        .select("id, project_id, title, status, updated_at, public_id, decision_status, decision_at, delivery_status")
        .in("project_id", scopeProjectIds)
        .gte("updated_at", since)
        .limit(500);

      if (!error) {
        for (const c of cr || []) {
          const st = safeLower(c?.status);
          const ds = safeLower((c as any)?.delivery_status);
          const isImplemented = st === "implemented" || st === "closed" || ds === "implemented" || ds === "closed";
          if (!isImplemented) continue;

          const pid = safeStr(c?.project_id).trim();
          const p = projById.get(pid) || null;

          const happenedAt = safeStr(c?.decision_at).trim() || safeStr(c?.updated_at).trim();
          const routeId = projectRef(p);

          stories.push({
            id: `cr_${c.id}`,
            category: "Governance",
            title: "Change Successfully Delivered",
            summary: `${safeStr(c?.title).trim() || "Change request"} reached ${
              safeStr(c?.status).trim() || safeStr((c as any)?.delivery_status).trim() || "implemented"
            } within the selected window.`,
            value_label: safeStr(c?.status).trim() || safeStr((c as any)?.delivery_status).trim() || "Implemented",
            project_id: pid || null,
            project_title: p?.title || null,
            href: routeId ? hrefFor("change", routeId, days) : null,
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
          const impact = safeStr(l?.impact).trim();
          const published = Boolean(l?.is_published);
          const isPositive = impact === "Positive" || safeLower(l?.category) === "what_went_well";

          if (!published && !isPositive) continue;

          const pid = safeStr(l?.project_id).trim();
          const p = projById.get(pid) || null;

          const happenedAt = safeStr(l?.published_at).trim() || safeStr(l?.created_at).trim();
          const routeId = projectRef(p);

          stories.push({
            id: `lesson_${l.id}`,
            category: "Learning",
            title: published ? "Lesson Published" : "Positive Lesson Captured",
            summary: published
              ? "A lesson was published to strengthen delivery maturity and reuse what works."
              : "A positive learning was captured to reinforce successful delivery behaviours.",
            value_label: published ? "Published" : "Captured",
            project_id: pid || null,
            project_title: p?.title || null,
            href: routeId ? hrefFor("lessons", routeId, days) : null,
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
          const st = safeLower(w?.status);
          if (!(st === "done" || st === "completed" || st === "closed")) continue;

          const pid = safeStr(w?.project_id).trim();
          const p = projById.get(pid) || null;

          const happenedAt = safeStr(w?.updated_at).trim();
          const routeId = projectRef(p);

          stories.push({
            id: `wbs_${w.id}`,
            category: "Delivery",
            title: "Work Package Completed",
            summary: `${safeStr(w?.name).trim() || "WBS item"} was completed within the selected window.`,
            value_label: safeStr(w?.status).trim() || "Done",
            project_id: pid || null,
            project_title: p?.title || null,
            href: routeId ? hrefFor("wbs", routeId, days) : null,
            happened_at: happenedAt || null,
            happened_at_uk: fmtDateUK(happenedAt),
          });
        }
      }
    }

    // Category filter
    const filtered = category
      ? stories.filter((s) => safeLower(s.category) === safeLower(category))
      : stories;

    // Sort newest first (robust)
    filtered.sort((a, b) => isoDateOnly(b.happened_at).localeCompare(isoDateOnly(a.happened_at)));

    // ensure UK date always present
    for (const s of filtered) {
      if (!s.happened_at_uk) s.happened_at_uk = fmtDateUK(s.happened_at) || null;
    }

    return jsonOk({
      days,
      items: filtered.slice(0, 250),
      // ✅ dropdown should remain UUID-based (stable), but still org-scoped
      projects: allowedProjects.map((p) => ({ id: p.id, title: p.title })),
      meta: {
        scope: "org",
        organisation_id: orgId,
        project_count: scopeProjectIds.length,
        since_iso: since,
      },
    });
  } catch (e: any) {
    return jsonErr(e?.message || "Unknown error", 500);
  }
}
