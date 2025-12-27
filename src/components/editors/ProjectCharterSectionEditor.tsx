"use client";

import React, { useMemo } from "react";

type RowObj = { type: "header" | "data"; cells: string[] };

export type CharterSection = {
  key: string;
  title: string;

  // Supported shapes (we accept any of these):
  // A) table model
  table?: { columns: number; rows: RowObj[] };

  // B) columns/rows model (simple array model)
  columns?: string[];
  rows?: string[][];

  // C) bullets model
  bullets?: string;
};

function normalizeToTable(section: CharterSection): { columns: number; rows: RowObj[] } | null {
  // A) Already in table model
  if (section.table?.rows?.length) {
    return {
      columns: Math.max(1, Number(section.table.columns || section.table.rows[0]?.cells?.length || 4)),
      rows: section.table.rows.map((r) => ({
        type: r.type === "header" ? "header" : "data",
        cells: Array.isArray(r.cells) ? r.cells : [],
      })),
    };
  }

  // B) columns/rows model
  if (Array.isArray(section.columns) || Array.isArray(section.rows)) {
    const cols = Array.isArray(section.columns) ? section.columns : [];
    const rows = Array.isArray(section.rows) ? section.rows : [];
    const colCount = Math.max(1, cols.length || rows[0]?.length || 4);

    const out: RowObj[] = [];
    if (cols.length) out.push({ type: "header", cells: pad(cols, colCount) });
    for (const r of rows) out.push({ type: "data", cells: pad(Array.isArray(r) ? r : [], colCount) });

    // If nothing, seed a minimal table so user can edit
    if (out.length === 0) {
      out.push({ type: "header", cells: pad(["", "", "", ""], colCount) });
      out.push({ type: "data", cells: pad(["", "", "", ""], colCount) });
    }

    return { columns: colCount, rows: out };
  }

  // C) bullets only → no table
  return null;
}

function pad(arr: string[], n: number) {
  const out = [...arr.map((x) => String(x ?? ""))];
  while (out.length < n) out.push("");
  return out.slice(0, n);
}

export default function ProjectCharterSectionEditor({
  sections,
  onChange,
  readOnly,
}: {
  sections: CharterSection[];
  onChange: (sections: CharterSection[]) => void;
  readOnly: boolean;
}) {
  // If a section has none of the supported content shapes, seed it with a table so it’s editable.
  const seeded = useMemo(() => {
    let changed = false;
    const next = sections.map((s) => {
      const hasAny =
        (s.table && Array.isArray(s.table.rows)) ||
        Array.isArray(s.columns) ||
        Array.isArray(s.rows) ||
        typeof s.bullets === "string";

      if (hasAny) return s;

      changed = true;
      return {
        ...s,
        table: {
          columns: 4,
          rows: [
            { type: "header", cells: ["", "", "", ""] },
            { type: "data", cells: ["", "", "", ""] },
          ],
        },
      };
    });
    return { next, changed };
  }, [sections]);

  // If we had to seed, push it up once (non-blocking)
  React.useEffect(() => {
    if (seeded.changed) onChange(seeded.next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seeded.changed]);

  function setCell(sectionIndex: number, rowIndex: number, colIndex: number, value: string) {
    const next = structuredClone(seeded.next) as CharterSection[];
    const s = next[sectionIndex];
    const t = normalizeToTable(s);
    if (!t) return;

    // Convert back to table model to avoid multiple shapes drifting
    const table = { columns: t.columns, rows: t.rows };

    table.rows[rowIndex].cells[colIndex] = value;

    next[sectionIndex] = { ...s, table, columns: undefined, rows: undefined }; // canonicalize to table
    onChange(next);
  }

  function setBullets(sectionIndex: number, value: string) {
    const next = structuredClone(seeded.next) as CharterSection[];
    const s = next[sectionIndex];
    next[sectionIndex] = { ...s, bullets: value, table: undefined, columns: undefined, rows: undefined };
    onChange(next);
  }

  return (
    <div className="space-y-6">
      {seeded.next.map((section, sIdx) => {
        const table = normalizeToTable(section);
        const hasBullets = typeof section.bullets === "string" && section.bullets.length >= 0;

        return (
          <div key={section.key} className="space-y-2">
            <h3 className="text-lg font-semibold">
              {sIdx + 1}. {section.title}
            </h3>

            {/* Prefer table if available; otherwise bullets */}
            {table ? (
              <div className="overflow-x-auto border rounded-xl bg-white">
                <table className="w-full border-collapse text-sm">
                  <tbody>
                    {table.rows.map((row, rIdx) => (
                      <tr key={rIdx} className={row.type === "header" ? "bg-gray-50 font-medium" : ""}>
                        {pad(row.cells, table.columns).map((cell, cIdx) => (
                          <td key={cIdx} className="border px-3 py-2 align-top">
                            {readOnly ? (
                              <div className="whitespace-pre-wrap">{cell}</div>
                            ) : (
                              <input
                                value={cell ?? ""}
                                onChange={(e) => setCell(sIdx, rIdx, cIdx, e.target.value)}
                                className="w-full bg-transparent outline-none"
                                placeholder={row.type === "header" ? "Header…" : "Value…"}
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="border rounded-xl bg-white p-3">
                {readOnly ? (
                  <div className="text-sm whitespace-pre-wrap">{section.bullets ?? ""}</div>
                ) : (
                  <textarea
                    value={section.bullets ?? ""}
                    onChange={(e) => setBullets(sIdx, e.target.value)}
                    rows={5}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    placeholder="Add bullet points…"
                  />
                )}
              </div>
            )}

            <div className="text-xs text-neutral-500">{readOnly ? "Read-only" : "Edit directly above."}</div>
          </div>
        );
      })}
    </div>
  );
}
