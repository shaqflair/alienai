// src/app/projects/[id]/artifacts/[artifactId]/ComparePanel.tsx
"use client";

import React, { useMemo, useState } from "react";
import { computeArtifactDiff } from "@/lib/artifacts/diff/compute";
import type { ArtifactDiff, ArtifactDiffItem, DiffOp } from "@/lib/artifacts/diff/types";

type AnyArtifactRow = {
  id: string;
  title?: string | null;
  type?: string | null;
  version?: number | null;
  is_current?: boolean | null;
  is_baseline?: boolean | null;
  content?: string | null;
  content_json?: unknown;
  updated_at?: string | null;
  created_at?: string | null;
};

function safeNum(x: unknown, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function fmtLabel(a: AnyArtifactRow) {
  const v = a.version != null ? `v${safeNum(a.version, 0)}` : "v?";
  const flags = [a.is_baseline ? "Baseline" : null, a.is_current ? "Current" : null].filter(Boolean);
  const suffix = flags.length ? ` • ${flags.join(" / ")}` : "";
  return `${v}${suffix}`;
}

function fmtWhen(x?: string | null) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return String(x);
  }
}

function pickComparableContent(a: AnyArtifactRow): unknown {
  const cj = a.content_json;

  if (cj && typeof cj === "object") return cj;

  if (typeof cj === "string") {
    try {
      return JSON.parse(cj);
    } catch {
      // ignore
    }
  }

  return String(a.content ?? "");
}

function prettyOp(op: DiffOp) {
  if (op === "add") return "ADD";
  if (op === "remove") return "REMOVE";
  return "REPLACE";
}

function opBadgeClass(op: DiffOp) {
  if (op === "add") return "bg-green-50 border-green-200 text-green-800";
  if (op === "remove") return "bg-red-50 border-red-200 text-red-800";
  return "bg-amber-50 border-amber-200 text-amber-900";
}

function compact(v: unknown) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export default function ComparePanel({
  family,
  baseline,
  current,
  defaultAId,
  defaultBId,
}: {
  family: AnyArtifactRow[];
  baseline: AnyArtifactRow | null;
  current: AnyArtifactRow;
  defaultAId?: string | null;
  defaultBId?: string | null;
}) {
  const versions = useMemo(() => {
    const arr = Array.isArray(family) ? [...family] : [];
    arr.sort((a, b) => {
      const va = safeNum(a.version, 0);
      const vb = safeNum(b.version, 0);
      if (va !== vb) return va - vb;
      return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
    });
    return arr;
  }, [family]);

  const baselineId = baseline?.id ? String(baseline.id) : null;
  const currentId = String(current.id);

  const fallbackA = useMemo(() => {
    if (baselineId) return baselineId;
    if (versions[0]?.id) return String(versions[0].id);
    return currentId;
  }, [baselineId, versions, currentId]);

  const fallbackB = useMemo(() => currentId, [currentId]);

  // Validate incoming defaults: must exist in family
  const validIds = useMemo(() => new Set(versions.map((v) => String(v.id))), [versions]);

  const initialA = useMemo(() => {
    const cand = String(defaultAId ?? "");
    return validIds.has(cand) ? cand : fallbackA;
  }, [defaultAId, validIds, fallbackA]);

  const initialB = useMemo(() => {
    const cand = String(defaultBId ?? "");
    return validIds.has(cand) ? cand : fallbackB;
  }, [defaultBId, validIds, fallbackB]);

  const [aId, setAId] = useState<string>(initialA);
  const [bId, setBId] = useState<string>(initialB);

  const a = useMemo(() => versions.find((x) => String(x.id) === String(aId)) ?? null, [versions, aId]);
  const b = useMemo(() => versions.find((x) => String(x.id) === String(bId)) ?? null, [versions, bId]);

  const diff: ArtifactDiff | null = useMemo(() => {
    if (!a || !b) return null;

    const beforeValue = pickComparableContent(a);
    const afterValue = pickComparableContent(b);

    return computeArtifactDiff({
      artifactType: String(current.type ?? b.type ?? "artifact"),
      beforeValue,
      afterValue,
    });
  }, [a, b, current.type]);

  const same = a && b && String(a.id) === String(b.id);

  return (
    <section className="border rounded-2xl bg-white p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="font-medium">Compare versions</div>
          <div className="text-xs text-gray-500">
            Deep-link supported: <span className="font-mono">?a=&lt;id&gt;&amp;b=&lt;id&gt;</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Version A</span>
            <select
              className="border rounded-xl px-3 py-2 text-sm bg-white"
              value={aId}
              onChange={(e) => setAId(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {fmtLabel(v)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600">Version B</span>
            <select
              className="border rounded-xl px-3 py-2 text-sm bg-white"
              value={bId}
              onChange={(e) => setBId(e.target.value)}
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {fmtLabel(v)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Version meta */}
      <div className="grid gap-2 md:grid-cols-2">
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Version A</div>
          <div className="text-sm font-medium">{a ? fmtLabel(a) : "—"}</div>
          <div className="text-xs text-gray-500 mt-1">Updated: {fmtWhen(a?.updated_at ?? a?.created_at ?? null)}</div>
        </div>
        <div className="border rounded-2xl p-4">
          <div className="text-xs text-gray-500">Version B</div>
          <div className="text-sm font-medium">{b ? fmtLabel(b) : "—"}</div>
          <div className="text-xs text-gray-500 mt-1">Updated: {fmtWhen(b?.updated_at ?? b?.created_at ?? null)}</div>
        </div>
      </div>

      {same ? (
        <div className="text-sm text-gray-600 border rounded-2xl p-4 bg-gray-50">
          You selected the same version for A and B — no differences to show.
        </div>
      ) : !diff ? (
        <div className="text-sm text-gray-600 border rounded-2xl p-4 bg-gray-50">
          Select Version A and Version B to see the diff.
        </div>
      ) : diff.items.length === 0 ? (
        <div className="text-sm text-gray-600 border rounded-2xl p-4 bg-gray-50">
          No changes found between the selected versions.
        </div>
      ) : (
        <div className="border rounded-2xl overflow-hidden">
          <div className="grid grid-cols-12 bg-gray-50 border-b text-xs font-medium text-gray-600">
            <div className="col-span-2 px-3 py-2">Change</div>
            <div className="col-span-4 px-3 py-2">Path</div>
            <div className="col-span-3 px-3 py-2">Before</div>
            <div className="col-span-3 px-3 py-2">After</div>
          </div>

          <div className="divide-y">
            {diff.items.map((it: ArtifactDiffItem, idx: number) => (
              <div key={`${it.path}-${idx}`} className="grid grid-cols-12 text-sm">
                <div className="col-span-2 px-3 py-2">
                  <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${opBadgeClass(it.op)}`}>
                    {prettyOp(it.op)}
                  </span>
                </div>

                <div className="col-span-4 px-3 py-2 font-mono text-xs text-gray-800 break-words">
                  {it.path}
                  {it.note ? <div className="mt-1 text-[11px] text-gray-500 font-sans">{it.note}</div> : null}
                </div>

                <div className="col-span-3 px-3 py-2">
                  <pre className="text-xs whitespace-pre-wrap break-words bg-white">{compact(it.before)}</pre>
                </div>

                <div className="col-span-3 px-3 py-2">
                  <pre className="text-xs whitespace-pre-wrap break-words bg-white">{compact(it.after)}</pre>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="text-xs text-gray-500">
        Tip: Use URLs like <span className="font-mono">?a=&lt;id&gt;&amp;b=&lt;id&gt;</span> to share a specific comparison.
      </div>
    </section>
  );
}
