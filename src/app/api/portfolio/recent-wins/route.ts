// src/app/api/portfolio/recent-wins/route.ts — REBUILT v3 (ORG-WIDE + filter-ready)
// Adds:
//   ✅ RW-F1: Uses resolveOrgActiveProjectScope (org-wide dashboard scope, still RLS-safe)
//   ✅ RW-F2: Supports dashboard filters (project name, code, PM, department)
//            - POST (recommended): { days, limit, filters }
//            - GET (compat): ?days=7&limit=8&name=...&code=...&pm=...&dept=...
//   ✅ RW-F3: Best-effort join (projects) with safe fallback if FK hint/schema differs
//
// Notes:
//   • Returns "wins" from project_milestones within last N days (completed milestones feed)

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope } from "@/lib/server/project-scope";

/* ---------------- utils ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniqStrings(xs: any): string[] {
  const arr = Array.isArray(xs) ? xs : xs == null ? [] : [xs];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const s = safeStr(v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function projectCodeLabel(pc: any): string {
  if (typeof pc === "string") return pc.trim();
  if (typeof pc === "number" && Number.isFinite(pc)) return String(pc);
  if (pc && typeof pc === "object") {
    const v = safeStr(pc.project_code) || safeStr(pc.code) || safeStr(pc.value) || safeStr(pc.id);
    return v.trim();
  }
  return "";
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

type PortfolioFilters = {
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

function hasAnyFilters(f: PortfolioFilters) {
  return (
    (f.projectName && f.projectName.length) ||
    (f.projectCode && f.projectCode.length) ||
    (f.projectManagerId && f.projectManagerId.length) ||
    (f.department && f.department.length)
  );
}

function parseFiltersFromUrl(url: URL): PortfolioFilters {
  const name = uniqStrings(url.searchParams.getAll("name").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const code = uniqStrings(url.searchParams.getAll("code").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const pm = uniqStrings(url.searchParams.getAll("pm").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const dept = uniqStrings(url.searchParams.getAll("dept").flatMap((x) => x.split(",")).map((s) => s.trim()));

  const out: PortfolioFilters = {};
  if (name.length) out.projectName = name;
  if (code.length) out.projectCode = code;
  if (pm.length) out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
}

function parseFiltersFromBody(body: any): PortfolioFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? null;
  const out: PortfolioFilters = {};
  const names = uniqStrings(f?.projectName ?? f?.projectNames ?? f?.name ?? f?.project_name);
  const codes = uniqStrings(f?.projectCode ?? f?.projectCodes ?? f?.code ?? f?.project_code);
  const pms = uniqStrings(f?.projectManagerId ?? f?.projectManagerIds ?? f?.pm ?? f?.project_manager_id);
  const depts = uniqStrings(f?.department ?? f?.departments ?? f?.dept);

  if (names.length) out.projectName = names;
  if (codes.length) out.projectCode = codes;
  if (pms.length) out.projectManagerId = pms;
  if (depts.length) out.department = depts;
  return out;
}

// Filter projects *within* user scope, best-effort even if optional columns don't exist.
async function applyProjectFilters(supabase: any, scopedProjectIds: string[], filters: PortfolioFilters) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) return { projectIds: [], meta: { ...meta, applied: true } };
  if (!hasAnyFilters(filters)) return { projectIds: scopedProjectIds, meta };

  const selectSets = [
    "id, title, project_code, project_manager_id, department, colour",
    "id, title, project_code, project_manager_id, colour",
    "id, title, project_code, department, colour",
    "id, title, project_code, colour",
  ];

  let rows: any[] = [];
  let lastErr: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase.from("projects").select(sel).in("id", scopedProjectIds).limit(10000);
    if (!error && Array.isArray(data)) {
      rows = data;
      lastErr = null;
      break;
    }
    lastErr = error;
    if (!looksMissingRelation(error)) break;
  }

  if (!rows.length) {
    meta.applied = true;
    meta.notes.push("Could not read projects for filtering; falling back to unfiltered scope.");
    if (lastErr?.message) meta.notes.push(lastErr.message);
    return { projectIds: scopedProjectIds, meta };
  }

  const nameNeedles = (filters.projectName ?? []).map((s) => s.toLowerCase());
  const codeNeedles = (filters.projectCode ?? []).map((s) => s.toLowerCase());
  const pmSet = new Set((filters.projectManagerId ?? []).map((s) => s));
  const deptNeedles = (filters.department ?? []).map((s) => s.toLowerCase());

  const filtered = rows.filter((p) => {
    const title = safeStr(p?.title).toLowerCase();
    const code = projectCodeLabel(p?.project_code).toLowerCase();

    if (nameNeedles.length && !nameNeedles.some((n) => title.includes(n))) return false;
    if (codeNeedles.length && !codeNeedles.some((c) => code.includes(c))) return false;

    if (pmSet.size) {
      const pm = safeStr(p?.project_manager_id).trim();
      if (!pm) return false;
      if (!pmSet.has(pm)) return false;
    }

    if (deptNeedles.length) {
      const dept = safeStr(p?.department).toLowerCase().trim();
      if (!dept) return false;
      if (!deptNeedles.some((d) => dept.includes(d))) return false;
    }

    return true;
  });

  const outIds = filtered.map((p) => String(p?.id || "").trim()).filter(Boolean);
  meta.applied = true;
  meta.counts = { before: scopedProjectIds.length, after: outIds.length };
  return { projectIds: outIds, meta };
}

function isoYmd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/* ---------------- handler ---------------- */

async function handle(req: NextRequest, opts: { days: number; limit: number; filters: PortfolioFilters }) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr || !user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const days = Math.min(30, Math.max(1, Number.isFinite(opts.days) ? opts.days : 7));
  const limit = Math.min(20, Math.max(1, Number.isFinite(opts.limit) ? opts.limit : 8));

  // ORG-wide dashboard scope
  const scoped = await resolveOrgActiveProjectScope(supabase, user.id);
  const scopedProjectIds: string[] = Array.isArray(scoped?.projectIds) ? scoped.projectIds : [];

  // Apply dashboard filters within scope
  const filtered = await applyProjectFilters(supabase, scopedProjectIds, opts.filters);
  const projectIds = filtered.projectIds;

  if (!projectIds.length) {
    const res = NextResponse.json(
      {
        ok: true,
        wins: [],
        days,
        count: 0,
        meta: { organisationId: scoped?.organisationId ?? null, scope: scoped?.meta ?? null, filters: filtered.meta },
      },
      { status: 200 },
    );
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  // Date window
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceIso = isoYmd(since);
  const todayIso = isoYmd(new Date());

  // Fetch milestones for scoped+filtered projects
  // Try join first (to enrich project details); fallback to separate project lookup.
  let milestones: any[] = [];
  let joinOk = false;

  const joinAttempt = await supabase
    .from("project_milestones")
    .select(
      `
      id, title, due_date,
      type,
      project_id,
      projects (
        id,
        title,
        project_code,
        colour
      )
    `,
    )
    .in("project_id", projectIds)
    .gte("due_date", sinceIso).lte("due_date", todayIso)
    .order("date", { ascending: false })
    .limit(limit * 4);

  if (!joinAttempt.error && Array.isArray(joinAttempt.data)) {
    milestones = joinAttempt.data;
    joinOk = true;
  } else {
    // Fallback: no join (FK not present / RLS issues / relationship name mismatch)
    const raw = await supabase
      .from("project_milestones")
      .select("id, title, due_date, type, project_id")
      .in("project_id", projectIds)
      .gte("due_date", sinceIso).lte("due_date", todayIso)
      .order("date", { ascending: false })
      .limit(limit);

    milestones = Array.isArray(raw.data) ? raw.data : [];
    joinOk = false;
  }

  // If join wasn't ok, fetch project details separately for enrichment
  const projById = new Map<string, any>();
  if (!joinOk && milestones.length) {
    const ids = uniqStrings(milestones.map((m: any) => m?.project_id));
    const { data: prows } = await supabase.from("projects").select("id, title, project_code, colour").in("id", ids).limit(10000);
    for (const p of prows ?? []) projById.set(String((p as any).id), p);
  }

  const wins = (milestones ?? [])
    .slice(0, limit)
    .map((m: any) => {
      const p = joinOk ? (m.projects as any) : projById.get(String(m.project_id)) ?? null;

      const code = p?.project_code ? projectCodeLabel(p.project_code) : "";
      const ref = code || safeStr(p?.id || m.project_id).trim();

      return {
        id: String(m.id),
        title: String(m.title || "Milestone"),
        date: String(m.due_date),
        type: String(m.type || "other"),
        project_id: String(m.project_id),
        project_code: code || null,
        project_name: p?.title ? String(p.title) : null,
        project_colour: p?.colour ? String(p.colour) : "#00b8db",
        link: ref ? `/projects/${encodeURIComponent(ref)}` : null,
      };
    });

  const res = NextResponse.json({
    ok: true,
    wins,
    days,
    count: wins.length,
    meta: {
      organisationId: scoped?.organisationId ?? null,
      scope: scoped?.meta ?? null,
      filters: filtered.meta,
      join: { ok: joinOk, error: joinAttempt.error ? safeStr(joinAttempt.error.message) : null },
      window: { since: sinceIso, to: todayIso },
    },
  });

  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

/* ---------------- routes ---------------- */

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") ?? "7", 10);
    const limit = parseInt(url.searchParams.get("limit") ?? "8", 10);
    const filters = parseFiltersFromUrl(url);
    return await handle(req, { days, limit, filters });
  } catch (e: any) {
    console.error("[recent-wins][GET]", e);
    const res = NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = parseInt(String(body?.days ?? body?.windowDays ?? 7), 10);
    const limit = parseInt(String(body?.limit ?? 8), 10);
    const filters = parseFiltersFromBody(body);
    return await handle(req, { days, limit, filters });
  } catch (e: any) {
    console.error("[recent-wins][POST]", e);
    const res = NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}

