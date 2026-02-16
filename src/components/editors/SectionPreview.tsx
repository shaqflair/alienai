"use client";

import React from "react";

type RowObj = { type: "header" | "data"; cells: string[] };

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default function SectionPreview({ section }: { section: any }) {
  if (!section) return <div className="text-xs text-neutral-500">—</div>;

  const rows: RowObj[] | null = Array.isArray(section?.table?.rows) ? section.table.rows : null;

  if (rows) {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-200">
        <table className="w-full border-collapse text-xs">
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={row.type === "header" ? "bg-gray-50" : ""}>
                {(row.cells || []).map((cell, j) => (
                  <td
                    key={j}
                    className={`border-t border-gray-200 px-2 py-2 align-top ${
                      j === 0 ? "" : "border-l border-gray-200"
                    } ${row.type === "header" ? "font-semibold text-neutral-900" : "text-neutral-800"}`}
                  >
                    {s(cell).trim() ? (
                      <span className="whitespace-pre-wrap break-words">{s(cell)}</span>
                    ) : (
                      <span className="text-neutral-400">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const bullets = s(section?.bullets);
  if (bullets.trim()) {
    const lines = bullets
      .split("\n")
      .map((l: string) => l.replace(/^[-•]\s*/, "").trim())
      .filter(Boolean);

    return (
      <ul className="list-disc pl-5 text-xs space-y-1 text-neutral-800">
        {lines.length ? lines.map((line: string, i: number) => <li key={i}>{line}</li>) : <li className="text-neutral-400">—</li>}
      </ul>
    );
  }

  return <div className="text-xs text-neutral-500">—</div>;
}
