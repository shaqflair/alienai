// src/lib/charter/migrate-to-v2.ts

import type { CharterV2 } from "@/lib/charter/charter-v2";
import type { CharterMeta, CharterSection } from "@/components/editors/ProjectCharterSectionEditor";
import { buildEmptyCharterV2 } from "@/lib/charter/charter-v2-helpers";

function normKey(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function isProseMirrorDoc(x: any) {
  return !!x && typeof x === "object" && x.type === "doc" && Array.isArray(x.content);
}

function pmText(node: any): string {
  if (!node) return "";
  if (typeof node.text === "string") return node.text;
  if (Array.isArray(node.content)) return node.content.map(pmText).join("");
  return "";
}

/**
 * Best-effort extract of meta fields from a ProseMirror "PROJECT CHARTER" table.
 * Heuristic but works for common table structures.
 */
function extractMetaFromProseMirror(raw: any): Partial<CharterMeta> {
  const meta: Partial<CharterMeta> = {};
  if (!isProseMirrorDoc(raw)) return meta;

  const table = raw.content?.find((n: any) => n?.type === "table");
  if (!table?.content) return meta;

  const rows: string[][] = [];
  for (const tr of table.content) {
    if (tr?.type !== "tableRow" || !Array.isArray(tr.content)) continue;
    const cells: string[] = tr.content.map((cell: any) => pmText(cell).trim());
    rows.push(cells);
  }

  const flat = rows.flat().map((s) => s.trim()).filter(Boolean);

  const findAfter = (label: string) => {
    const i = flat.findIndex((x) => x.toLowerCase() === label.toLowerCase());
    if (i >= 0 && flat[i + 1]) return flat[i + 1];
    return "";
  };

  meta.project_title = findAfter("Project Title");
  meta.project_manager = findAfter("Project Manager");
  meta.project_start_date = findAfter("Project Start Date");
  meta.project_end_date = findAfter("Project End Date");
  meta.project_sponsor = findAfter("Project Sponsor");
  meta.customer_account = findAfter("Customer / Account");

  return meta;
}

function looksLikeV2(raw: any) {
  return !!raw && typeof raw === "object" && Array.isArray(raw.sections);
}

/**
 * Minimal v2 normalizer:
 * - ensures meta is object
 * - ensures sections is array
 * - normalizes section keys/titles
 * - preserves legacy_raw if present
 */
function normalizeV2(raw: any, projectTitleFallback?: string): CharterV2 {
  const metaIn = raw?.meta && typeof raw.meta === "object" ? raw.meta : {};
  const sectionsIn = Array.isArray(raw?.sections) ? raw.sections : [];

  const base = buildEmptyCharterV2(projectTitleFallback ?? "");

  const mergedMeta = {
    ...base.meta,
    ...metaIn,
    project_title: String(
      metaIn?.project_title || projectTitleFallback || base.meta.project_title || ""
    ).trim(),
  };

  const byKey = new Map<string, any>();
  for (const sec of sectionsIn) byKey.set(normKey(sec?.key), sec);

  // keep required skeleton order, but merge any content that exists
  const mergedSections = (base.sections ?? []).map((s0: any) => {
    const k = normKey(s0.key);
    const existing = byKey.get(k);
    const title = String(existing?.title ?? s0.title ?? "").trim() || s0.key;

    // if base is table, keep table; if bullets, keep bullets
    const out: any = { ...s0, ...existing, key: k, title };

    return out;
  });

  return {
    meta: mergedMeta,
    sections: mergedSections,
    legacy_raw: raw?.legacy_raw ?? undefined,
  };
}

/**
 * Create/repair a valid v2 charter structure:
 * - If already v2-ish => normalize/repair
 * - Else build empty v2 skeleton and preserve legacy under legacy_raw
 */
export function migrateCharterAnyToV2(args: { raw: any; projectTitleFallback?: string }): CharterV2 {
  const { raw, projectTitleFallback } = args;

  // If already v2-ish, normalize and return
  if (looksLikeV2(raw)) {
    const normalized = normalizeV2(raw, projectTitleFallback);
    return {
      ...normalized,
      legacy_raw: (raw as any)?.legacy_raw,
    };
  }

  // Otherwise: build empty charter v2
  const base = buildEmptyCharterV2(projectTitleFallback ?? "");

  // Best-effort meta extraction from ProseMirror doc/table
  const extractedMeta = extractMetaFromProseMirror(raw);

  // If raw has a meta object (even if not v2), merge it too
  const rawMeta = raw?.meta && typeof raw.meta === "object" ? raw.meta : null;

  const out: CharterV2 = {
    ...base,
    meta: {
      ...base.meta,
      ...(rawMeta ?? {}),
      ...(extractedMeta ?? {}),
      project_title: String(
        extractedMeta.project_title ||
          rawMeta?.project_title ||
          projectTitleFallback ||
          base.meta.project_title ||
          ""
      ).trim(),
    },
    legacy_raw: raw ?? null,
  };

  // Keep section titles stable even if keys differ
  (out as any).sections = (out.sections ?? []).map((sec: any) => ({    ...sec,
    key: normKey(sec.key),
    title: String(sec.title ?? "").trim() || sec.key,
  })) as CharterSection[];

  return out;
}
