// src/app/api/portfolio/raid-exec-summary/route.ts — REBUILT v11
// Fixes / Adds:
//   ✅ RES-F1: ORG-WIDE project scope via shared resolvePortfolioScope(supabase, userId)
//   ✅ RES-F2: clampDays supports "all" → 60 (HomePage sends days=all)
//   ✅ RES-F3: Cache-Control: no-store across ALL responses (json + md/pdf/pptx downloads)
//   ✅ RES-F4: Supports dashboard filters (GET): name, code, pm, dept
//   ✅ RES-F5: Project links prefer project_code (human id) over UUID (fallback to UUID if missing)
//   ✅ RES-F6: Active-only filter uses filterActiveProjectIds but FAIL-OPEN if helper returns 0 / errors
//   ✅ RES-F7: resolveOrgName tries active org first (if profiles.active_organisation_id exists), otherwise membership fallback
//   ✅ RES-F8: Includes RAID public_id in executive items / exports
//   ✅ RES-F9: Removes duplicated org-scope resolution logic from route body
//   ✅ RES-F10: resolvePortfolioScope signature fixed everywhere
// Keeps:
//   ✅ resolveClientNameFromProjects fixed select("id, client_name")
//   ✅ Puppeteer/Chromium pdf generation + PPTX generation

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime = "nodejs";
export const maxDuration = 60;

/* ---------------- branding ---------------- */

const BRAND_LOGO_URL =
  "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200, headers?: HeadersInit) {
  const res = NextResponse.json({ ok: true, ...data }, { status, headers });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

/* ---------------- utils ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function clampDays(x: any) {
  const s = safeStr(x).trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

function clampScope(x: any) {
  const v = safeStr(x).trim().toLowerCase();
  return v === "all" || v === "overdue" || v === "window" ? v : "window";
}

function clampFormat(x: any) {
  const v = safeStr(x).trim().toLowerCase();
  if (v === "pdf") return "pdf";
  if (v === "md") return "md";
  if (v === "pptx") return "pptx";
  return "pdf";
}

function n(x: any, fallback: number | null = null) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function clamp01to100(v: any) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function moneyGBP(x: any) {
  const v = Number(x || 0);
  if (!Number.isFinite(v)) return "—";
  return "£" + Math.round(v).toLocaleString("en-GB");
}

function fmtUkDateTime(x: any) {
  if (!x) return "—";
  const d = new Date(String(x));
  if (Number.isNaN(d.getTime())) return safeStr(x) || "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtUkDate(x: any) {
  if (!x) return "—";
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return safeStr(x) || "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isoDateUTC(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeFilename(name: string) {
  return String(name || "portfolio_raid_brief")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
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
    const v =
      safeStr(pc.project_code) ||
      safeStr(pc.code) ||
      safeStr(pc.value) ||
      safeStr(pc.id);
    return v.trim();
  }
  return "";
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

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

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

/* ---------------- types ---------------- */

type ExecItem = {
  id: string;
  public_id?: string | null;
  project_id?: string | null;
  project_title?: string | null;
  project_code_label?: string | null;
  type?: string | null;
  title?: string | null;
  score?: number | null;
  due_date?: string | null;
  owner_label?: string | null;
  sla_breach_probability?: number | null;
  sla_days_to_breach?: number | null;
  sla_confidence?: number | null;
  exposure_total?: number | null;
  exposure_total_fmt?: string | null;
  overdue?: boolean | null;
  note?: string | null;
  prompt?: string | null;
  href?: string | null;
};

type ExecSection = { key: string; title: string; items: ExecItem[] };

type ExecSummary = {
  ok: true;
  org_name?: string | null;
  client_name?: string | null;
  scope: string;
  days: number;
  top: number;
  summary: { headline: string; generated_at: string };
  kpis: {
    total_items: number;
    overdue_open: number;
    high_score: number;
    sla_hot: number;
    exposure_total: number;
    exposure_total_fmt?: string;
  };
  wow?: { week_start?: string | null; prev_week_start?: string | null; narrative?: string[] } | null;
  sections: ExecSection[];
  meta?: any;
};

/* ---------------- data helpers ---------------- */

async function resolveOrgName(supabase: any, userId: string) {
  try {
    const { data: prof, error: pErr } = await supabase
      .from("profiles")
      .select("active_organisation_id")
      .eq("user_id", userId)
      .maybeSingle();

    const activeOrgId = safeStr(prof?.active_organisation_id).trim();
    if (!pErr && activeOrgId) {
      const { data: orgRow, error: oErr } = await supabase
        .from("organisations")
        .select("id,name")
        .eq("id", activeOrgId)
        .maybeSingle();
      if (!oErr) {
        const nm = safeStr(orgRow?.name).trim();
        if (nm) return nm;
      }
    }
  } catch {
    // ignore
  }

  try {
    const { data, error } = await supabase
      .from("organisation_members")
      .select("organisation_id, organisations:organisations(id,name)")
      .eq("user_id", userId)
      .is("removed_at", null)
      .limit(5);

    if (error) return null;

    const row = (data || [])[0] as any;
    const name = row?.organisations?.name ?? null;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

async function resolveClientNameFromProjects(supabase: any, projectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, client_name")
      .in("id", projectIds)
      .limit(2000);

    if (error) return null;

    const names = (data || [])
      .map((p: any) => safeStr(p?.client_name).trim())
      .filter(Boolean);

    if (!names.length) return null;

    const set = new Set(names);
    if (set.size === 1) return Array.from(set)[0];
    return "Multiple clients";
  } catch {
    return null;
  }
}

async function normalizeActiveIdsFailOpen(supabase: any, baseIds: string[]) {
  const failOpen = (reason: string) => ({ ids: baseIds, ok: false, error: reason });

  try {
    const r: any = await filterActiveProjectIds(supabase, baseIds);

    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && baseIds.length) {
        return failOpen("active filter returned 0 ids; failing open");
      }
      return { ids, ok: true, error: null as string | null };
    }

    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    const ok = r?.ok !== false;
    const errMsg = r?.error ? safeStr(r.error?.message || r.error) : null;

    if (!ids.length && baseIds.length) {
      return failOpen(errMsg || "active filter returned 0 ids; failing open");
    }
    return { ids, ok, error: errMsg };
  } catch (e: any) {
    return failOpen(safeStr(e?.message || e || "active filter failed"));
  }
}

async function buildExecSummary(args: {
  supabase: any;
  userId: string;
  scope: string;
  days: number;
  top: number;
  filters: PortfolioFilters;
}): Promise<ExecSummary | { ok: false; error: string; meta?: any }> {
  const { supabase, userId, scope, days, top, filters } = args;

  const meta: any = { scope_source: null, filters: null };

  const sharedScope = await resolvePortfolioScope(supabase, userId);
  const baseProjectIds = uniqStrings(
    Array.isArray(sharedScope?.rawProjectIds)
      ? sharedScope.rawProjectIds
      : Array.isArray(sharedScope?.projectIds)
        ? sharedScope.projectIds
        : [],
  );

  meta.scope_source = {
    kind: "resolvePortfolioScope",
    ok: Boolean(baseProjectIds.length),
    meta: sharedScope?.meta ?? null,
  };
  meta.organisationId = sharedScope?.organisationId ?? null;

  if (!baseProjectIds.length) {
    return { ok: false, error: "No accessible projects found.", meta };
  }

  const active = await normalizeActiveIdsFailOpen(supabase, baseProjectIds);
  const activeProjectIds = uniqStrings(active.ids || []);
  meta.active_filter = {
    before: baseProjectIds.length,
    after: activeProjectIds.length,
    ok: active.ok,
    error: active.error ?? null,
  };

  if (!activeProjectIds.length) {
    return { ok: false, error: "No active projects found.", meta };
  }

  const filtered = await applyProjectFilters(supabase, activeProjectIds, filters);
  meta.filters = filtered.meta;

  const projectIds = filtered.projectIds;

  if (!projectIds.length) {
    return {
      ok: true,
      org_name:
        (await resolveOrgName(supabase, userId)) ||
        safeStr(process.env.ORG_NAME || process.env.NEXT_PUBLIC_ORG_NAME).trim() ||
        null,
      client_name: null,
      scope,
      days,
      top,
      summary: {
        headline: hasAnyFilters(filters)
          ? "No RAID items: no projects matched the selected filters."
          : "No RAID items match the selected horizon.",
        generated_at: new Date().toISOString(),
      },
      kpis: {
        total_items: 0,
        overdue_open: 0,
        high_score: 0,
        sla_hot: 0,
        exposure_total: 0,
        exposure_total_fmt: moneyGBP(0),
      },
      wow: null,
      sections: [
        { key: "top_score", title: "Top Risks by Score", items: [] },
        { key: "sla_hot", title: "SLA Breach Watchlist", items: [] },
        { key: "exposure", title: "Financial Exposure Hotspots", items: [] },
        { key: "decisions", title: "Decisions Required (Next Actions)", items: [] },
      ],
      meta: {
        ...meta,
        projectCounts: {
          base: baseProjectIds.length,
          active: activeProjectIds.length,
          filtered: 0,
        },
      },
    };
  }

  const [dbOrg, dbClient] = await Promise.all([
    resolveOrgName(supabase, userId),
    resolveClientNameFromProjects(supabase, projectIds),
  ]);

  const org_name =
    dbOrg ||
    safeStr(process.env.ORG_NAME || process.env.NEXT_PUBLIC_ORG_NAME).trim() ||
    null;
  const client_name = (dbClient || null) as string | null;

  const today = new Date();
  const todayStr = isoDateUTC(today);
  const to = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days),
  );
  const toStr = isoDateUTC(to);

  let raidQ = supabase
    .from("raid_items")
    .select(
      `
      id,
      public_id,
      project_id,
      type,
      title,
      description,
      status,
      priority,
      probability,
      severity,
      due_date,
      owner_label,
      ai_rollup,
      projects:projects ( id, title, project_code )
    `,
    )
    .in("project_id", projectIds);

  if (scope === "window") {
    raidQ = raidQ.gte("due_date", todayStr).lte("due_date", toStr);
  } else if (scope === "overdue") {
    raidQ = raidQ.lt("due_date", todayStr);
    raidQ = raidQ.not("status", "ilike", "closed");
    raidQ = raidQ.not("status", "ilike", "invalid");
  }

  const { data: raidRows, error: raidErr } = await raidQ.limit(5000);
  if (raidErr) return { ok: false, error: raidErr.message, meta };

  const rows = raidRows || [];
  const raidItemIds = rows.map((r: any) => r.id).filter(Boolean);

  const scoreByItem = new Map<string, any>();
  if (raidItemIds.length) {
    const { data: scores } = await supabase
      .from("raid_item_scores")
      .select("raid_item_id, score, components, model_version, scored_at")
      .in("raid_item_id", raidItemIds)
      .order("scored_at", { ascending: false })
      .limit(10000);

    for (const s of scores || []) {
      const id = String((s as any).raid_item_id || "");
      if (id && !scoreByItem.has(id)) scoreByItem.set(id, s);
    }
  }

  const predByItem = new Map<string, any>();
  if (raidItemIds.length) {
    const { data: preds } = await supabase
      .from("raid_sla_predictions")
      .select(
        "raid_item_id, breach_probability, days_to_breach, confidence, drivers, model_version, predicted_at",
      )
      .in("raid_item_id", raidItemIds)
      .order("predicted_at", { ascending: false })
      .limit(10000);

    for (const p of preds || []) {
      const id = String((p as any).raid_item_id || "");
      if (id && !predByItem.has(id)) predByItem.set(id, p);
    }
  }

  const finByItem = new Map<string, any>();
  if (raidItemIds.length) {
    const { data: fins } = await supabase
      .from("raid_financials")
      .select(
        "raid_item_id, currency, est_cost_impact, est_schedule_days, est_revenue_at_risk, est_penalties, updated_at",
      )
      .in("raid_item_id", raidItemIds)
      .limit(10000);

    for (const f of fins || []) {
      const id = String((f as any).raid_item_id || "");
      if (id) finByItem.set(id, f);
    }
  }

  const enriched: ExecItem[] = rows.map((r: any) => {
    const due = r?.due_date ? String(r.due_date).slice(0, 10) : null;
    const st = String(r?.status || "").toLowerCase();
    const overdue = Boolean(due && due < todayStr && !["closed", "invalid"].includes(st));

    const p = clamp01to100(r?.probability);
    const s = clamp01to100(r?.severity);
    const basicScore =
      r?.probability == null || r?.severity == null ? null : Math.round((p * s) / 100);

    const aiScore = scoreByItem.get(r.id) || null;
    const pred = predByItem.get(r.id) || null;
    const fin = finByItem.get(r.id) || null;

    const score = aiScore?.score ?? basicScore ?? null;

    const cost = fin?.est_cost_impact ?? 0;
    const rev = fin?.est_revenue_at_risk ?? 0;
    const pen = fin?.est_penalties ?? 0;
    const exposure_total = (n(cost, 0) || 0) + (n(rev, 0) || 0) + (n(pen, 0) || 0);
    const exposure_total_fmt = exposure_total > 0 ? moneyGBP(exposure_total) : null;

    const codeLabel = projectCodeLabel(r?.projects?.project_code) || null;
    const ref = codeLabel || safeStr(r.project_id).trim();
    const publicId = safeStr(r?.public_id).trim() || null;

    return {
      id: String(r.id),
      public_id: publicId,
      project_id: r.project_id,
      project_title: r?.projects?.title || "Project",
      project_code_label: codeLabel,
      type: r.type || null,
      title: r.title || r.description?.slice(0, 120) || "RAID item",
      due_date: due,
      owner_label: r.owner_label || "",
      score,
      sla_breach_probability: pred?.breach_probability ?? null,
      sla_days_to_breach: pred?.days_to_breach ?? null,
      sla_confidence: pred?.confidence ?? null,
      exposure_total,
      exposure_total_fmt,
      overdue,
      note: r.ai_rollup ? String(r.ai_rollup).slice(0, 240) : null,
      href: ref ? `/projects/${encodeURIComponent(ref)}/raid` : null,
    };
  });

  const total_items = enriched.length;
  const overdue_open = enriched.filter((x) => x.overdue).length;
  const high_score = enriched.filter((x) => (n(x.score, 0) || 0) >= 70).length;
  const sla_hot = enriched.filter((x) => {
    const bp = n(x.sla_breach_probability, -1) ?? -1;
    const dtb = x.sla_days_to_breach == null ? null : n(x.sla_days_to_breach, null);
    return bp >= 70 || (dtb != null && dtb <= 7);
  }).length;
  const exposure_total = enriched.reduce((acc, x) => acc + (n(x.exposure_total, 0) || 0), 0);

  const headline =
    total_items === 0
      ? "No RAID items match the selected horizon."
      : overdue_open > 0 || high_score > 0 || sla_hot > 0
        ? `Priority focus: ${overdue_open} overdue, ${high_score} high-scoring, ${sla_hot} SLA-hot item(s) within the next ${days} days.`
        : `Stable window: ${total_items} item(s) reviewed with no critical flags for the next ${days} days.`;

  const byScore = [...enriched]
    .filter((x) => x.score != null)
    .sort((a, b) => (n(b.score, 0) || 0) - (n(a.score, 0) || 0))
    .slice(0, top);

  const bySla = [...enriched]
    .filter((x) => x.sla_breach_probability != null || x.sla_days_to_breach != null)
    .sort((a, b) => {
      const abp = n(a.sla_breach_probability, -1) ?? -1;
      const bbp = n(b.sla_breach_probability, -1) ?? -1;
      if (bbp !== abp) return bbp - abp;
      const ad =
        a.sla_days_to_breach == null
          ? 9999
          : (n(a.sla_days_to_breach, 9999) as number);
      const bd =
        b.sla_days_to_breach == null
          ? 9999
          : (n(b.sla_days_to_breach, 9999) as number);
      return ad - bd;
    })
    .slice(0, top)
    .map((x) => ({
      ...x,
      note:
        x.sla_breach_probability != null
          ? `SLA breach probability ${x.sla_breach_probability}%${x.sla_days_to_breach != null ? ` • ~${x.sla_days_to_breach} day(s)` : ""}.`
          : x.note,
    }));

  const byExposure = [...enriched]
    .filter((x) => (n(x.exposure_total, 0) || 0) > 0)
    .sort((a, b) => (n(b.exposure_total, 0) || 0) - (n(a.exposure_total, 0) || 0))
    .slice(0, top)
    .map((x) => ({
      ...x,
      note: `Exposure ${x.exposure_total_fmt || "—"} (cost + revenue risk + penalties).`,
    }));

  const decisions = [...enriched]
    .filter((x) => x.overdue || (x.due_date && x.due_date <= toStr))
    .sort((a, b) => {
      if (a.overdue && !b.overdue) return -1;
      if (!a.overdue && b.overdue) return 1;
      const ad = a.due_date || "9999-12-31";
      const bd = b.due_date || "9999-12-31";
      return ad.localeCompare(bd);
    })
    .slice(0, top)
    .map((x) => ({
      ...x,
      prompt: x.overdue
        ? "Confirm owner/action plan and rebaseline due date."
        : `Confirm mitigation and next update before ${x.due_date}.`,
    }));

  return {
    ok: true,
    org_name,
    client_name,
    scope,
    days,
    top,
    summary: { headline, generated_at: new Date().toISOString() },
    kpis: {
      total_items,
      overdue_open,
      high_score,
      sla_hot,
      exposure_total,
      exposure_total_fmt: moneyGBP(exposure_total),
    },
    wow: null,
    sections: [
      { key: "top_score", title: "Top Risks by Score", items: byScore },
      { key: "sla_hot", title: "SLA Breach Watchlist", items: bySla },
      { key: "exposure", title: "Financial Exposure Hotspots", items: byExposure },
      { key: "decisions", title: "Decisions Required (Next Actions)", items: decisions },
    ],
    meta: {
      ...meta,
      projectCounts: {
        base: baseProjectIds.length,
        active: activeProjectIds.length,
        filtered: projectIds.length,
      },
    },
  };
}

/* ---------------- HTML renderer (PDF) ---------------- */

function esc(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPdfHtml(summary: ExecSummary) {
  const gen = fmtUkDateTime(summary.summary.generated_at);
  const clientPrimary = summary.client_name ? summary.client_name : "—";
  const orgSecondary = summary.org_name ? summary.org_name : "—";

  const logoUrl =
    safeStr(process.env.BRANDING_LOGO_URL || process.env.NEXT_PUBLIC_BRANDING_LOGO_URL).trim() ||
    BRAND_LOGO_URL;

  const k = summary.kpis;

  const sections = summary.sections
    .map((sec) => {
      const items = sec.items || [];
      const rows =
        items.length === 0
          ? `<div class="empty">No items in this section.</div>`
          : items
              .map((x) => {
                const due = x.due_date ? fmtUkDate(x.due_date) : "—";
                const overdue = Boolean(x.overdue);
                const sc = x.score == null ? null : Number(x.score);
                const bp = x.sla_breach_probability == null ? null : Number(x.sla_breach_probability);
                const hot = (bp != null && bp >= 70) || (sc != null && sc >= 70) || overdue;
                const pills: string[] = [];
                if (x.public_id) pills.push(`<span class="pill pill-neutral">ID: ${esc(x.public_id)}</span>`);
                pills.push(`<span class="pill ${overdue ? "pill-danger" : "pill-neutral"}">Due: ${esc(due)}</span>`);
                if (sc != null) {
                  pills.push(
                    `<span class="pill ${hot && sc >= 70 ? "pill-warn" : "pill-neutral"}">Score: ${esc(sc)}</span>`,
                  );
                }
                if (bp != null) {
                  pills.push(
                    `<span class="pill ${bp >= 70 ? "pill-warn" : "pill-neutral"}">SLA: ${esc(bp)}%</span>`,
                  );
                }
                if (x.exposure_total_fmt) {
                  pills.push(
                    `<span class="pill pill-neutral">Exposure: ${esc(x.exposure_total_fmt)}</span>`,
                  );
                }
                if (x.owner_label) {
                  pills.push(`<span class="pill pill-neutral">Owner: ${esc(x.owner_label)}</span>`);
                }
                const note = x.note || x.prompt ? `<div class="note">${esc(x.note || x.prompt)}</div>` : "";
                return `<div class="item"><div class="item-meta">${esc(
                  x.project_title || "Project",
                )} • ${esc(x.type || "RAID")}</div><div class="item-title">${
                  x.public_id ? `<span class="item-id">${esc(x.public_id)}</span> ` : ""
                }${esc(
                  x.title || "Untitled",
                )}</div><div class="pills">${pills.join("")}</div>${note}</div>`;
              })
              .join("");
      return `<div class="card"><div class="card-title-row"><div class="card-title">${esc(
        sec.title,
      )}</div><div class="muted">${items.length} item(s)</div></div><div class="items">${rows}</div></div>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Portfolio RAID Brief</title><style>
  :root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--card:#ffffff;--soft:#f8fafc;--warn:#f59e0b;--danger:#ef4444;--brand:#0b1220}
  *{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);background:#fff}
  .page{padding:24px 28px 28px}.header{border:1px solid var(--line);border-radius:18px;padding:18px 18px 16px;background:linear-gradient(180deg,#ffffff 0%,#fbfdff 100%)}
  .brandrow{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:10px}
  .brandleft{display:flex;align-items:center;gap:12px;min-width:0}
  .logo{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}
  .logo img{width:100%;height:100%;object-fit:contain;display:block}
  .clientname{font-size:14px;font-weight:900;color:var(--brand);line-height:1.15}
  .orgline{margin-top:2px;font-size:12px;color:#334155}
  .kicker{font-size:12px;color:var(--muted)}
  .title{margin-top:6px;font-size:24px;font-weight:900;letter-spacing:-0.02em}
  .headline{margin-top:10px;font-size:14px;color:#334155;line-height:1.45}
  .gen{margin-top:6px;font-size:12px;color:var(--muted)}
  .chips{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}
  .chip{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:700;white-space:nowrap}
  .chip.warn{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.10)}
  .chip.danger{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.10)}
  .grid{margin-top:14px;display:grid;gap:14px}
  .card{border:1px solid var(--line);border-radius:16px;padding:16px;background:var(--card)}
  .card-title-row{display:flex;justify-content:space-between;align-items:flex-end;gap:10px}
  .card-title{font-size:14px;font-weight:900;letter-spacing:-0.01em}
  .muted{color:var(--muted);font-size:12px}
  .items{margin-top:12px;display:flex;flex-direction:column;gap:10px}
  .item{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}
  .item-meta{font-size:12px;color:var(--muted)}
  .item-title{margin-top:6px;font-size:14px;font-weight:900;color:#0b1220}
  .item-id{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;color:#475569}
  .pills{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}
  .pill{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:700}
  .pill-warn{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.10)}
  .pill-danger{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.10)}
  .note{margin-top:10px;font-size:12px;color:#334155;line-height:1.45}
  .empty{margin-top:10px;font-size:12px;color:var(--muted);padding:10px 12px;border:1px dashed #cbd5e1;border-radius:12px;background:#fff}
  @page{size:A4;margin:12mm}
  </style></head><body><div class="page"><div class="header">
  <div class="brandrow"><div class="brandleft"><div class="logo">${
    logoUrl ? `<img src="${esc(logoUrl)}" alt="Logo"/>` : `<div class="wordmark">ΛLIENΛ</div>`
  }</div><div><div class="clientname">${esc(clientPrimary)}</div><div class="orgline"><b>Organisation:</b> ${esc(
    orgSecondary,
  )}</div></div></div>
  <div class="kicker">Executive Summary • next ${esc(summary.days)} days • scope: ${esc(summary.scope)}</div></div>
  <div class="title">Portfolio RAID Brief</div><div class="headline">${esc(summary.summary.headline)}</div>
  <div class="gen">Generated: ${esc(gen)}</div>
  <div class="chips">
    <span class="chip">Total: ${esc(k.total_items)}</span>
    <span class="chip ${k.overdue_open ? "danger" : ""}">Overdue: ${esc(k.overdue_open)}</span>
    <span class="chip ${k.high_score ? "warn" : ""}">High score: ${esc(k.high_score)}</span>
    <span class="chip ${k.sla_hot ? "warn" : ""}">SLA hot: ${esc(k.sla_hot)}</span>
    <span class="chip ${k.exposure_total ? "warn" : ""}">Exposure: ${esc(k.exposure_total_fmt || "—")}</span>
  </div>
  </div><div class="grid">${sections}</div></div></body></html>`;
}

/* ---------------- puppeteer (chromium) ---------------- */

async function renderPdfFromHtml(html: string) {
  const isProd = process.env.NODE_ENV === "production";

  let browser: any = null;

  if (isProd) {
    const puppeteerCoreMod = await import("puppeteer-core");
    const chromiumMod = await import("@sparticuz/chromium");

    const puppeteerCore = (puppeteerCoreMod as any).default || puppeteerCoreMod;
    const chromium = (chromiumMod as any).default || chromiumMod;

    const executablePath = await chromium.executablePath();

    browser = await puppeteerCore.launch({
      args: chromium.args,
      executablePath,
      headless: true,
    } as any);
  } else {
    const puppeteerMod = await import("puppeteer");
    const puppeteer = (puppeteerMod as any).default || puppeteerMod;

    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      headless: true,
    } as any);
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setCacheEnabled(false);
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });
    await page.evaluateHandle("document.fonts && document.fonts.ready");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });

    return pdf;
  } finally {
    if (browser) await browser.close();
  }
}

/* ---------------- PPTX renderer ---------------- */

async function fetchAsDataUri(url: string, fallbackMime = "image/png"): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" as any });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const ct = safeStr(res.headers.get("content-type")).trim().toLowerCase();
    const mime = ct && ct.includes("/") ? ct : fallbackMime;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function fmtUKShortDate(d: any) {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(String(d));
  if (Number.isNaN(dt.getTime())) return s;
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function priorityFromScore(score: any) {
  const v = Number(score);
  if (!Number.isFinite(v)) return { label: "Info", kind: "neutral" as const };
  if (v >= 70) return { label: "High Priority", kind: "danger" as const };
  if (v >= 40) return { label: "Medium Priority", kind: "warn" as const };
  return { label: "Low Priority", kind: "neutral" as const };
}

async function renderPptxFromSummary(summary: ExecSummary) {
  const mod = await import("pptxgenjs");
  const PptxGenJS = (mod as any).default || (mod as any);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const logoUrl =
    safeStr(process.env.BRANDING_LOGO_URL || process.env.NEXT_PUBLIC_BRANDING_LOGO_URL).trim() ||
    BRAND_LOGO_URL;
  const logoData = await fetchAsDataUri(logoUrl);

  const title = "Portfolio RAID Brief";
  const subtitle = `${summary.client_name || "—"} • ${summary.org_name || "—"} • next ${summary.days} days • scope: ${summary.scope}`;
  const generated = `Generated: ${fmtUkDateTime(summary.summary.generated_at)}`;

  {
    const s = pptx.addSlide();
    s.addText(title, { x: 0.6, y: 0.5, w: 12.2, h: 0.6, fontSize: 34, bold: true });
    s.addText(subtitle, { x: 0.6, y: 1.25, w: 12.2, h: 0.4, fontSize: 14 });
    s.addText(summary.summary.headline || "", { x: 0.6, y: 1.75, w: 12.2, h: 1.2, fontSize: 12 });
    s.addText(generated, { x: 0.6, y: 3.05, w: 12.2, h: 0.35, fontSize: 10 });

    if (logoData) s.addImage({ data: logoData, x: 12.6, y: 0.45, w: 0.9, h: 0.9 });

    const k = summary.kpis;
    const kpiText = `Total: ${k.total_items}   •   Overdue: ${k.overdue_open}   •   High score: ${k.high_score}   •   SLA hot: ${k.sla_hot}   •   Exposure: ${
      k.exposure_total_fmt || "—"
    }`;
    s.addText(kpiText, { x: 0.6, y: 3.5, w: 12.8, h: 0.4, fontSize: 12, bold: true });
  }

  for (const sec of summary.sections || []) {
    const items = Array.isArray(sec.items) ? sec.items : [];
    const pageSize = 6;
    for (let i = 0; i < items.length || i === 0; i += pageSize) {
      const s = pptx.addSlide();
      const chunk = items.length ? items.slice(i, i + pageSize) : [];

      s.addText(sec.title, { x: 0.6, y: 0.5, w: 12.8, h: 0.5, fontSize: 24, bold: true });
      s.addText(subtitle, { x: 0.6, y: 1.05, w: 12.8, h: 0.3, fontSize: 10 });
      if (logoData) s.addImage({ data: logoData, x: 12.9, y: 0.45, w: 0.6, h: 0.6 });

      if (!chunk.length) {
        s.addText("No items in this section.", { x: 0.8, y: 1.6, w: 12.2, h: 0.5, fontSize: 14 });
        continue;
      }

      let y = 1.45;
      for (const it of chunk) {
        const pr = priorityFromScore(it.score);
        const header = `${pr.label}${it.overdue ? " • OVERDUE" : ""}${it.public_id ? ` • ${it.public_id}` : ""}`;
        const metaLine = `${it.project_code_label || it.project_title || "Project"} • ${it.type || "RAID"} • Due ${
          it.due_date ? fmtUKShortDate(it.due_date) : "—"
        } • Score ${it.score == null ? "—" : it.score}`;

        s.addText(header, { x: 0.8, y, w: 12.2, h: 0.25, fontSize: 11, bold: true });
        s.addText(metaLine, { x: 0.8, y: y + 0.25, w: 12.2, h: 0.25, fontSize: 9 });
        s.addText(safeStr(it.title || "Untitled"), {
          x: 0.8,
          y: y + 0.5,
          w: 12.2,
          h: 0.35,
          fontSize: 12,
          bold: true,
        });
        const note = safeStr(it.note || it.prompt || "").trim();
        if (note) s.addText(note, { x: 0.8, y: y + 0.85, w: 12.2, h: 0.4, fontSize: 10 });

        y += 1.25;
      }
    }
  }

  const buf = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(buf);
}

/* ---------------- handler ---------------- */

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const top = clampInt(url.searchParams.get("top"), 1, 20, 5);
    const scope = clampScope(url.searchParams.get("scope"));
    const download = safeStr(url.searchParams.get("download")).trim() === "1";
    const format = clampFormat(url.searchParams.get("format"));
    const filters = parseFiltersFromUrl(url);

    const exec = await buildExecSummary({
      supabase,
      userId: auth.user.id,
      scope,
      days,
      top,
      filters,
    });

    if (!(exec as any).ok) {
      return jsonErr((exec as any).error || "Failed", 500, (exec as any).meta);
    }

    const summary = exec as ExecSummary;

    if (!download) {
      return jsonOk(summary, 200, { "Cache-Control": "no-store, max-age=0" });
    }

    if (format === "md") {
      const lines: string[] = [];
      lines.push(`# Portfolio RAID Brief`);
      lines.push(`Client: ${summary.client_name || "—"} • Organisation: ${summary.org_name || "—"}`);
      lines.push(`Generated: ${fmtUkDateTime(summary.summary.generated_at)}`);
      lines.push(``);
      lines.push(summary.summary.headline);
      lines.push(``);
      for (const sec of summary.sections) {
        lines.push(`## ${sec.title}`);
        for (const it of sec.items) {
          lines.push(
            `- ${it.public_id ? `${it.public_id} • ` : ""}${it.project_title || "Project"} • ${it.type || "RAID"} • ${it.title || "Untitled"} • Due ${
              it.due_date ? fmtUkDate(it.due_date) : "—"
            }`,
          );
        }
        lines.push(``);
      }

      return new NextResponse(Buffer.from(lines.join("\n")), {
        status: 200,
        headers: {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="portfolio_raid_brief_${days}d.md"`,
          "cache-control": "no-store, max-age=0",
        },
      });
    }

    if (format === "pptx") {
      const pptxBuf = await renderPptxFromSummary(summary);
      const base =
        sanitizeFilename(summary.client_name || "") ||
        sanitizeFilename(summary.org_name || "") ||
        "portfolio_raid_brief";

      return new NextResponse(Buffer.from(pptxBuf), {
        status: 200,
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "content-disposition": `attachment; filename="${base}_raid_brief_${days}d.pptx"`,
          "cache-control": "no-store, max-age=0",
        },
      });
    }

    const html = renderPdfHtml(summary);
    const pdf = await renderPdfFromHtml(html);
    const base =
      sanitizeFilename(summary.client_name || "") ||
      sanitizeFilename(summary.org_name || "") ||
      "portfolio_raid_brief";

    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${base}_raid_brief_${days}d.pdf"`,
        "cache-control": "no-store, max-age=0",
      },
    });
  } catch (e: any) {
    console.error("[GET /api/portfolio/raid-exec-summary]", e);
    return jsonErr(String(e?.message || e || "Failed"), 500);
  }
}