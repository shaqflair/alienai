export type RowObj = { type: "header" | "data"; cells: string[] };

export type CharterV2Section = {
  key: string;
  title: string;
  bullets?: string;
  table?: { columns: number; rows: RowObj[] };

  // legacy compatibility (sometimes present)
  columns?: string[];
  rows?: string[][];
};

export type CharterV2Like = {
  meta?: Record<string, any>;
  sections?: CharterV2Section[];
  version?: number;
  type?: string;
};

export type CompletenessItem = {
  complete: boolean;
  label: string; // "Complete" | "Incomplete"
};

export type CharterValidationReport = {
  completenessByKey: Record<string, CompletenessItem>;
  completeCount: number;
  totalCount: number;
  score0to100: number;
};

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function bulletsComplete(bullets: string | undefined): boolean {
  const text = s(bullets).trim();
  if (!text) return false;

  // ✅ one bullet per line → any non-empty line counts
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0;
}

function tableComplete(section: CharterV2Section): boolean {
  // Canonical v2 table
  if (section.table?.rows?.length) {
    const rows = section.table.rows || [];
    const dataRows = rows.filter((r) => r?.type === "data");
    for (const r of dataRows) {
      for (const cell of r?.cells ?? []) {
        if (s(cell).trim()) return true;
      }
    }
    return false;
  }

  // Legacy table fallback
  if (Array.isArray(section.rows) && section.rows.length) {
    for (const r of section.rows) {
      for (const cell of r ?? []) {
        if (s(cell).trim()) return true;
      }
    }
    return false;
  }

  return false;
}

function sectionComplete(section: CharterV2Section): boolean {
  const hasTable =
    !!section.table ||
    (Array.isArray(section.rows) && section.rows.length) ||
    Array.isArray(section.columns);

  if (hasTable) return tableComplete(section);

  // bullets section
  return bulletsComplete(section.bullets);
}

/**
 * ✅ Used by editor + export readiness
 */
export function getCharterValidation(input: any): CharterValidationReport {
  const doc: CharterV2Like = input && typeof input === "object" ? input : {};
  const sections = Array.isArray(doc.sections) ? doc.sections : [];

  const completenessByKey: Record<string, CompletenessItem> = {};

  let total = 0;
  let complete = 0;

  for (const sec of sections) {
    const key = s(sec?.key).trim() || "unknown";
    total += 1;

    const ok = sectionComplete(sec);
    if (ok) complete += 1;

    completenessByKey[key] = {
      complete: ok,
      label: ok ? "Complete" : "Incomplete",
    };
  }

  const score0to100 = total > 0 ? Math.round((complete / total) * 100) : 0;

  return {
    completenessByKey,
    completeCount: complete,
    totalCount: total,
    score0to100,
  };
}

/**
 * ✅ Used by approval / submit actions
 * Throws if charter is NOT ready for submission
 */
export function assertCharterReadyForSubmit(input: CharterV2Like | { meta: any; sections: CharterV2Section[] }) {
  const report = getCharterValidation(input);

  if (report.completeCount !== report.totalCount) {
    const missing = Object.entries(report.completenessByKey)
      .filter(([, v]) => !v.complete)
      .map(([k]) => k);

    throw new Error(
      `Charter not ready for submit. Incomplete sections: ${missing.join(", ")}`
    );
  }

  return true;
}
