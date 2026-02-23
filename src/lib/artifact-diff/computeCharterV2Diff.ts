import type { ArtifactDiffV1, DiffOp, SectionDiff } from "@/types/artifact-diff";
import { normalizeCharterV2, type CharterV2 } from "./normalizeCharterV2";

function stableJson(x: unknown): string {
  // stable stringify for comparisons (good enough for our controlled objects)
  return JSON.stringify(x, Object.keys(x as any).sort());
}

function isEqual(a: unknown, b: unknown): boolean {
  try {
    return stableJson(a) === stableJson(b);
  } catch {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}

function pushReplace(ops: DiffOp[], path: string, before: unknown, after: unknown) {
  if (!isEqual(before, after)) {
    ops.push({ op: "replace", path, before, after } as const);
  }
}

function pushAdd(ops: DiffOp[], path: string, after: unknown) {
  ops.push({ op: "add", path, after } as const);
}

function pushRemove(ops: DiffOp[], path: string, before: unknown) {
  ops.push({ op: "remove", path, before } as const);
}

function mapSectionsByKey(sections: CharterV2["sections"] | undefined) {
  const m = new Map<string, { idx: number; section: NonNullable<CharterV2["sections"]>[number] }>();
  const arr = sections ?? [];
  arr.forEach((s, idx) => m.set(s.key, { idx, section: s }));
  return { map: m, arr };
}

function diffMeta(base: CharterV2, head: CharterV2, out: SectionDiff[]) {
  const ops: DiffOp[] = [];
  const b = base.meta ?? {};
  const h = head.meta ?? {};
  pushReplace(ops, "/meta", b, h);

  if (ops.length) {
    out.push({ section_key: "__meta__", ops });
  }
}

function diffSection(baseSec: any, headSec: any, baseIdx: number, headIdx: number): SectionDiff | null {
  const ops: DiffOp[] = [];

  // Title
  pushReplace(ops, `/sections/${headIdx}/title`, baseSec?.title ?? null, headSec?.title ?? null);

  // Bullets / text
  pushReplace(ops, `/sections/${headIdx}/bullets`, baseSec?.bullets ?? "", headSec?.bullets ?? "");
  pushReplace(ops, `/sections/${headIdx}/text`, baseSec?.text ?? "", headSec?.text ?? "");

  // Table v2 (preferred)
  const bTable = baseSec?.table ?? null;
  const hTable = headSec?.table ?? null;

  if (!isEqual(bTable, hTable)) {
    // If table existence changed, replace table whole (safe)
    pushReplace(ops, `/sections/${headIdx}/table`, bTable, hTable);
  }

  // Legacy rows/columns (if used)
  const bCols = baseSec?.columns ?? null;
  const hCols = headSec?.columns ?? null;
  pushReplace(ops, `/sections/${headIdx}/columns`, bCols, hCols);

  const bRows = baseSec?.rows ?? null;
  const hRows = headSec?.rows ?? null;
  pushReplace(ops, `/sections/${headIdx}/rows`, bRows, hRows);

  if (!ops.length) return null;
  return { section_key: String(headSec?.key ?? ""), ops };
}

/**
 * Compute a section-aware diff for Charter v2 JSON.
 * Returns ArtifactDiffV1.sections[] where each entry is a logical section group with ops.
 */
export function computeCharterV2Diff(
  baseInput: unknown,
  headInput: unknown,
  opts?: { artifactType?: string; baseRevision?: number; headRevision?: number }
): ArtifactDiffV1 {
  const base = normalizeCharterV2(baseInput);
  const head = normalizeCharterV2(headInput);

  // Fallback: if not charter v2, return empty diff payload
  if (!base || !head) {
    return {
      schema_version: "artifact-diff@1",
      artifact_type: opts?.artifactType ?? "UNKNOWN",
      base_revision: opts?.baseRevision ?? 0,
      head_revision: opts?.headRevision ?? 0,
      sections: [],
    };
  }

  const sections: SectionDiff[] = [];

  // Meta diff (grouped under __meta__)
  diffMeta(base, head, sections);

  const { map: bMap } = mapSectionsByKey(base.sections);
  const { map: hMap, arr: hArr } = mapSectionsByKey(head.sections);

  // Detect removed sections (present in base, not in head)
  for (const [key, b] of bMap.entries()) {
    if (!hMap.has(key)) {
      const ops: DiffOp[] = [];
      // We can only safely "remove" by index if we apply to a known normalized head/base.
      // For diff display, record intent.
      pushRemove(ops, `/sections/*(key=${key})`, b.section);
      sections.push({ section_key: key, ops });
    }
  }

  // Detect added + modified sections (iterate head order for stable UI)
  for (let headIdx = 0; headIdx < hArr.length; headIdx++) {
    const headSec = hArr[headIdx];
    const key = headSec.key;
    const baseEntry = bMap.get(key);

    if (!baseEntry) {
      const ops: DiffOp[] = [];
      pushAdd(ops, `/sections/${headIdx}`, headSec);
      sections.push({ section_key: key, ops });
      continue;
    }

    const baseIdx = baseEntry.idx;
    const changed = diffSection(baseEntry.section, headSec, baseIdx, headIdx);
    if (changed) sections.push(changed);
  }

  return {
    schema_version: "artifact-diff@1",
    artifact_type: opts?.artifactType ?? head.type ?? "PROJECT_CHARTER",
    base_revision: opts?.baseRevision ?? 0,
    head_revision: opts?.headRevision ?? 0,
    sections,
  };
}
