// src/lib/exports/csv.ts

/**
 * Minimal row shape needed for CSV export.
 * (Avoids coupling to missing/unstable type paths during migration.)
 */
export type WbsRowCsv = {
  code?: string | number | null;
  level?: number | string | null;
  name?: string | null;
  deliverable?: string | null;
  status?: string | null;
  effort?: string | number | null;
  owner?: string | null;
  due_date?: string | null;
};

/**
 * Export WBS rows to CSV (browser download)
 */
export function exportToCSV(rows: WbsRowCsv[], filename = "wbs-export.csv") {
  const headers = ["Code", "Level", "Deliverable", "Status", "Effort", "Owner", "Due Date"];

  // Escape CSV safely (handles commas + quotes + newlines)
  function esc(v: unknown) {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
    if (s.includes(",") || s.includes("\n")) return `"${s}"`;
    return s;
  }

  const csvRows = rows.map((r) =>
    [
      esc(r.code),
      esc(r.level),
      esc(r.name || r.deliverable || ""),
      esc(r.status),
      esc(r.effort),
      esc(r.owner),
      esc(r.due_date),
    ].join(",")
  );

  const csvContent = [headers.join(","), ...csvRows].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  link.href = URL.createObjectURL(blob);
  link.setAttribute("download", filename);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
