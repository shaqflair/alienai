// src/lib/exports/wbs/transform.ts
import "server-only";

import type { WbsItemRow } from "./types";
import { safeLower, safeStr } from "./utils";

/**
 * Output row shape expected by renderWbsXlsx().
 * Keep keys EXACT (deliverable, acceptance_criteria, due_date etc.)
 */
export type WbsExportRow = {
  code: string;
  level: number;
  deliverable: string;

  status: string; // raw status (renderer will statusLabel())
  effort: "" | "S" | "M" | "L";
  due_date: string | null;

  owner: string;
  predecessor: string;

  tags: any[]; // renderer expects array (it will join)
  description: string;
  acceptance_criteria: string;
};

/* ==========================================================================
   Helpers
========================================================================== */

function idOf(r: any): string {
  return safeStr(r?.id || r?.key || r?.row_id || "").trim();
}

function parentOf(r: any): string | null {
  const v = r?.parent_id ?? r?.parentId ?? null;
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function numericLevel(raw: any): number | null {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  return Math.max(0, Math.min(50, Math.floor(v)));
}

function normalizeStatus(raw: unknown): "todo" | "inprogress" | "done" | "blocked" {
  const s = safeLower(raw);

  if (s === "done" || s === "complete" || s === "completed" || s === "approved") return "done";
  if (s === "in_progress" || s === "inprogress" || s === "progress") return "inprogress";
  if (s === "blocked") return "blocked";
  return "todo";
}

function effortFromNumber(n: unknown): "" | "S" | "M" | "L" {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v <= 3) return "S";
  if (v <= 10) return "M";
  return "L";
}

function normalizeEffortAny(raw: unknown): "" | "S" | "M" | "L" {
  const s = safeStr(raw).trim().toUpperCase();
  if (s === "S" || s === "M" || s === "L") return s;
  return "";
}

function normalizeTags(raw: unknown): any[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((t) => safeStr(t)).filter(Boolean);

  const s = safeStr(raw).trim();
  if (!s) return [];

  // JSON string array
  if (s.startsWith("[") && s.endsWith("]")) {
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed.map((t) => safeStr(t)).filter(Boolean);
    } catch {
      // ignore
    }
  }

  // comma separated
  return s
    .split(",")
    .map((x) => safeStr(x).trim())
    .filter(Boolean);
}

function sortKey(r: any) {
  const so = Number(r?.sort_order);
  const sort_order = Number.isFinite(so) ? so : 0;
  const name = safeStr(r?.name || r?.title || r?.deliverable || "").toLowerCase();
  return { sort_order, name };
}

function buildChildrenIndex(items: any[]) {
  const byParent = new Map<string | null, any[]>();

  for (const it of items) {
    const p = parentOf(it);
    const list = byParent.get(p) || [];
    list.push(it);
    byParent.set(p, list);
  }

  // stable ordering inside each parent
  for (const [k, list] of byParent.entries()) {
    list.sort((a, b) => {
      const ak = sortKey(a);
      const bk = sortKey(b);
      if (ak.sort_order !== bk.sort_order) return ak.sort_order - bk.sort_order;
      return ak.name.localeCompare(bk.name);
    });
    byParent.set(k, list);
  }

  return byParent;
}

function computeRoots(items: any[]) {
  const ids = new Set(items.map((x) => idOf(x)).filter(Boolean));
  const roots: any[] = [];

  for (const it of items) {
    const pid = parentOf(it);
    if (!pid || !ids.has(pid)) roots.push(it);
  }

  roots.sort((a, b) => {
    const ak = sortKey(a);
    const bk = sortKey(b);
    if (ak.sort_order !== bk.sort_order) return ak.sort_order - bk.sort_order;
    return ak.name.localeCompare(bk.name);
  });

  return roots;
}

function toExportRow(node: any, level: number, code: string): WbsExportRow {
  const deliverable =
    safeStr(node?.deliverable) ||
    safeStr(node?.name) ||
    safeStr(node?.title) ||
    safeStr(node?.summary) ||
    "Untitled";

  const status = normalizeStatus(node?.status ?? node?.delivery_status ?? node?.state ?? "todo");

  const eff =
    normalizeEffortAny(node?.effort) ||
    normalizeEffortAny(node?.effort_size) ||
    effortFromNumber(node?.estimated_effort ?? node?.effort_hours ?? node?.effort ?? null);

  const due =
    safeStr(node?.due_date) ||
    safeStr(node?.dueDate) ||
    safeStr(node?.end_date) ||
    safeStr(node?.end) ||
    "";

  const owner =
    safeStr(node?.owner) ||
    safeStr(node?.owner_label) ||
    safeStr(node?.assignee) ||
    safeStr(node?.assignee_label) ||
    "";

  const tags = normalizeTags(node?.tags ?? node?.labels ?? node?.tag_list);

  const predecessor =
    safeStr(node?.predecessor) ||
    safeStr(node?.predecessors) ||
    safeStr(node?.depends_on) ||
    safeStr(node?.dependency) ||
    "";

  const acceptance =
    safeStr(node?.acceptance_criteria) ||
    safeStr(node?.acceptanceCriteria) ||
    safeStr(node?.acceptance) ||
    safeStr(node?.definition_of_done) ||
    safeStr(node?.dod) ||
    "";

  return {
    code,
    level,
    deliverable,
    status,
    effort: eff,
    due_date: due ? due : null,
    owner,
    predecessor,
    tags,
    description: safeStr(node?.description || ""),
    acceptance_criteria: acceptance,
  };
}

/* ==========================================================================
   Outline numbering for legacy rows (no parent_id, but has level)
   Produces 1, 1.1, 1.2, 2, 2.1 etc.
========================================================================== */

function flattenByLevelOutline(items: any[]): WbsExportRow[] {
  const out: WbsExportRow[] = [];
  const counters: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const node = items[i];
    const lvl = numericLevel(node?.level) ?? 0;

    // ensure counters length = lvl+1
    while (counters.length < lvl + 1) counters.push(0);

    // when going up levels, truncate deeper counters
    if (counters.length > lvl + 1) counters.length = lvl + 1;

    // increment current level counter
    counters[lvl] = (counters[lvl] || 0) + 1;

    // reset deeper (defensive)
    for (let d = lvl + 1; d < counters.length; d++) counters[d] = 0;

    // code is counters[0..lvl]
    const code = counters.slice(0, lvl + 1).join(".");

    out.push(toExportRow(node, lvl, code));
  }

  return out;
}

/**
 * Flatten WBS items into export rows for renderWbsXlsx().
 * MUST NOT silently return [] when input is non-empty.
 */
export function flattenForExport(wbsItems: WbsItemRow[]): WbsExportRow[] {
  const items = Array.isArray(wbsItems) ? (wbsItems as any[]) : [];
  if (!items.length) return [];

  // Detect legacy “artifact content_json.rows” style:
  // - no parent_id relationships
  // - but includes some level > 0
  const hasAnyParent = items.some((x) => !!parentOf(x));
  const hasAnyLevelGt0 = items.some((x) => (numericLevel(x?.level) ?? 0) > 0);

  // If it’s a level-based list, don’t try to invent a tree from parent_id (it doesn’t exist).
  // Generate hierarchical codes from level outline numbering.
  if (!hasAnyParent && hasAnyLevelGt0) {
    // keep input order (UI order), but make stable if sort_order exists
    const sorted = [...items].sort((a, b) => {
      const ak = sortKey(a);
      const bk = sortKey(b);
      if (ak.sort_order !== bk.sort_order) return ak.sort_order - bk.sort_order;
      return ak.name.localeCompare(bk.name);
    });

    const out = flattenByLevelOutline(sorted);
    if (out.length) return out;
  }

  // Normal parent/child tree walk
  const byParent = buildChildrenIndex(items);
  const roots = computeRoots(items);

  const out: WbsExportRow[] = [];
  const visited = new Set<string>();

  function walk(node: any, level: number, prefix: number[]) {
    const id = idOf(node);

    if (id && visited.has(id)) return;
    if (id) visited.add(id);

    const code = prefix.join(".");
    out.push(toExportRow(node, level, code));

    const kids = byParent.get(id || null) || [];
    for (let i = 0; i < kids.length; i++) {
      walk(kids[i], level + 1, [...prefix, i + 1]);
    }
  }

  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], 0, [i + 1]);
  }

  // absolute last resort: flat export (never blank)
  if (!out.length) {
    for (let i = 0; i < items.length; i++) {
      out.push(toExportRow(items[i], 0, String(i + 1)));
    }
  }

  return out;
}
