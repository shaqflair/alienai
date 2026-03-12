// src/app/api/portfolio/raid-list/route.ts — REBUILT v4
// ✅ Org-scoped: all org members see portfolio-wide RAID items.
// ✅ Filters supported (GET + POST): name/code/pm/dept
// ✅ Active-only project filter (exclude closed/terminal) with FAIL-OPEN safeguard
// ✅ clampDays supports "all" → 60
// ✅ No-store cache on all responses.
// ✅ Project links prefer project_code (human id)
// ✅ Includes RAID public_id for display in dashboards / registers
// ✅ Uses shared resolvePortfolioScope() for org-wide dashboard scope

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ok(data: any, status = 200) {
  return noStore(NextResponse.json({ ok: true, ...data }, { status }));
}

function err(message: string, status = 400, meta?: any) {
  return noStore(NextResponse.json({ ok: false, error: message, meta }, { status }));
}

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

function clampDays(x: any, fallback = 30): 7 | 14 | 30 | 60 {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as 7 | 14 | 30 | 60) : (fallback as 7 | 14 | 30 | 60);
}

function safeScope(x: any) {
  const v = safeStr(x).trim().toLowerCase();
  return v === "window" || v === "overdue" || v === "all" ? v : "all";
}

function safeType(x: any) {
  const v = safeStr(x).trim();
  if (!v || v.toLowerCase() === "all") return "all";
  return new Set(["Risk", "Issue", "Assumption", "Dependency"]).has(v) ? v : "all";
}

function safeStatus(x: any) {
  const v = safeStr(x).trim().toLowerCase();
  if (!v || v === "all") return "all";
  const map: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    mitigated: "Mitigated",
    closed: "Closed",
    invalid: "Invalid",
  };
  return map[v] || "all";
}

function isoDateUTC(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate(),
  ).padStart(2, "0")}`;
}

function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}/${d.getUTCFullYear()}`;
}

function clamp01to100(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function currencySymbol(code: any) {
  const c = String(code || "GBP").trim().toUpperCase();
  if (c === "USD") return "$";
  if (c === "EUR") return "€";
  return "£";
}

function projectCodeLabel(pc: any): string {
  if (typeof pc === "string") return pc.trim();
  if (typeof pc === "number" && Number.isFinite(pc)) return String(pc);
  if (pc && typeof pc === "object") {
    const v =
      safeStr(pc.project_code) ||
      safeStr(pc.code) ||
      safeStr(pc.value) ||
      safeStr(pc.id);
    return v.trim();
  }
  return "";
}

function projectRef(project: any, projectIdFallback?: string | null) {
  const code = projectCodeLabel(project?.project_code);
  return code || safeStr(projectIdFallback).trim() || "";
}

function raidHref(project: any, projectIdFallback?: string | null) {
  const ref = projectRef(project, projectIdFallback);
  return ref ? `/projects/${encodeURIComponent(ref)}/raid` : null;
}

async function normalizeActiveIds(supabase: any, rawIds: string[]) {
  const failOpen = (reason: string) => ({
    ids: rawIds,
    ok: false,
    error: reason,
  });

  try {
    const r: any = await filterActiveProjectIds(supabase, rawIds);

    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && rawIds.length) {
        return failOpen("active filter returned 0 ids; failing open");
      }
      return { ids, ok: true, error: null as string | null };
    }

    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && rawIds.length) {
      return failOpen("active filter returned 0 ids; failing open");
    }
    return {
      ids,
      ok: !r?.error,
      error: r?.error ? safeStr(r.error?.message || r.error) : null,
    };
  } catch (e: any) {
    return failOpen(safeStr(e?.message || e || "active filter failed"));
  }
}

/* ---------------- filters ---------------- */

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
  const name = uniqStrings(
    url.searchParams.getAll("name").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );
  const code = uniqStrings(
    url.searchParams.getAll("code").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );
  const pm = uniqStrings(
    url.searchParams.getAll("pm").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );
  const dept = uniqStrings(
    url.searchParams.getAll("dept").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );

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
  const names = uniqStrings(
    f?.projectName ?? f?.projectNames ?? f?.name ?? f?.project_name,
  );
  const codes = uniqStrings(
    f?.projectCode ?? f?.projectCodes ?? f?.code ?? f?.project_code,
  );
  const pms = uniqStrings(
    f?.projectManagerId ?? f?.projectManagerIds ?? f?.pm ?? f?.project_manager_id,
  );
  const depts = uniqStrings(
    f?.department ?? f?.departments ?? f?.dept,
  );

  if (names.length) out.projectName = names;
  if (codes.length) out.projectCode = codes;
  if (pms.length) out.projectManagerId = pms;
  if (depts.length) out.department = depts;
  return out;
}

function looksMissingRelation(error: any) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function looksMissingColumn(error: any) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

/** Filter projects within candidate scope (best-effort if optional cols don't exist) */
async function applyProjectFilters(
  supabase: any,
  scopedProjectIds: string[],
  filters: PortfolioFilters,
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) return { projectIds: [], meta: { ...meta, applied: true } };
  if (!hasAnyFilters(filters)) return { projectIds: scopedProjectIds, meta };

  const selectSets = [
    "id, title, project_code, project_manager_id, department",
    "id, title, project_code, project_manager_id",
    "id, title, project_code, department",
    "id, title, project_code",
  ];

  let rows: any[] = [];
  let lastErr: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase
      .from("projects")
      .select(sel)
      .in("id", scopedProjectIds)
      .limit(20000);

    if (!error && Array.isArray(data)) {
      rows = data;
      lastErr = null;
      break;
    }
    lastErr = error;
    if (!(looksMissingRelation(error) || looksMissingColumn(error))) break;
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

    if (nameNeedles.length && !nameNeedles.some((needle) => title.includes(needle))) return false;
    if (codeNeedles.length && !codeNeedles.some((needle) => code.includes(needle))) return false;

    if (pmSet.size) {
      const pm = safeStr(p?.project_manager_id).trim();
      if (!pm || !pmSet.has(pm)) return false;
    }

    if (deptNeedles.length) {
      const dept = safeStr(p?.department).toLowerCase().trim();
      if (!dept || !deptNeedles.some((needle) => dept.includes(needle))) return false;
    }

    return true;
  });

  const outIds = filtered.map((p) => String(p?.id || "").trim()).filter(Boolean);
  meta.applied = true;
  meta.counts = { before: scopedProjectIds.length, after: outIds.length };
  return { projectIds: outIds, meta };
}

/* ---------------- core handler ---------------- */

async function handle(
  req: Request,
  opts: {
    scope: string;
    windowDays: 7 | 14 | 30 | 60;
    type: string;
    status: string;
    filters: PortfolioFilters;
  },
) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const userId = auth?.user?.id || null;
  if (authErr || !userId) return err("Not authenticated", 401);

  const sharedScope = await resolvePortfolioScope(userId);
  const organisationId = sharedScope.organisationId ?? null;
  const scopeMeta = sharedScope.meta ?? {};
  const scopedRaw: string[] = sharedScope.rawProjectIds ?? [];

  const active = await normalizeActiveIds(supabase, scopedRaw);
  const scopedActive = active.ids;

  const filtered = await applyProjectFilters(supabase, scopedActive, opts.filters);
  const projectIds = filtered.projectIds;

  if (!projectIds.length) {
    return ok({
      scope: opts.scope,
      windowDays: opts.windowDays,
      type: opts.type,
      status: opts.status,
      items: [],
      meta: {
        scope: "org",
        organisationId,
        projectCount: 0,
        active_only: true,
        scopeMeta,
        scopeCounts: {
          scopedIdsRaw: scopedRaw.length,
          scopedIdsActive: scopedActive.length,
          scopedIdsFiltered: 0,
        },
        active_filter_ok: active.ok,
        active_filter_error: active.error,
        filters: filtered.meta,
      },
    });
  }

  let q = supabase
    .from("raid_items")
    .select(
      `
      id, project_id, public_id, type, title, description, status, priority,
      probability, severity, due_date, owner_label,
      ai_rollup, ai_status, created_at, updated_at,
      projects:projects ( id, title, project_code )
    `,
    )
    .in("project_id", projectIds);

  if (opts.type !== "all") q = q.eq("type", opts.type);

  if (opts.status !== "all") {
    q = q.eq("status", opts.status);
  } else {
    q = q.not("status", "in", '("Closed","Invalid")');
  }

  const today = new Date();
  const todayStr = isoDateUTC(today);
  const toStr = isoDateUTC(
    new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + opts.windowDays)),
  );

  if (opts.scope === "window") q = q.gte("due_date", todayStr).lte("due_date", toStr);
  else if (opts.scope === "overdue") q = q.lt("due_date", todayStr);

  const { data, error } = await q
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) return err(error.message || "Query failed", 500);

  const rows = data || [];
  const ids = rows.map((r: any) => r.id).filter(Boolean);

  const scoreByItem = new Map<string, any>();
  const predByItem = new Map<string, any>();
  const finByItem = new Map<string, any>();

  if (ids.length) {
    const cap = Math.min(5000, ids.length * 10);
    const [scoresRes, predsRes, finsRes] = await Promise.all([
      supabase
        .from("raid_item_scores")
        .select("raid_item_id, score, components, model_version, scored_at")
        .in("raid_item_id", ids)
        .order("scored_at", { ascending: false })
        .limit(cap),

      supabase
        .from("raid_sla_predictions")
        .select("raid_item_id, breach_probability, days_to_breach, confidence, predicted_at")
        .in("raid_item_id", ids)
        .order("predicted_at", { ascending: false })
        .limit(cap),

      supabase
        .from("raid_financials")
        .select("raid_item_id, currency, est_cost_impact, est_revenue_at_risk, est_penalties")
        .in("raid_item_id", ids)
        .limit(ids.length),
    ]);

    for (const s of scoresRes.data || []) {
      const id = String((s as any).raid_item_id || "");
      if (id && !scoreByItem.has(id)) scoreByItem.set(id, s);
    }
    for (const p of predsRes.data || []) {
      const id = String((p as any).raid_item_id || "");
      if (id && !predByItem.has(id)) predByItem.set(id, p);
    }
    for (const f of finsRes.data || []) {
      const id = String((f as any).raid_item_id || "");
      if (id) finByItem.set(id, f);
    }
  }

  const items = rows.map((r: any) => {
    const ai = scoreByItem.get(r.id);
    const pred = predByItem.get(r.id);
    const fin = finByItem.get(r.id);

    const p = clamp01to100(r?.probability);
    const s = clamp01to100(r?.severity);

    const basicScore =
      r?.probability == null || r?.severity == null ? null : Math.round((p * s) / 100);
    const score = ai?.score ?? basicScore ?? null;

    const cur = String(fin?.currency ?? "GBP").toUpperCase();
    const due = r?.due_date ? String(r.due_date).slice(0, 10) : null;

    const codeLabel = projectCodeLabel(r?.projects?.project_code) || null;
    const publicId = safeStr(r?.public_id).trim() || null;

    return {
      id: r.id,
      public_id: publicId,

      project_id: r.project_id,
      project_title: r?.projects?.title || "Project",
      project_code: r?.projects?.project_code ?? null,
      project_code_label: codeLabel,

      type: r.type,
      title: r.title || r.description?.slice(0, 80) || "RAID item",
      description: r.description || "",
      status: r.status,
      priority: r.priority,

      probability: r.probability,
      severity: r.severity,

      score,
      score_source: ai ? "ai" : basicScore != null ? "basic" : null,
      score_tooltip: ai ? "AI-scored" : basicScore != null ? "P×S formula" : null,

      sla_breach_probability: pred?.breach_probability ?? null,
      sla_days_to_breach: pred?.days_to_breach ?? null,
      sla_confidence: pred?.confidence ?? null,

      currency: cur,
      currency_symbol: currencySymbol(cur),
      est_cost_impact: fin?.est_cost_impact ?? null,
      est_revenue_at_risk: fin?.est_revenue_at_risk ?? null,
      est_penalties: fin?.est_penalties ?? null,

      due_date: due,
      due_date_uk: fmtDateUK(due),
      owner_label: r.owner_label || "",

      ai_rollup: r.ai_rollup || "",
      ai_status: r.ai_status || "",

      created_at: r.created_at,
      updated_at: r.updated_at,

      href: raidHref(r?.projects, r?.project_id),
    };
  });

  return ok({
    scope: opts.scope,
    windowDays: opts.windowDays,
    type: opts.type,
    status: opts.status,
    items,
    meta: {
      scope: "org",
      organisationId,
      active_only: true,
      scopeMeta,
      projectCount: projectIds.length,
      scopeCounts: {
        scopedIdsRaw: scopedRaw.length,
        scopedIdsActive: scopedActive.length,
        scopedIdsFiltered: projectIds.length,
      },
      active_filter_ok: active.ok,
      active_filter_error: active.error,
      filters: filtered.meta,
    },
  });
}

/* ---------------- routes ---------------- */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);

    const scope = safeScope(url.searchParams.get("scope"));
    const windowDays = clampDays(url.searchParams.get("window"), 30);

    const type = safeType(url.searchParams.get("type"));
    const status = safeStatus(url.searchParams.get("status"));

    const filters = parseFiltersFromUrl(url);

    return await handle(req, { scope, windowDays, type, status, filters });
  } catch (e: any) {
    console.error("[GET /api/portfolio/raid-list]", e);
    return err(String(e?.message || e || "Failed"), 500);
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));

    const scope = safeScope(body?.scope ?? url.searchParams.get("scope"));
    const windowDays = clampDays(body?.window ?? body?.windowDays ?? url.searchParams.get("window"), 30);

    const type = safeType(body?.type ?? url.searchParams.get("type"));
    const status = safeStatus(body?.status ?? url.searchParams.get("status"));

    const filters = parseFiltersFromBody(body);

    return await handle(req, { scope, windowDays, type, status, filters });
  } catch (e: any) {
    console.error("[POST /api/portfolio/raid-list]", e);
    return err(String(e?.message || e || "Failed"), 500);
  }
}