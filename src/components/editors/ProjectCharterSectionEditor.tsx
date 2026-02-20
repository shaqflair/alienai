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
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isValid } from "date-fns";

/* =========================================================
   Types (matches ProjectCharterEditorFormLazy contract)
========================================================= */

type RowObj = { type: "header" | "data"; cells: string[] };

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

function ensureHeaderRow(table: { columns: number; rows: RowObj[] }) {
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

  // If parent meta changes later, we allow sync ONLY if user hasn’t typed recently.
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
    patchSection(idx, { table: ensureHeaderRow(nextTable), bullets: undefined });
  }

  function patchBullets(idx: number, text: string) {
    patchSection(idx, { bullets: text, table: undefined });
  }

  function addTableRow(idx: number) {
    if (readOnly) return;
    const s = safeSections[idx];
    const t = ensureHeaderRow(s?.table ?? { columns: 2, rows: [] });
    t.rows.push({ type: "data", cells: Array.from({ length: t.columns }, () => "") });
    patchTable(idx, t);
  }

  function delTableRow(idx: number, rowIndexInData: number) {
    if (readOnly) return;
    const s = safeSections[idx];
    const t = ensureHeaderRow(s?.table ?? { columns: 2, rows: [] });

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

    patchTable(idx, { columns: t.columns, rows: nextRows });
  }

  function addColumn(idx: number) {
    if (readOnly) return;
    const s = safeSections[idx];
    const t = ensureHeaderRow(s?.table ?? { columns: 2, rows: [] });
    const cols = Math.min(24, (t.columns || 2) + 1);
    const nextRows = t.rows.map((r) => ({
      ...r,
      cells: [...(r.cells ?? []), r.type === "header" ? `Column ${cols}` : ""],
    }));
    patchTable(idx, { columns: cols, rows: nextRows });
  }

  function delColumn(idx: number, colIndex: number) {
    if (readOnly) return;
    const s = safeSections[idx];
    const t = ensureHeaderRow(s?.table ?? { columns: 2, rows: [] });
    if (t.columns <= 1) return;

    const cols = t.columns - 1;
    const nextRows = t.rows.map((r) => {
      const cells = (r.cells ?? []).slice();
      cells.splice(colIndex, 1);
      return { ...r, cells };
    });

    patchTable(idx, { columns: cols, rows: nextRows });
  }

  const [metaOpen, setMetaOpen] = useState(true);

  return (
    <div className="space-y-6 p-6 bg-slate-50/50 min-h-screen">
      {/* Meta */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <FileText className="h-4 w-4 text-indigo-600" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-900">Charter Details</div>
            </div>
          </div>

          <button
            type="button"
            className="text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-100"
            onClick={() => setMetaOpen((v) => !v)}
          >
            {metaOpen ? "Hide" : "Show"}
          </button>
        </div>

        {metaOpen && (
          <div className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                label="Dates (free text)"
                value={safeStr(metaDraft?.dates)}
                disabled={readOnly}
                onChange={(v) => {
                  lastMetaEditAtRef.current = Date.now();
                  setMetaDraft((s) => ({ ...(s || {}), dates: v }));
                }}
                placeholder="e.g., Start 01/03/2026 • End 30/06/2026"
              />
            </div>

            <div className="mt-4 text-xs text-slate-400 flex items-center gap-2">
              <Sparkles className="h-3 w-3" />
              These fields power your exports.
            </div>
          </div>
        )}
      </div>

      {/* Sections */}
      <div className="space-y-5">
        {safeSections.map((sec, idx) => {
          const key = safeStr(sec?.key).trim();
          const title = safeStr(sec?.title).trim() || key || `Section ${idx + 1}`;

          const isTable = !!sec?.table?.rows?.length;
          const comp = completenessByKey?.[key];
          const score = clampInt(comp?.completeness0to100, 0, 100, 0);

          const icon = isTable ? (
            <div className="p-2 bg-blue-50 rounded-lg">
              <TableIcon className="h-4 w-4 text-blue-600" />
            </div>
          ) : (
            <div className="p-2 bg-emerald-50 rounded-lg">
              <List className="h-4 w-4 text-emerald-600" />
            </div>
          );

          const freeText = !isTable && isFreeTextSectionKey(key);

          return (
            <div
              key={`${key || "sec"}_${idx}`}
              className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden hover:shadow-md transition-shadow"
            >
              <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50/50 to-white flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3">
                    {icon}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="text-sm font-semibold text-slate-900">{title}</div>

                      {completenessByKey && key ? (
                        <span
                          className={`text-[11px] px-2.5 py-1 rounded-full border font-medium ${
                            score >= 80
                              ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                              : score >= 40
                              ? "bg-amber-50 border-amber-200 text-amber-700"
                              : "bg-rose-50 border-rose-200 text-rose-700"
                          }`}
                          title="Completeness score"
                        >
                          {score}%
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {key && comp?.issues?.length ? (
                    <div className="mt-3 flex items-start gap-2 text-xs">
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-500" />
                      <div className="space-y-1">
                        {comp.issues.slice(0, 2).map((it, i) => (
                          <div key={i} className="text-slate-600">
                            <span
                              className={`font-medium ${
                                it.severity === "error"
                                  ? "text-rose-600"
                                  : it.severity === "warn"
                                  ? "text-amber-600"
                                  : "text-blue-600"
                              }`}
                            >
                              {it.severity.toUpperCase()}:
                            </span>{" "}
                            {it.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {/* ✅ Context removed. Only Improve + Regenerate. */}
                  {onImproveSection ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={readOnly || aiDisabled}
                      onClick={() =>
                        onImproveSection({
                          sectionKey: key,
                          sectionTitle: title,
                          section: sec,
                          selectedText: "",
                        })
                      }
                      className="rounded-lg border-indigo-200 hover:bg-indigo-50 hover:border-indigo-300"
                      title="Improve this section with AI"
                    >
                      <Sparkles className="h-4 w-4 mr-2 text-indigo-600" />
                      Improve
                    </Button>
                  ) : null}

                  {onRegenerateSection ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={readOnly || aiDisabled || !key || aiLoadingKey === key}
                      onClick={() => key && onRegenerateSection(key)}
                      className="rounded-lg border-slate-200 hover:bg-slate-50"
                      title="Regenerate this section with AI"
                    >
                      <RefreshCw
                        className={`h-4 w-4 mr-2 ${
                          aiLoadingKey === key ? "animate-spin text-indigo-600" : "text-slate-600"
                        }`}
                      />
                      {aiLoadingKey === key ? "Working..." : "Regenerate"}
                    </Button>
                  ) : null}
                </div>
              </div>

              <div className="p-5">
                {isTable ? (
                  <TableEditor
                    value={ensureHeaderRow(sec.table!)}
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
                  <div className="mt-4 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2 border border-emerald-100">
                    <CheckCircle2 className="h-4 w-4" />
                    Looks good for export.
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
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
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">{label}</label>
      <input
        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400 transition-all"
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
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-500 flex items-center gap-2">
        <FileText className="h-3 w-3" />
        {label}
      </div>
      <textarea
        className="w-full min-h-[180px] rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400 resize-y transition-all leading-relaxed"
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
      <div className="text-xs font-medium text-slate-500 flex items-center gap-2">
        <List className="h-3 w-3" />
        Bullet points (one per line)
      </div>

      <textarea
        className="w-full min-h-[160px] rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-400 resize-y transition-all leading-relaxed"
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
      <div className="w-full px-3 py-2 text-sm text-slate-600 bg-slate-50 rounded-md border border-slate-200">
        {displayValue || placeholder}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        className="flex-1 min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 transition-all"
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
            className="p-2 rounded-md border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors text-slate-500 hover:text-indigo-600"
            title="Pick date"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar mode="single" selected={date || undefined} onSelect={handleSelect} initialFocus className="rounded-lg border-0" />
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
  const t = ensureHeaderRow(value);
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
    const next = ensureHeaderRow(t);
    next.rows[0].cells[col] = v;
    onChange(next);
  }

  function setCell(dataRowIndex: number, col: number, v: string) {
    const next = ensureHeaderRow(t);
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
      <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {header.map((h, i) => (
                <th key={i} className="px-4 py-3 text-left align-middle border-r border-slate-100 last:border-r-0">
                  <div className="flex items-center gap-2">
                    <input
                      className="w-full bg-transparent outline-none font-semibold text-slate-700 placeholder:text-slate-400"
                      value={safeStr(h)}
                      disabled={readOnly}
                      onChange={(e) => setHeader(i, e.target.value)}
                      onKeyDown={guardTableCellKeys}
                      placeholder={`Column ${i + 1}`}
                    />

                    {!readOnly && t.columns > 1 ? (
                      <button
                        type="button"
                        className="shrink-0 rounded-md p-1.5 hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition-colors"
                        title="Delete this column"
                        onClick={() => onDelCol(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </th>
              ))}
              {!readOnly ? <th className="w-16 px-2 py-3 bg-slate-50" /> : null}
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-100">
            {dataRows.map((r, ri) => (
              <tr key={ri} className="hover:bg-slate-50/50 transition-colors">
                {header.map((_, ci) => {
                  const isDate = dateCols.has(ci);
                  const raw = safeStr(r.cells?.[ci]);

                  return (
                    <td key={ci} className="px-4 py-3 align-top border-r border-slate-100 last:border-r-0">
                      {isDate ? (
                        <DatePickerCell value={raw} onChange={(v) => setCell(ri, ci, v)} disabled={readOnly} />
                      ) : (
                        <input
                          className="w-full outline-none bg-transparent text-slate-700 placeholder:text-slate-400"
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
                      className="rounded-md p-2 hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition-colors"
                      title="Delete row"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-3 items-center">
          <Button
            variant="outline"
            size="sm"
            onClick={onAddRow}
            className="rounded-lg border-slate-300 hover:bg-slate-50 hover:border-slate-400"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Add Row
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onAddCol}
            className="rounded-lg border-slate-300 hover:bg-slate-50 hover:border-slate-400"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Add Column
          </Button>

          <div className="ml-auto text-xs text-slate-400">
            {dataRows.length} row{dataRows.length !== 1 ? "s" : ""} × {header.length} column{header.length !== 1 ? "s" : ""}s
          </div>
        </div>
      ) : null}
    </div>
  );
}