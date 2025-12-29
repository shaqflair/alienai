import type { CharterV2, CharterMeta, CharterSection } from "@/app/projects/[id]/artifacts/[artifactId]/charter-v2-actions";
import { buildEmptyCharterV2, validateCharterV2 } from "@/app/projects/[id]/artifacts/[artifactId]/charter-v2-actions";

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
 * This is heuristic, but it works for the common structure you showed in your PDF.
 */
function extractMetaFromProseMirror(raw: any): Partial<CharterMeta> {
  const meta: Partial<CharterMeta> = {};
  if (!isProseMirrorDoc(raw)) return meta;

  // Find first table
  const table = raw.content?.find((n: any) => n?.type === "table");
  if (!table?.content) return meta;

  // Collect rows as [cellsText...]
  const rows: string[][] = [];
  for (const tr of table.content) {
    if (tr?.type !== "tableRow" || !Array.isArray(tr.content)) continue;
    const cells: string[] = tr.content.map((cell: any) => pmText(cell).trim());
    rows.push(cells);
  }

  // Try map labels -> values (very common pattern: header then empty cell)
  const flat = rows.flat().map((s) => s.trim()).filter(Boolean);

  // naive pairing helper
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

/**
 * Create/repair a valid v2 charter structure:
 * - If already v2 => normalize
 * - Else build empty v2 skeleton and preserve legacy under legacy_raw
 */
export function migrateCharterAnyToV2(args: {
  raw: any; // content_json or content
  projectTitleFallback?: string;
}): CharterV2 {
  const { raw, projectTitleFallback } = args;

  // If already v2 (or close), normalize and return
  const normalized = validateCharterV2(raw, projectTitleFallback);
  const looksV2 = !!raw && typeof raw === "object" && !!raw.meta && Array.isArray(raw.sections);
  if (looksV2) {
    return {
      ...normalized,
      legacy_raw: (raw as any).legacy_raw,
    };
  }

  // Otherwise: build empty charter v2
  const base = buildEmptyCharterV2(projectTitleFallback);

  // Best-effort: meta extraction from ProseMirror doc/table
  const extractedMeta = extractMetaFromProseMirror(raw);

  // If raw has a "meta" object (even if not v2), merge it too
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
  out.sections = (out.sections ?? []).map((s: CharterSection) => ({
    ...s,
    key: normKey(s.key),
    title: String(s.title ?? "").trim() || s.key,
  }));

  return out;
}
