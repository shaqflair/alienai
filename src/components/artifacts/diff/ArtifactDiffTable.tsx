// src/components/artifacts/diff/ArtifactDiffTable.tsx
"use client";

import React, { useMemo, useState } from "react";
import type { ArtifactDiff, ArtifactDiffItem } from "@/lib/artifacts/diff/types";

function prettyJson(x: unknown) {
  if (x === null) return "null";
  if (x === undefined) return "—";
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function isMultiLine(x: unknown) {
  if (typeof x !== "string") return false;
  return x.includes("\n") || x.length > 80;
}

function Badge({ op }: { op: ArtifactDiffItem["op"] }) {
  const label = op === "add" ? "Added" : op === "remove" ? "Removed" : "Changed";
  const cls =
    op === "add"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : op === "remove"
      ? "bg-rose-50 text-rose-700 ring-rose-200"
      : "bg-amber-50 text-amber-800 ring-amber-200";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ring-1 ${cls}`}>
      {label}
    </span>
  );
}

function Cell({ value }: { value: unknown }) {
  const text = prettyJson(value);
  const multi = isMultiLine(value) || text.includes("\n") || text.length > 120;

  if (!multi) return <span className="text-sm text-slate-800">{text || "—"}</span>;

  return (
    <pre className="whitespace-pre-wrap break-words rounded-md bg-slate-50 p-2 text-xs text-slate-800 ring-1 ring-slate-200">
      {text || "—"}
    </pre>
  );
}

export default function ArtifactDiffTable({
  diff,
  title = "Proposed Changes",
}: {
  diff: ArtifactDiff | null | undefined;
  title?: string;
}) {
  const [query, setQuery] = useState("");

  const items = useMemo(() => {
    const base = diff?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((i) => {
      const hay = `${i.path} ${i.op} ${prettyJson(i.before)} ${prettyJson(i.after)} ${i.note ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [diff, query]);

  if (!diff) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="text-sm text-slate-600">No diff to display yet.</div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-base font-semibold text-slate-900">{title}</div>
          <div className="text-xs text-slate-600">
            {items.length} change{items.length === 1 ? "" : "s"}
            {diff.artifact_type ? ` • ${diff.artifact_type}` : ""}
          </div>
        </div>

        <input
          className="w-full sm:w-80 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-200"
          placeholder="Filter changes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-[900px] w-full border-collapse">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 border-b border-slate-200 w-[280px]">
                Field
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 border-b border-slate-200 w-[120px]">
                Type
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 border-b border-slate-200">
                Before
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700 border-b border-slate-200">
                After
              </th>
            </tr>
          </thead>

          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-slate-600">
                  Nothing matches your filter.
                </td>
              </tr>
            ) : (
              items.map((it, idx) => (
                <tr key={`${it.path}-${idx}`} className="align-top">
                  <td className="px-3 py-3 border-b border-slate-200">
                    <div className="text-sm font-medium text-slate-900">{it.path}</div>
                    {it.note ? <div className="mt-1 text-xs text-slate-600">{it.note}</div> : null}
                  </td>

                  <td className="px-3 py-3 border-b border-slate-200">
                    <Badge op={it.op} />
                  </td>

                  <td className="px-3 py-3 border-b border-slate-200">
                    {it.op === "add" ? <span className="text-sm text-slate-400">—</span> : <Cell value={it.before} />}
                  </td>

                  <td className="px-3 py-3 border-b border-slate-200">
                    {it.op === "remove" ? <span className="text-sm text-slate-400">—</span> : <Cell value={it.after} />}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        Tip: paths like <code className="rounded bg-slate-50 px-1 ring-1 ring-slate-200">sections[2].table.rows[4]</code>{" "}
        are fine — this view just displays them.
      </div>
    </div>
  );
}
