// src/components/editors/ProjectCharterSectionEditor.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sparkles,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Table as TableIcon,
  List,
  FileText,
  Plus,
  Trash2,
  Calendar as CalendarIcon,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Zap,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isValid } from "date-fns";

/* =========================================================
   Types (matches ProjectCharterEditorFormLazy contract)
========================================================= */

type RowObj = { type: "header" | "data"; cells: string[] };
export type CharterMeta = { title?: string; date?: string; version?: string; author?: string; [key: string]: any };
export type CharterSection = { key: string; title: string; type?: string; content?: string; bullets?: string[]; table?: { columns: number; rows: RowObj[] }; [key: string]: any };
export type ApplySectionPatch = (key: string, patch: any) => void;

export type V2Section = {
  key: string;
  title: string;
  bullets?: string;
  table?: { columns: number; rows: RowObj[] };
};

export type ImproveSectionPayload = {
  sectionKey: string;
  sectionTitle: string;
  section: V2Section;
  selectedText?: string;
  notes?: string;
};

type Props = {
  meta: Record<string, any>;
  onMetaChange: (meta: Record<string, any>) => void;

  sections: V2Section[];
  onChange: (sections: V2Section[]) => void;

  readOnly?: boolean;

  completenessByKey?: Record<
    string,
    { completeness0to100?: number; issues?: Array<{ severity: "info" | "warn" | "error"; message: string }> }
  >;

  onImproveSection?: (payload: ImproveSectionPayload) => void;
  onRegenerateSection?: (sectionKey: string) => void;

  aiDisabled?: boolean;
  aiLoadingKey?: string | null;
};

/* =========================================================
   Small helpers
========================================================= */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function ensureHeaderRow(table: { columns: number; rows: RowObj[] }): { columns: number; rows: RowObj[] } {
  const rows = Array.isArray(table?.rows) ? table.rows.slice() : [];
  const cols = Math.max(1, clampInt(table?.columns, 1, 24, 2));

  if (!rows.length || rows[0]?.type !== "header") {
    const headerCells = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
    return { columns: cols, rows: [{ type: "header", cells: headerCells }, ...rows] };
  }

  const header = rows[0];
  const hc = Array.isArray(header.cells) ? header.cells.slice() : [];
  while (hc.length < cols) hc.push(`Column ${hc.length + 1}`);
  header.cells = hc.slice(0, cols);

  const hasData = rows.some((r) => r.type === "data");
  if (!hasData) rows.push({ type: "data", cells: Array.from({ length: cols }, () => "") });

  const norm = rows.map((r) => {
    const cells = Array.isArray(r.cells) ? r.cells.slice() : [];
    while (cells.length < cols) cells.push("");
    return { ...r, cells: cells.slice(0, cols) };
  });

  return { columns: cols, rows: norm };
}

/* =========================================================
   Guards: prevent accidental structural delete
========================================================= */

function guardTableCellKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Backspace" || e.key === "Delete") {
    e.stopPropagation();
    return;
  }
  if (e.key === "Enter") {
    e.stopPropagation();
    return;
  }
}

/* =========================================================
   UK date helpers (dd/mm/yyyy)
========================================================= */

function isIsoDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function isIsoDateTime(v: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
}
function isUkDate(v: string) {
  return /^\d{2}\/\d{2}\/\d{4}$/.test(v);
}

function parseUkDate(v: string): Date | null {
  if (!v) return null;
  if (isUkDate(v)) {
    const [day, month, year] = v.split("/").map(Number);
    const d = new Date(year, month - 1, day);
    return isValid(d) ? d : null;
  }
  if (isIsoDateOnly(v) || isIsoDateTime(v)) {
    const d = new Date(isIsoDateOnly(v) ? `${v}T00:00:00` : v);
    return isValid(d) ? d : null;
  }
  const m = v.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return isValid(d) ? d : null;
  }
  return null;
}

function toUkDateDisplay(value: string) {
  const s = safeStr(value).trim();
  if (!s) return "";
  if (isUkDate(s)) return s;

  if (isIsoDateOnly(s) || isIsoDateTime(s)) {
    const d = new Date(isIsoDateOnly(s) ? `${s}T00:00:00` : s);
    if (!Number.isNaN(d.getTime())) {
      try {
        return format(d, "dd/MM/yyyy");
      } catch {}
    }
  }

  const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    const yyyy = String(m[3]);
    return `${dd}/${mm}/${yyyy}`;
  }

  return s;
}

function formatDateToUk(date: Date | undefined): string {
  if (!date || !isValid(date)) return "";
  return format(date, "dd/MM/yyyy");
}

function normalizeUkDateInput(value: string) {
  return toUkDateDisplay(value);
}

function headerSuggestsDate(header: string) {
  const h = safeStr(header).toLowerCase();
  return h.includes("date");
}

/* =========================================================
   Bullets helpers (auto bullet on Enter)
========================================================= */

function insertAtCursor(el: HTMLTextAreaElement, insert: string, afterCaretOffset = 0) {
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  const before = el.value.slice(0, start);
  const after = el.value.slice(end);
  const next = before + insert + after;
  const nextPos = start + insert.length + afterCaretOffset;
  return { next, nextPos };
}

function currentLinePrefix(text: string, cursorPos: number) {
  const before = text.slice(0, cursorPos);
  const lastNl = before.lastIndexOf("\n");
  const line = before.slice(lastNl + 1);
  const trimmed = line.trimStart();
  const indent = line.match(/^\s*/)?.[0] ?? "";
  const markerMatch = trimmed.match(/^([•\-\*])\s*/);
  const marker = markerMatch?.[1] ?? "•";
  return { indent, marker };
}

function normalizeBulletsToList(text: string) {
  const raw = safeStr(text);
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const cleaned = lines.map((l) =>
    l.replace(/^\s*(?:[•\u2022\-\*\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/g, "")
  );
  return cleaned;
}

/* =========================================================
   Special section rendering rules
========================================================= */

function isFreeTextSectionKey(k: string) {
  const key = safeStr(k).toLowerCase();
  return key === "business_case" || key === "objectives";
}

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

/* =========================================================
   Completeness Ring (SVG radial progress)
========================================================= */

function CompletenessRing({ score, size = 32 }: { score: number; size?: number }) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color =
    score >= 80 ? "#059669" : score >= 40 ? "#d97706" : "#e11d48";
  const bg =
    score >= 80 ? "#d1fae5" : score >= 40 ? "#fef3c7" : "#ffe4e6";

  return (
    <div className="relative" style={{ width: size, height: size }} title={`${score}% complete`}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bg} strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1)" }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-mono font-bold"
        style={{ fontSize: size * 0.28, color }}
      >
        {score}
      </span>
    </div>
  );
}

/* =========================================================
   Component
========================================================= */

export default function ProjectCharterSectionEditor({
  meta,
  onMetaChange,
  sections,
  onChange,
  readOnly = false,
  completenessByKey,
  onImproveSection,
  onRegenerateSection,
  aiDisabled = false,
  aiLoadingKey = null,
}: Props) {
  const safeSections = useMemo(() => (Array.isArray(sections) ? sections : []), [sections]);

  // ✅ local draft meta state so typing never gets clobbered by doc re-hydration
  const didInitMetaRef = useRef(false);
  const lastMetaEditAtRef = useRef<number>(0);

  const [metaDraft, setMetaDraft] = useState<Record<string, any>>(() => ({
    project_title: "",
    project_manager: "",
    sponsor: "",
    dates: "",
  }));

  // init once (or when meta becomes available the first time)
  useEffect(() => {
    if (didInitMetaRef.current) return;

    const incoming = meta && typeof meta === "object" ? meta : {};
    setMetaDraft({
      project_title: safeStr((incoming as any).project_title),
      project_manager: safeStr((incoming as any).project_manager),
      sponsor: safeStr((incoming as any).sponsor),
      dates: safeStr((incoming as any).dates),
    });

    didInitMetaRef.current = true;
  }, [meta]);

  // If parent meta changes later, we allow sync ONLY if user hasn't typed recently.
  // Additionally, we seed empty local fields from incoming values.
  useEffect(() => {
    if (!didInitMetaRef.current) return;

    const sinceEdit = Date.now() - (lastMetaEditAtRef.current || 0);
    if (sinceEdit < 1200) return;

    const incoming = meta && typeof meta === "object" ? meta : {};
    const incomingTitle = safeStr((incoming as any).project_title);
    const incomingPm = safeStr((incoming as any).project_manager);
    const incomingSponsor = safeStr((incoming as any).sponsor);
    const incomingDates = safeStr((incoming as any).dates);

    setMetaDraft((cur) => {
      const next = { ...(cur || {}) };

      if (!safeStr(next.project_title).trim() && incomingTitle.trim()) next.project_title = incomingTitle;
      if (!safeStr(next.project_manager).trim() && incomingPm.trim()) next.project_manager = incomingPm;
      if (!safeStr(next.sponsor).trim() && incomingSponsor.trim()) next.sponsor = incomingSponsor;
      if (!safeStr(next.dates).trim() && incomingDates.trim()) next.dates = incomingDates;

      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  // Debounced push up to parent
  useEffect(() => {
    if (!didInitMetaRef.current) return;
    if (readOnly) return;

    const t = setTimeout(() => {
      onMetaChange({
        ...(meta && typeof meta === "object" ? meta : {}),
        ...metaDraft,
      });
    }, 350);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaDraft, readOnly]);

  function patchSection(idx: number, next: Partial<V2Section>) {
    if (readOnly) return;
    const arr = safeSections.slice();
    const cur = arr[idx] || { key: "", title: "" };
    arr[idx] = { ...cur, ...next };
    onChange(arr);
  }

  function patchTable(idx: number, nextTable: { columns: number; rows: RowObj[] }) {
    patchSection(idx, { table: ensureHeaderRow(nextTable) as { columns: number; rows: RowObj[] }, bullets: undefined });
  }

  function patchBullets(idx: number, text: string) {
    patchSection(idx, { bullets: text, table: undefined });
  }

  function addTableRow(idx: number) {
    if (readOnly) return;
    const s = safeSections[idx];
    const t = ensureHeaderRow(s?.table ?? { columns: 2, rows: [] }) as { columns: number; rows: RowObj[] };
    t.rows.push({ type: "data", cells: Array.from({ length: t.columns }, () => "") });
    patchTable(idx, t);
  }

  function delTableRow(idx: number, rowIndexInData: number) {
    if (readOnly) return;
    const s = safeSections[idx];
    const t = ensureHeaderRow(s?.table ?? { columns: 2, rows: [] }) as { columns: number; rows: RowObj[] };

    const dataIdxs = t.rows
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.type === "data")
      .map((x) => x.i);

    const target = dataIdxs[rowIndexInData];
    if (target == null) return;

    const nextRows = t.rows.slice();
    nextRows.splice(target, 1);

    const stillHasData = nextRows.some((r) => r.type === "data");
    if (!stillHasData) nextRows.push({ type: "data", cells: Array.from({ length: t.columns }, () => "") });

    patchTable(idx, { columns: t.columns, rows: nextRows as RowObj[] });
  }

  function addColumn(idx: number) {
    if (readOnly) return;
    const s = safeSections[idx];
    const t = ensureHeaderRow(s?.table ?? { columns: 2, rows: [] }) as { columns: number; rows: RowObj[] };
    const cols = Math.min(24, (t.columns || 2) + 1);
    const nextRows = t.rows.map((r) => ({
      ...r,
      cells: [...(r.cells ?? []), r.type === "header" ? `Column ${cols}` : ""],
    }));
    patchTable(idx, { columns: cols, rows: nextRows as RowObj[] });
  }

  function delColumn(idx: number, colIndex: number) {
    if (readOnly) return;
    const s = safeSections[idx];
    const t = ensureHeaderRow(s?.table ?? { columns: 2, rows: [] }) as { columns: number; rows: RowObj[] };
    if (t.columns <= 1) return;

    const cols = t.columns - 1;
    const nextRows = t.rows.map((r) => {
      const cells = (r.cells ?? []).slice();
      cells.splice(colIndex, 1);
      return { ...r, cells };
    });

    patchTable(idx, { columns: cols, rows: nextRows as RowObj[] });
  }

  const [metaOpen, setMetaOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});

  const toggleSection = (idx: number) => {
    setExpandedSections((prev) => ({ ...prev, [idx]: prev[idx] === false ? true : prev[idx] === undefined ? false : !prev[idx] }));
  };

  const isSectionExpanded = (idx: number) => expandedSections[idx] !== false;

  return (
    <div
      className="min-h-screen"
      style={{
        background: "linear-gradient(168deg, #f8f9fc 0%, #f1f3f9 35%, #eef0f7 100%)",
        fontFamily: "'DM Sans', 'Satoshi', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Inject font */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,500;0,9..144,700;1,9..144,400&display=swap');

        .charter-editor * {
          font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
        }
        .charter-editor .font-display {
          font-family: 'Fraunces', Georgia, serif;
        }
        .charter-editor .font-mono {
          font-family: 'DM Mono', 'SF Mono', monospace;
        }

        .charter-section-card {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .charter-section-card:hover {
          transform: translateY(-1px);
        }

        .charter-input {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .charter-input:focus {
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08), 0 1px 2px rgba(0, 0, 0, 0.05);
        }

        .charter-textarea {
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .charter-textarea:focus {
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
        }

        .charter-btn-ai {
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%);
          background-size: 200% 200%;
          animation: shimmer-bg 3s ease infinite;
          transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .charter-btn-ai:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 4px 16px rgba(99, 102, 241, 0.3);
        }
        .charter-btn-ai:disabled {
          opacity: 0.5;
          background: #94a3b8;
        }

        @keyframes shimmer-bg {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        .charter-table-row {
          transition: background-color 0.15s ease;
        }
        .charter-table-row:hover {
          background-color: rgba(99, 102, 241, 0.02);
        }

        .fade-in {
          animation: fadeIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .section-collapse-enter {
          animation: collapseIn 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }
        @keyframes collapseIn {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 2000px; }
        }
      `}</style>

      <div className="charter-editor p-5 md:p-8 space-y-6 max-w-[1400px] mx-auto">
        {/* ── Meta Card ── */}
        <div
          className="rounded-2xl border border-white/60 bg-white/80 backdrop-blur-xl overflow-hidden"
          style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.03)" }}
        >
          <button
            type="button"
            className="w-full flex items-center justify-between px-6 py-5 hover:bg-slate-50/50 transition-colors"
            onClick={() => setMetaOpen((v) => !v)}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)" }}
              >
                <FileText className="h-[18px] w-[18px] text-indigo-600" />
              </div>
              <div className="text-left">
                <div className="font-display text-[15px] font-medium text-slate-900 tracking-[-0.01em]">
                  Charter Details
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  Project metadata for exports and reports
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!metaOpen && safeStr(metaDraft?.project_title).trim() && (
                <span className="text-xs text-slate-400 font-medium hidden sm:block truncate max-w-[200px]">
                  {safeStr(metaDraft?.project_title)}
                </span>
              )}
              <div
                className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center transition-transform"
                style={{ transform: metaOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}
              >
                <ChevronDown className="h-4 w-4 text-slate-500" />
              </div>
            </div>
          </button>

          {metaOpen && (
            <div className="px-6 pb-6 fade-in">
              <div className="h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-5" />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <MetaField
                  label="Project Title"
                  value={safeStr(metaDraft?.project_title)}
                  disabled={readOnly}
                  onChange={(v) => {
                    lastMetaEditAtRef.current = Date.now();
                    setMetaDraft((s) => ({ ...(s || {}), project_title: v }));
                  }}
                />
                <MetaField
                  label="Project Manager"
                  value={safeStr(metaDraft?.project_manager)}
                  disabled={readOnly}
                  onChange={(v) => {
                    lastMetaEditAtRef.current = Date.now();
                    setMetaDraft((s) => ({ ...(s || {}), project_manager: v }));
                  }}
                />
                <MetaField
                  label="Sponsor"
                  value={safeStr(metaDraft?.sponsor)}
                  disabled={readOnly}
                  onChange={(v) => {
                    lastMetaEditAtRef.current = Date.now();
                    setMetaDraft((s) => ({ ...(s || {}), sponsor: v }));
                  }}
                />
                <MetaField
                  label="Dates"
                  value={safeStr(metaDraft?.dates)}
                  disabled={readOnly}
                  onChange={(v) => {
                    lastMetaEditAtRef.current = Date.now();
                    setMetaDraft((s) => ({ ...(s || {}), dates: v }));
                  }}
                  placeholder="e.g., Start 01/03/2026 · End 30/06/2026"
                />
              </div>

              <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-400 tracking-wide uppercase">
                <div className="w-1 h-1 rounded-full bg-indigo-300" />
                These fields power your exports
              </div>
            </div>
          )}
        </div>

        {/* ── Sections ── */}
        <div className="space-y-4">
          {safeSections.map((sec, idx) => {
            const key = safeStr(sec?.key).trim();
            const title = safeStr(sec?.title).trim() || key || `Section ${idx + 1}`;

            const isTable = !!sec?.table?.rows?.length;
            const comp = completenessByKey?.[key];
            const score = clampInt(comp?.completeness0to100, 0, 100, 0);

            const freeText = !isTable && isFreeTextSectionKey(key);
            const isLoading = aiLoadingKey === key;
            const expanded = isSectionExpanded(idx);

            return (
              <div
                key={`${key || "sec"}_${idx}`}
                className="charter-section-card rounded-2xl border border-white/60 bg-white/80 backdrop-blur-xl overflow-hidden"
                style={{
                  boxShadow: isLoading
                    ? "0 0 0 2px rgba(99, 102, 241, 0.15), 0 4px 24px rgba(99, 102, 241, 0.08)"
                    : "0 1px 3px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.03)",
                  transition: "box-shadow 0.3s ease",
                }}
              >
                {/* Section Header */}
                <div className="flex items-center gap-3 px-5 md:px-6 py-4">
                  {/* Collapse toggle */}
                  <button
                    type="button"
                    onClick={() => toggleSection(idx)}
                    className="shrink-0 w-7 h-7 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
                  >
                    <ChevronDown
                      className="h-4 w-4 text-slate-400 transition-transform"
                      style={{ transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s ease" }}
                    />
                  </button>

                  {/* Icon */}
                  <div
                    className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{
                      background: isTable
                        ? "linear-gradient(135deg, #dbeafe 0%, #bfdbfe 100%)"
                        : "linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)",
                    }}
                  >
                    {isTable ? (
                      <TableIcon className="h-4 w-4 text-blue-600" />
                    ) : (
                      <List className="h-4 w-4 text-emerald-600" />
                    )}
                  </div>

                  {/* Title + score */}
                  <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                    <span className="font-display text-[15px] font-medium text-slate-900 tracking-[-0.01em] truncate">
                      {title}
                    </span>

                    {isLoading && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-indigo-600 font-medium bg-indigo-50 rounded-full px-2.5 py-1 border border-indigo-100">
                        <Zap className="h-3 w-3 animate-pulse" />
                        AI working…
                      </span>
                    )}
                  </div>

                  {/* Completeness ring */}
                  {completenessByKey && key ? (
                    <div className="shrink-0">
                      <CompletenessRing score={score} size={36} />
                    </div>
                  ) : null}

                  {/* AI action buttons */}
                  <div className="shrink-0 flex items-center gap-2">
                    {onImproveSection ? (
                      <button
                        type="button"
                        disabled={readOnly || aiDisabled}
                        onClick={() =>
                          onImproveSection({
                            sectionKey: key,
                            sectionTitle: title,
                            section: sec,
                            selectedText: "",
                          })
                        }
                        className="charter-btn-ai inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-medium disabled:cursor-not-allowed"
                        title="Improve this section with AI"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Improve</span>
                      </button>
                    ) : null}

                    {onRegenerateSection ? (
                      <button
                        type="button"
                        disabled={readOnly || aiDisabled || !key || isLoading}
                        onClick={() => key && onRegenerateSection(key)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                        title="Regenerate this section with AI"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${isLoading ? "animate-spin text-indigo-500" : ""}`}
                        />
                        <span className="hidden sm:inline">{isLoading ? "Working…" : "Regen"}</span>
                      </button>
                    ) : null}
                  </div>
                </div>

                {/* Issues banner */}
                {key && comp?.issues?.length ? (
                  <div className="mx-5 md:mx-6 mb-2">
                    <div className="rounded-xl bg-amber-50/70 border border-amber-200/60 px-4 py-3 flex items-start gap-3">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                      <div className="space-y-1">
                        {comp.issues.slice(0, 2).map((it, i) => (
                          <div key={i} className="text-xs text-slate-600 leading-relaxed">
                            <span
                              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider mr-1.5 ${
                                it.severity === "error"
                                  ? "bg-rose-100 text-rose-700"
                                  : it.severity === "warn"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-blue-100 text-blue-700"
                              }`}
                            >
                              {it.severity}
                            </span>
                            {it.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Section content */}
                {expanded && (
                  <div className="px-5 md:px-6 pb-5 fade-in">
                    <div className="h-px bg-gradient-to-r from-transparent via-slate-100 to-transparent mb-5" />

                    {isTable ? (
                      <TableEditor
                        value={ensureHeaderRow(sec.table!) as { columns: number; rows: RowObj[] }}
                        readOnly={readOnly}
                        onChange={(t) => patchTable(idx, t)}
                        onAddRow={() => addTableRow(idx)}
                        onAddCol={() => addColumn(idx)}
                        onDelCol={(c) => delColumn(idx, c)}
                        onDelRow={(dataRowIndex) => delTableRow(idx, dataRowIndex)}
                      />
                    ) : freeText ? (
                      <FreeTextEditor
                        value={safeStr(sec?.bullets)}
                        readOnly={readOnly}
                        onChange={(v) => patchBullets(idx, v)}
                        label="Free text"
                        placeholder="Write in short paragraphs. Keep it executive-friendly."
                      />
                    ) : (
                      <BulletsEditor
                        value={safeStr(sec?.bullets)}
                        readOnly={readOnly}
                        onChange={(v) => patchBullets(idx, v)}
                      />
                    )}

                    {key && completenessByKey && score >= 80 ? (
                      <div className="mt-4 flex items-center gap-2.5 text-xs text-emerald-700 bg-emerald-50/80 rounded-xl px-4 py-2.5 border border-emerald-200/60">
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="font-medium">Ready for export</span>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   UI bits
========================================================= */

function MetaField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-[11px] font-semibold text-slate-500 tracking-wide uppercase">{label}</label>
      <input
        className="charter-input w-full rounded-xl border border-slate-200/80 bg-white px-4 py-3 text-sm text-slate-900 outline-none focus:border-indigo-300 disabled:bg-slate-50/80 disabled:text-slate-400 placeholder:text-slate-300 transition-all"
        value={value}
        disabled={!!disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function FreeTextEditor({
  value,
  readOnly,
  onChange,
  label = "Free text",
  placeholder,
}: {
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
  label?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400 tracking-wide uppercase">
        <FileText className="h-3 w-3" />
        {label}
      </div>
      <textarea
        className="charter-textarea w-full min-h-[200px] rounded-xl border border-slate-200/80 bg-white p-4 text-sm text-slate-900 outline-none focus:border-indigo-300 disabled:bg-slate-50/80 disabled:text-slate-400 placeholder:text-slate-300 resize-y leading-relaxed transition-all"
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Write here..."}
      />
    </div>
  );
}

function BulletsEditor({
  value,
  readOnly,
  onChange,
}: {
  value: string;
  readOnly: boolean;
  onChange: (v: string) => void;
}) {
  useMemo(() => normalizeBulletsToList(value), [value]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-400 tracking-wide uppercase">
        <List className="h-3 w-3" />
        Bullet points — one per line
      </div>

      <textarea
        className="charter-textarea w-full min-h-[180px] rounded-xl border border-slate-200/80 bg-white p-4 text-sm text-slate-900 outline-none focus:border-indigo-300 disabled:bg-slate-50/80 disabled:text-slate-400 placeholder:text-slate-300 resize-y leading-relaxed transition-all"
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        placeholder="• Add bullet points here..."
        onKeyDown={(e) => {
          if (readOnly) return;

          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();

            const el = e.currentTarget;
            const pos = el.selectionStart ?? el.value.length;
            const { indent, marker } = currentLinePrefix(el.value, pos);

            const insert = `\n${indent}${marker} `;
            const { next, nextPos } = insertAtCursor(el, insert);
            onChange(next);

            requestAnimationFrame(() => {
              try {
                el.selectionStart = el.selectionEnd = nextPos;
              } catch {}
            });
          }
        }}
      />
    </div>
  );
}

/* =========================================================
   Date Picker Cell Component
========================================================= */

function DatePickerCell({
  value,
  onChange,
  disabled,
  placeholder = "dd/mm/yyyy",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);

  const date = useMemo(() => parseUkDate(value), [value]);
  const displayValue = useMemo(() => toUkDateDisplay(value), [value]);

  const handleSelect = (selectedDate: Date | undefined) => {
    if (selectedDate && isValid(selectedDate)) {
      onChange(formatDateToUk(selectedDate));
    }
    setOpen(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  const handleBlur = () => {
    const normalized = normalizeUkDateInput(value);
    if (normalized !== value) onChange(normalized);
  };

  if (disabled) {
    return (
      <div className="w-full px-3 py-2 text-sm text-slate-500 bg-slate-50/80 rounded-lg border border-slate-200/60 font-mono text-[13px]">
        {displayValue || placeholder}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        className="charter-input flex-1 min-w-0 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-sm font-mono text-[13px] outline-none focus:border-indigo-300 transition-all"
        value={displayValue}
        placeholder={placeholder}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={guardTableCellKeys}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="shrink-0 p-2 rounded-lg border border-slate-200/80 hover:bg-indigo-50 hover:border-indigo-200 transition-all text-slate-400 hover:text-indigo-600"
            title="Pick date"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar mode="single" selected={date || undefined} onSelect={handleSelect} initialFocus className="rounded-xl border-0" />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* =========================================================
   Table Editor with Date Picker Support
========================================================= */

function TableEditor({
  value,
  readOnly,
  onChange,
  onAddRow,
  onAddCol,
  onDelRow,
  onDelCol,
}: {
  value: { columns: number; rows: RowObj[] };
  readOnly: boolean;
  onChange: (t: { columns: number; rows: RowObj[] }) => void;
  onAddRow: () => void;
  onAddCol: () => void;
  onDelRow: (dataRowIndex: number) => void;
  onDelCol: (colIndex: number) => void;
}) {
  const t = ensureHeaderRow(value) as { columns: number; rows: RowObj[] };
  const header = t.rows[0].cells;
  const dataRows = t.rows.filter((r) => r.type === "data");

  const dateCols = useMemo(() => {
    const idxs = new Set<number>();
    header.forEach((h, i) => {
      if (headerSuggestsDate(h)) idxs.add(i);
    });
    return idxs;
  }, [header.join("|")]);

  function setHeader(col: number, v: string) {
    const next = ensureHeaderRow(t) as { columns: number; rows: RowObj[] };
    next.rows[0].cells[col] = v;
    onChange(next);
  }

  function setCell(dataRowIndex: number, col: number, v: string) {
    const next = ensureHeaderRow(t) as { columns: number; rows: RowObj[] };
    const dataIdxs = next.rows
      .map((r, i) => ({ r, i }))
      .filter((x) => x.r.type === "data")
      .map((x) => x.i);

    const rowIdx = dataIdxs[dataRowIndex];
    if (rowIdx == null) return;

    next.rows[rowIdx].cells[col] = v;
    onChange(next);
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border border-slate-200/70" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)" }}>
                {header.map((h, i) => (
                  <th key={i} className="px-4 py-3.5 text-left align-middle border-b border-slate-200/70 border-r border-r-slate-100 last:border-r-0">
                    <div className="flex items-center gap-2">
                      <input
                        className="w-full bg-transparent outline-none text-[11px] font-bold text-slate-600 tracking-wide uppercase placeholder:text-slate-300"
                        value={safeStr(h)}
                        disabled={readOnly}
                        onChange={(e) => setHeader(i, e.target.value)}
                        onKeyDown={guardTableCellKeys}
                        placeholder={`Column ${i + 1}`}
                      />

                      {!readOnly && t.columns > 1 ? (
                        <button
                          type="button"
                          className="shrink-0 rounded-md p-1 opacity-0 group-hover:opacity-100 hover:bg-rose-50 text-slate-300 hover:text-rose-500 transition-all"
                          title="Delete this column"
                          onClick={() => onDelCol(i)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      ) : null}
                    </div>
                  </th>
                ))}
                {!readOnly ? <th className="w-12 px-2 py-3.5 border-b border-slate-200/70" style={{ background: "linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)" }} /> : null}
              </tr>
            </thead>

            <tbody>
              {dataRows.map((r, ri) => (
                <tr key={ri} className="charter-table-row border-b border-slate-100/80 last:border-b-0">
                  {header.map((_, ci) => {
                    const isDate = dateCols.has(ci);
                    const raw = safeStr(r.cells?.[ci]);

                    return (
                      <td key={ci} className="px-4 py-3 align-top border-r border-slate-100/60 last:border-r-0">
                        {isDate ? (
                          <DatePickerCell value={raw} onChange={(v) => setCell(ri, ci, v)} disabled={readOnly} />
                        ) : (
                          <input
                            className="charter-input w-full outline-none bg-transparent text-slate-700 placeholder:text-slate-300 text-[13px]"
                            value={raw}
                            disabled={readOnly}
                            onChange={(e) => setCell(ri, ci, e.target.value)}
                            onKeyDown={guardTableCellKeys}
                          />
                        )}
                      </td>
                    );
                  })}

                  {!readOnly ? (
                    <td className="px-2 py-3 text-center">
                      <button
                        type="button"
                        onClick={() => onDelRow(ri)}
                        className="rounded-lg p-1.5 hover:bg-rose-50 text-slate-300 hover:text-rose-500 transition-all"
                        title="Delete row"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-2.5 items-center">
          <button
            type="button"
            onClick={onAddRow}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> Row
          </button>
          <button
            type="button"
            onClick={onAddCol}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-dashed border-slate-300 text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/50 transition-all"
          >
            <Plus className="h-3.5 w-3.5" /> Column
          </button>

          <span className="ml-auto font-mono text-[11px] text-slate-300 tracking-wide">
            {dataRows.length}r × {header.length}c
          </span>
        </div>
      ) : null}
    </div>
  );
}
