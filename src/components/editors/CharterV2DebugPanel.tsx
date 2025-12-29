"use client";

import React, { useMemo } from "react";

type RowObj = { type: "header" | "data"; cells: string[] };

type V2Section = {
  key: string;
  title?: string;
  bullets?: string;
  table?: { columns: number; rows: RowObj[] };
  // legacy/compat
  columns?: string[];
  rows?: string[][];
};

type CharterV2Stored = {
  version?: number;
  type?: string;
  meta?: Record<string, any>;
  sections?: V2Section[];
};

function safeKey(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/**
 * ✅ These keys MUST match your REQUIRED_SECTIONS in ProjectCharterEditorForm
 * so the debug countdown behaves correctly.
 */
const REQUIRED_KEYS: string[] = [
  "business_case",
  "objectives",
  "scope_in_out",
  "key_deliverables",
  "milestones_timeline",
  "financials",
  "risks",
  "issues",
  "assumptions",
  "dependencies",
  "project_team",
  "stakeholders",
  "approval_committee",
];

function hasAnyBullets(section: V2Section) {
  return safeStr(section?.bullets).trim().length > 0;
}

function tableHasAnyData(section: V2Section) {
  const t = section?.table;

  // New v2 table
  if (t && Array.isArray(t.rows)) {
    for (const r of t.rows) {
      if (r?.type !== "data") continue;
      const any = (r.cells ?? []).some((c) => safeStr(c).trim().length > 0);
      if (any) return true;
    }
    return false;
  }

  // legacy compat: columns + rows
  const rows = Array.isArray(section?.rows) ? section.rows : [];
  for (const r of rows) {
    const any = (r ?? []).some((c) => safeStr(c).trim().length > 0);
    if (any) return true;
  }
  return false;
}

function isSectionComplete(section: V2Section | undefined) {
  if (!section) return false;
  return hasAnyBullets(section) || tableHasAnyData(section);
}

export default function CharterV2DebugPanel({ value }: { value: any }) {
  const report = useMemo(() => {
    const v: CharterV2Stored = value ?? {};
    const version = Number(v.version);
    const isV2 = version === 2 && Array.isArray(v.sections);

    const sections = Array.isArray(v.sections) ? v.sections : [];
    const map = new Map<string, V2Section>();

    for (const s of sections) {
      const k = safeKey((s as any)?.key);
      if (!k) continue;
      map.set(k, s);
    }

    // Missing means: key not present OR present but empty
    const missingKeys = REQUIRED_KEYS.filter((k) => !isSectionComplete(map.get(k)));

    const completedCount = REQUIRED_KEYS.length - missingKeys.length;

    return {
      isV2,
      completedCount,
      totalRequired: REQUIRED_KEYS.length,
      missingKeys,
      presentKeys: Array.from(map.keys()),
    };
  }, [value]);

  return (
    <div className="rounded-2xl border bg-white p-4">
      <div className="font-semibold">Charter v2 Debug</div>

      <div className="mt-1 text-sm text-neutral-700">
        Format: <span className={report.isV2 ? "text-green-700" : "text-red-600"}>{report.isV2 ? "v2" : "not v2"}</span>{" "}
        • Required sections complete:{" "}
        <span className={report.missingKeys.length === 0 ? "text-green-700 font-semibold" : "text-red-600 font-semibold"}>
          {report.completedCount}/{report.totalRequired}
        </span>
      </div>

      {report.missingKeys.length > 0 ? (
        <div className="mt-2 text-sm">
          <div className="text-red-600 font-medium">
            Missing / incomplete: {report.missingKeys.length}
          </div>
          <div className="mt-1 text-red-600 break-words">
            {report.missingKeys.join(", ")}
          </div>
        </div>
      ) : (
        <div className="mt-2 text-sm text-green-700 font-medium">All required sections have content ✅</div>
      )}

      {/* Optional helper if you want to see what keys are actually present */}
      <details className="mt-3">
        <summary className="cursor-pointer text-xs text-neutral-500">
          Show present section keys
        </summary>
        <div className="mt-2 text-xs text-neutral-600 break-words">
          {report.presentKeys.length ? report.presentKeys.join(", ") : "—"}
        </div>
      </details>
    </div>
  );
}
