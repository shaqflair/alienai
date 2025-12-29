"use client";

import React, { useMemo } from "react";

type RowObj = { type: "header" | "data"; cells: string[] };

export type CharterMeta = {
  project_title?: string;
  project_manager?: string;
  project_start_date?: string;
  project_end_date?: string;
  project_sponsor?: string;
  customer_account?: string;
};

export type CharterSection = {
  key: string;
  title: string;
  table?: { columns: number; rows: RowObj[] };
  bullets?: string;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/**
 * ✅ IMMUTABLE normalization:
 * - clones rows + cells
 * - treats missing/invalid rows safely
 * - guarantees header row + at least one data row
 */
function ensureRows(columns: number, rows: RowObj[]) {
  const cols = Math.max(1, Number(columns || 1));

  const inputRows = Array.isArray(rows) ? rows : [];

  // Deep clone rows + cells to avoid mutating original objects
  let next: RowObj[] = inputRows.map((r: any, idx: number) => {
    const t = String(r?.type ?? "").toLowerCase();
    const type: "header" | "data" =
      t === "header" ? "header" : t === "data" ? "data" : idx === 0 ? "header" : "data";

    const cells = Array.from({ length: cols }, (_, i) => safeStr(r?.cells?.[i] ?? ""));
    return { type, cells };
  });

  if (!next.length) {
    next = [
      { type: "header", cells: Array.from({ length: cols }, () => "") },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
    ];
  }

  // Ensure first row is header
  if (next[0]?.type !== "header") {
    next = [{ type: "header", cells: Array.from({ length: cols }, () => "") }, ...next];
  }

  // Ensure at least one data row exists
  if (!next.some((r) => r.type === "data")) {
    next = [...next, { type: "data", cells: Array.from({ length: cols }, () => "") }];
  }

  return { columns: cols, rows: next };
}

export default function ProjectCharterSectionEditor({
  meta,
  onMetaChange,
  sections,
  onChange,
  readOnly,
  completenessByKey,
}: {
  meta: CharterMeta;
  onMetaChange: (meta: CharterMeta) => void;
  sections: CharterSection[];
  onChange: (sections: CharterSection[]) => void;
  readOnly?: boolean;
  completenessByKey?: Record<string, boolean>;
}) {
  const complete = completenessByKey ?? {};

  const normalized = useMemo(() => {
    return (sections ?? []).map((s) => {
      const t = s.table ? ensureRows(s.table.columns, s.table.rows) : null;
      return { ...s, table: t ?? undefined };
    });
  }, [sections]);

  function setSection(idx: number, next: Partial<CharterSection>) {
    const arr = normalized.map((s) => ({ ...s })); // clone section objects
    arr[idx] = { ...arr[idx], ...next };
    onChange(arr);
  }

  function addRow(idx: number) {
    const s = normalized[idx];
    if (!s.table) return;
    const t = ensureRows(s.table.columns, s.table.rows);
    const nextT = {
      columns: t.columns,
      rows: [...t.rows, { type: "data", cells: Array.from({ length: t.columns }, () => "") }],
    };
    setSection(idx, { table: nextT });
  }

  function removeRow(idx: number, rowIdx: number) {
    const s = normalized[idx];
    if (!s.table) return;
    if (rowIdx === 0) return; // never remove header

    const t = ensureRows(s.table.columns, s.table.rows);
    let rows = t.rows.filter((_, i) => i !== rowIdx);

    // keep at least one data row
    if (!rows.some((r) => r.type === "data")) {
      rows = [...rows, { type: "data", cells: Array.from({ length: t.columns }, () => "") }];
    }

    setSection(idx, { table: { columns: t.columns, rows } });
  }

  return (
    <div className="space-y-5">
      {/* Meta */}
      <div className="border rounded-2xl p-4 bg-white">
        <div className="font-semibold mb-3">Project details</div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-neutral-600">Project title</span>
            <input
              disabled={readOnly}
              className="border rounded-xl px-3 py-2"
              value={safeStr(meta?.project_title)}
              onChange={(e) => onMetaChange({ ...meta, project_title: e.target.value })}
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-neutral-600">Customer account</span>
            <input
              disabled={readOnly}
              className="border rounded-xl px-3 py-2"
              value={safeStr(meta?.customer_account)}
              onChange={(e) => onMetaChange({ ...meta, customer_account: e.target.value })}
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-neutral-600">Project manager</span>
            <input
              disabled={readOnly}
              className="border rounded-xl px-3 py-2"
              value={safeStr(meta?.project_manager)}
              onChange={(e) => onMetaChange({ ...meta, project_manager: e.target.value })}
            />
          </label>

          <label className="grid gap-1 text-sm">
            <span className="text-neutral-600">Sponsor</span>
            <input
              disabled={readOnly}
              className="border rounded-xl px-3 py-2"
              value={safeStr(meta?.project_sponsor)}
              onChange={(e) => onMetaChange({ ...meta, project_sponsor: e.target.value })}
            />
          </label>
        </div>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {normalized.map((s, idx) => {
          const isDone = !!complete[String(s.key ?? "").toLowerCase()];
          return (
            <div key={s.key} className="border rounded-2xl bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-lg">{s.title}</div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        isDone ? "bg-green-50 border-green-200 text-green-700" : "bg-gray-50 border-gray-200 text-gray-600"
                      }`}
                      title={isDone ? "Complete" : "Incomplete"}
                    >
                      {isDone ? "✓ Complete" : "• Incomplete"}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500 break-all">key: {s.key}</div>
                </div>
              </div>

              {/* Bullets */}
              {!s.table ? (
                <div className="mt-3">
                  <textarea
                    disabled={readOnly}
                    rows={6}
                    className="w-full border rounded-xl px-3 py-2 text-sm"
                    placeholder="Add bullet points (one per line)…"
                    value={safeStr(s.bullets)}
                    onChange={(e) => setSection(idx, { bullets: e.target.value })}
                  />
                  <div className="text-xs text-neutral-500 mt-1">Tip: one bullet per line.</div>
                </div>
              ) : (
                // Table
                <div className="mt-3 space-y-2">
                  <div className="overflow-auto">
                    <table className="min-w-full border rounded-xl overflow-hidden">
                      <tbody>
                        {s.table.rows.map((r, rIdx) => (
                          <tr key={rIdx} className={r.type === "header" ? "bg-gray-50" : ""}>
                            {r.cells.map((c, cIdx) => (
                              <td key={cIdx} className="border p-0 align-top">
                                <input
                                  disabled={readOnly}
                                  className={`w-full px-3 py-2 text-sm outline-none ${
                                    r.type === "header" ? "font-medium bg-gray-50" : "bg-white"
                                  }`}
                                  value={safeStr(c)}
                                  onChange={(e) => {
                                    const t = ensureRows(s.table!.columns, s.table!.rows);
                                    const rows = t.rows.map((row, i) =>
                                      i === rIdx
                                        ? {
                                            ...row,
                                            cells: row.cells.map((cell, j) => (j === cIdx ? e.target.value : cell)),
                                          }
                                        : row
                                    );
                                    setSection(idx, { table: { columns: t.columns, rows } });
                                  }}
                                />
                              </td>
                            ))}

                            {!readOnly && r.type === "data" ? (
                              <td className="border px-2 py-1">
                                <button
                                  type="button"
                                  className="text-xs px-2 py-1 rounded-lg border hover:bg-gray-50"
                                  onClick={() => removeRow(idx, rIdx)}
                                  title="Remove row"
                                >
                                  Remove
                                </button>
                              </td>
                            ) : r.type === "header" && !readOnly ? (
                              <td className="border px-2 py-1 text-xs text-neutral-400"> </td>
                            ) : null}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {!readOnly ? (
                    <button
                      type="button"
                      className="text-sm px-3 py-2 rounded-xl border hover:bg-gray-50"
                      onClick={() => addRow(idx)}
                    >
                      + Add row
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
