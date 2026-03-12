// src/app/api/executive/approvals/pending/route.ts — v5
// ✅ AP-F1: Shared portfolio scope via resolvePortfolioScope(supabase, user.id)
// ✅ AP-F2: Active-only filtering via filterActiveProjectIds with scoped FAIL-OPEN
// ✅ AP-F3: Supports dashboard filters (GET): name/code/pm/dept
// ✅ AP-F4: Reads exec_approval_cache only for scoped project ids
// ✅ AP-F5: No-store on all responses
// ✅ AP-F6: De-dupes newest per (project_id + approver_label + sla_status)
// ✅ AP-F7: Returns scope/debug metadata for drift checks

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

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

function clampDays(v: string | null): 7 | 14 | 30 | 60 {
  const s = safeStr(v).trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  for (const b of [7, 14, 30, 60] as const) {
    if (Number.isFinite(n) && n <= b) return b;
  }
  return 60;
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
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
    url.searchParams.getAll("name").flatMap((x) => x.split(",")).map((s) => s.trim())
  );
  const code = uniqStrings(
    url.searchParams.getAll("code").flatMap((x) => x.split(",")).map((s) => s.trim())
  );
  const pm = uniqStrings(
    url.searchParams.getAll("pm").flatMap((x) => x.split(",")).map((s) => s.trim())
  );
  const dept = uniqStrings(
    url.searchParams.getAll("dept").flatMap((x) => x.split(",")).map((s) => s.trim())
  );

  const out: PortfolioFilters = {};
  if (name.length) out.projectName = name;
  if (code.length) out.projectCode = code;
  if (pm.length) out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
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

// Filter projects within scoped candidates using best-effort project metadata reads.
async function applyProjectFilters(
  supabase: any,
  scopedProjectIds: string[],
  filters: PortfolioFilters
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };

  if (!scopedProjectIds.length) {
    return { projectIds: [], meta: { ...meta, applied: true } };
  }

  if (!hasAnyFilters(filters)) {
    return { projectIds: scopedProjectIds, meta };
  }

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

    if (nameNeedles.length && !nameNeedles.some((n) => title.includes(n))) return false;
    if (codeNeedles.length && !codeNeedles.some((c) => code.includes(c))) return false;

    if (pmSet.size) {
      const pm = safeStr(p?.project_manager_id).trim();
      if (!pm || !pmSet.has(pm)) return false;
    }

    if (deptNeedles.length) {
      const dept = safeStr(p?.department).toLowerCase().trim();
      if (!dept || !deptNeedles.some((d) => dept.includes(d))) return false;
    }

    return true;
  });

  const outIds = filtered.map((p) => String(p?.id || "").trim()).filter(Boolean);
  meta.applied = true;
  meta.counts = { before: scopedProjectIds.length, after: outIds.length };
  return { projectIds: outIds, meta };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200"), 1), 500);
    const days = clampDays(url.searchParams.get("days"));
    const filters = parseFiltersFromUrl(url);

    const supabase = await createClient();

    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const sharedScope = await resolvePortfolioScope(supabase, user.id);
    const organisationId = sharedScope.organisationId ?? null;
    const scopeMeta = sharedScope.meta ?? {};
    const scopedRaw: string[] = Array.isArray(sharedScope.rawProjectIds)
      ? sharedScope.rawProjectIds
      : Array.isArray(sharedScope.projectIds)
        ? sharedScope.projectIds
        : [];

    const active = await normalizeActiveIds(supabase, scopedRaw);
    const scopedActive = active.ids;

    const filtered = await applyProjectFilters(supabase, scopedActive, filters);
    const projectIds = filtered.projectIds;

    if (!projectIds.length) {
      return noStoreJson({
        ok: true,
        scope: "portfolio",
        organisationId,
        days,
        source: "exec_approval_cache",
        items: [],
        meta: {
          cache_miss: false,
          window_days: days,
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

    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: cacheDataRaw, error: cacheErr } = await supabase
      .from("exec_approval_cache")
      .select(
        "organisation_id, project_id, project_title, project_code, sla_status, approver_label, window_days, computed_at"
      )
      .in("project_id", projectIds)
      .order("computed_at", { ascending: false })
      .limit(Math.max(limit * 4, 500));

    if (cacheErr) {
      return noStoreJson({ ok: false, error: cacheErr.message }, { status: 500 });
    }

    const cacheData = Array.isArray(cacheDataRaw) ? cacheDataRaw : [];

    if (!cacheData.length) {
      return noStoreJson({
        ok: true,
        scope: "portfolio",
        organisationId,
        days,
        source: "none",
        items: [],
        meta: {
          cache_miss: true,
          window_days: days,
          scopeMeta,
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

    const filteredToWindow = cacheData.filter((row: any) => {
      const rowDays = Number(row?.window_days);
      if (Number.isFinite(rowDays)) return rowDays <= days;

      const computedAt = safeStr(row?.computed_at).trim();
      if (computedAt) return computedAt >= sinceIso;

      return true;
    });

    const dedupeKey = (r: any) =>
      `${safeStr(r?.project_id)}|${safeStr(r?.approver_label)}|${safeStr(r?.sla_status)}`;

    const best = new Map<string, any>();
    for (const r of filteredToWindow) {
      const k = dedupeKey(r);
      const prev = best.get(k);
      if (!prev) {
        best.set(k, r);
      } else {
        const a = safeStr(prev?.computed_at);
        const b = safeStr(r?.computed_at);
        if (b && (!a || b > a)) best.set(k, r);
      }
    }

    const out = Array.from(best.values()).slice(0, limit);

    return noStoreJson({
      ok: true,
      scope: "portfolio",
      organisationId,
      days,
      source: "exec_approval_cache",
      items: out,
      meta: {
        total_cached: cacheData.length,
        filtered_to_window: filteredToWindow.length,
        deduped: out.length,
        window_days: days,
        scopeMeta,
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
  } catch (e: any) {
    return noStoreJson(
      {
        ok: false,
        error: "pending_approvals_failed",
        message: e?.message ?? String(e),
      },
      { status: 500 }
    );
  }
}