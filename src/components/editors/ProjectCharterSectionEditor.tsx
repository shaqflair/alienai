// src/components/editors/ProjectCharterSectionEditor.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
  Zap,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format, isValid } from "date-fns";

/* =========================================================
   Types
========================================================= */

type RowObj = { type: "header" | "data"; cells: string[] };
export type CharterMeta = { title?: string; date?: string; version?: string; author?: string; [key: string]: any };
export type CharterSection = {
  key: string; title: string; type?: string; content?: string;
  bullets?: string[]; table?: { columns: number; rows: RowObj[] }; [key: string]: any;
};
export type ApplySectionPatch = (key: string, patch: any) => void;
export type V2Section = {
  key: string; title: string; bullets?: string;
  table?: { columns: number; rows: RowObj[] };
};
export type ImproveSectionPayload = {
  sectionKey: string; sectionTitle: string; section: V2Section;
  selectedText?: string; notes?: string;
};

type Props = {
  meta: Record<string, any>;
  onMetaChange: (meta: Record<string, any>) => void;
  sections: V2Section[];
  onChange: (sections: V2Section[]) => void;
  readOnly?: boolean;
  completenessByKey?: Record<string, { completeness0to100?: number; issues?: Array<{ severity: "info" | "warn" | "error"; message: string }> }>;
  onImproveSection?: (payload: ImproveSectionPayload) => void;
  onRegenerateSection?: (sectionKey: string) => void;
  aiDisabled?: boolean;
  aiLoadingKey?: string | null;
};

/* =========================================================
   Helpers
========================================================= */

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}
function ensureHeaderRow(table: { columns: number; rows: RowObj[] }): { columns: number; rows: RowObj[] } {
  const rows = Array.isArray(table?.rows) ? table.rows.slice() : [];
  const cols = Math.max(1, clampInt(table?.columns, 1, 24, 2));
  if (!rows.length || rows[0]?.type !== "header") {
    return { columns: cols, rows: [{ type: "header", cells: Array.from({ length: cols }, (_, i) => `Column ${i + 1}`) }, ...rows] };
  }
  const header = rows[0];
  const hc = Array.isArray(header.cells) ? header.cells.slice() : [];
  while (hc.length < cols) hc.push(`Column ${hc.length + 1}`);
  header.cells = hc.slice(0, cols);
  if (!rows.some((r) => r.type === "data")) rows.push({ type: "data", cells: Array.from({ length: cols }, () => "") });
  return { columns: cols, rows: rows.map((r) => { const c = Array.isArray(r.cells) ? r.cells.slice() : []; while (c.length < cols) c.push(""); return { ...r, cells: c.slice(0, cols) }; }) };
}
function guardTableCellKeys(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") e.stopPropagation();
}
function isIsoDateOnly(v: string) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }
function isIsoDateTime(v: string) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v); }
function isUkDate(v: string) { return /^\d{2}\/\d{2}\/\d{4}$/.test(v); }
function parseUkDate(v: string): Date | null {
  if (!v) return null;
  if (isUkDate(v)) { const [day, month, year] = v.split("/").map(Number); const d = new Date(year, month - 1, day); return isValid(d) ? d : null; }
  if (isIsoDateOnly(v) || isIsoDateTime(v)) { const d = new Date(isIsoDateOnly(v) ? `${v}T00:00:00` : v); return isValid(d) ? d : null; }
  const m = v.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (m) { const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])); return isValid(d) ? d : null; }
  return null;
}
function toUkDateDisplay(value: string) {
  const s = safeStr(value).trim();
  if (!s) return "";
  if (isUkDate(s)) return s;
  if (isIsoDateOnly(s) || isIsoDateTime(s)) { const d = new Date(isIsoDateOnly(s) ? `${s}T00:00:00` : s); if (!Number.isNaN(d.getTime())) try { return format(d, "dd/MM/yyyy"); } catch {} }
  const m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (m) return `${String(m[1]).padStart(2, "0")}/${String(m[2]).padStart(2, "0")}/${m[3]}`;
  return s;
}
function formatDateToUk(date: Date | undefined): string { if (!date || !isValid(date)) return ""; return format(date, "dd/MM/yyyy"); }
function headerSuggestsDate(header: string) { return safeStr(header).toLowerCase().includes("date"); }
function insertAtCursor(el: HTMLTextAreaElement, insert: string) {
  const start = el.selectionStart ?? 0; const end = el.selectionEnd ?? start;
  return { next: el.value.slice(0, start) + insert + el.value.slice(end), nextPos: start + insert.length };
}
function currentLinePrefix(text: string, cursorPos: number) {
  const before = text.slice(0, cursorPos); const lastNl = before.lastIndexOf("\n"); const line = before.slice(lastNl + 1);
  const trimmed = line.trimStart(); const indent = line.match(/^\s*/)?.[0] ?? "";
  const markerMatch = trimmed.match(/^([-*])\s*/); const marker = markerMatch?.[1] ?? "-";
  return { indent, marker };
}
function isFreeTextSectionKey(k: string) { const key = safeStr(k).toLowerCase(); return key === "business_case" || key === "objectives"; }

/* =========================================================
   Completeness Ring — warm palette
========================================================= */

function CompletenessRing({ score, size = 32 }: { score: number; size?: number }) {
  const r = (size - 4) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const color = score >= 80 ? "#5a7a4a" : score >= 40 ? "#b8975a" : "#c0524a";
  const bg = score >= 80 ? "#e8f0e0" : score >= 40 ? "#f5edd8" : "#f5e0de";
  return (
    <div className="relative" style={{ width: size, height: size }} title={`${score}% complete`}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bg} strokeWidth={3} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={3}
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-bold"
        style={{ fontSize: size * 0.28, color, fontFamily: "'DM Mono', monospace" }}>{score}</span>
    </div>
  );
}

/* =========================================================
   Main Component
========================================================= */

export default function ProjectCharterSectionEditor({
  meta, onMetaChange, sections, onChange, readOnly = false,
  completenessByKey, onImproveSection, onRegenerateSection,
  aiDisabled = false, aiLoadingKey = null,
}: Props) {
  const safeSections = useMemo(() => (Array.isArray(sections) ? sections : []), [sections]);
  const didInitMetaRef = useRef(false);
  const lastMetaEditAtRef = useRef<number>(0);

  const [metaDraft, setMetaDraft] = useState<Record<string, any>>(() => ({
    project_title: "", project_manager: "", sponsor: "", dates: "",
  }));

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

  useEffect(() => {
    if (!didInitMetaRef.current) return;
    const sinceEdit = Date.now() - (lastMetaEditAtRef.current || 0);
    if (sinceEdit < 1200) return;
    const incoming = meta && typeof meta === "object" ? meta : {};
    setMetaDraft((cur) => {
      const next = { ...(cur || {}) };
      const fields: Array<keyof typeof next> = ["project_title", "project_manager", "sponsor", "dates"];
      fields.forEach((f) => { const v = safeStr((incoming as any)[f]); if (!safeStr(next[f]).trim() && v.trim()) next[f] = v; });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta]);

  useEffect(() => {
    if (!didInitMetaRef.current || readOnly) return;
    const t = setTimeout(() => { onMetaChange({ ...(meta && typeof meta === "object" ? meta : {}), ...metaDraft }); }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaDraft, readOnly]);

  function patchSection(idx: number, next: Partial<V2Section>) {
    if (readOnly) return;
    const arr = safeSections.slice(); arr[idx] = { ...(arr[idx] || { key: "", title: "" }), ...next }; onChange(arr);
  }
  function patchTable(idx: number, t: { columns: number; rows: RowObj[] }) { patchSection(idx, { table: ensureHeaderRow(t) as any, bullets: undefined }); }
  function patchBullets(idx: number, text: string) { patchSection(idx, { bullets: text, table: undefined }); }
  function addTableRow(idx: number) {
    if (readOnly) return;
    const t = ensureHeaderRow(safeSections[idx]?.table ?? { columns: 2, rows: [] }) as { columns: number; rows: RowObj[] };
    t.rows.push({ type: "data", cells: Array.from({ length: t.columns }, () => "") }); patchTable(idx, t);
  }
  function delTableRow(idx: number, rowIndexInData: number) {
    if (readOnly) return;
    const t = ensureHeaderRow(safeSections[idx]?.table ?? { columns: 2, rows: [] }) as { columns: number; rows: RowObj[] };
    const dataIdxs = t.rows.map((r, i) => ({ r, i })).filter((x) => x.r.type === "data").map((x) => x.i);
    const target = dataIdxs[rowIndexInData]; if (target == null) return;
    const nextRows = t.rows.slice(); nextRows.splice(target, 1);
    if (!nextRows.some((r) => r.type === "data")) nextRows.push({ type: "data", cells: Array.from({ length: t.columns }, () => "") });
    patchTable(idx, { columns: t.columns, rows: nextRows as RowObj[] });
  }
  function addColumn(idx: number) {
    if (readOnly) return;
    const t = ensureHeaderRow(safeSections[idx]?.table ?? { columns: 2, rows: [] }) as { columns: number; rows: RowObj[] };
    const cols = Math.min(24, (t.columns || 2) + 1);
    patchTable(idx, { columns: cols, rows: t.rows.map((r) => ({ ...r, cells: [...(r.cells ?? []), r.type === "header" ? `Column ${cols}` : ""] })) as RowObj[] });
  }
  function delColumn(idx: number, colIndex: number) {
    if (readOnly) return;
    const t = ensureHeaderRow(safeSections[idx]?.table ?? { columns: 2, rows: [] }) as { columns: number; rows: RowObj[] };
    if (t.columns <= 1) return;
    patchTable(idx, { columns: t.columns - 1, rows: t.rows.map((r) => { const c = (r.cells ?? []).slice(); c.splice(colIndex, 1); return { ...r, cells: c }; }) as RowObj[] });
  }

  const [metaOpen, setMetaOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<number, boolean>>({});
  const toggleSection = (idx: number) => setExpandedSections((prev) => ({ ...prev, [idx]: prev[idx] === false ? true : prev[idx] === undefined ? false : !prev[idx] }));
  const isSectionExpanded = (idx: number) => expandedSections[idx] !== false;

  return (
    <div style={{ background: "linear-gradient(180deg, #fffcf7 0%, #f5f0e8 100%)", fontFamily: "'Georgia', 'Times New Roman', serif", minHeight: "100%" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap');

        .charter-sec-card { transition: all 0.25s cubic-bezier(0.4,0,0.2,1); }
        .charter-sec-card:hover { transform: translateY(-1px); }

        .charter-sec-input {
          font-family: 'DM Sans', system-ui, sans-serif;
          transition: all 0.2s ease;
        }
        .charter-sec-input:focus {
          box-shadow: 0 0 0 3px rgba(184,151,90,0.12), 0 1px 2px rgba(0,0,0,0.05);
          border-color: #b8975a !important;
          outline: none;
        }

        .charter-sec-textarea {
          font-family: 'DM Sans', system-ui, sans-serif;
          transition: all 0.2s ease;
        }
        .charter-sec-textarea:focus {
          box-shadow: 0 0 0 3px rgba(184,151,90,0.12), 0 2px 8px rgba(0,0,0,0.04);
          border-color: #b8975a !important;
          outline: none;
        }

        .charter-sec-btn-ai {
          font-family: 'DM Sans', system-ui, sans-serif;
          background: linear-gradient(135deg, #b8975a 0%, #d4b97a 50%, #c9a05a 100%);
          background-size: 200% 200%;
          animation: goldShimmerSec 3s ease infinite;
          transition: all 0.2s ease;
          color: white; border: none; cursor: pointer;
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 8px;
          font-size: 12px; font-weight: 600;
        }
        .charter-sec-btn-ai:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 14px rgba(184,151,90,0.4); }
        .charter-sec-btn-ai:disabled { opacity: 0.45; background: #c9b99a; animation: none; cursor: not-allowed; transform: none; }

        .charter-sec-btn-regen {
          font-family: 'DM Sans', system-ui, sans-serif;
          display: inline-flex; align-items: center; gap: 6px;
          padding: 6px 12px; border-radius: 8px;
          font-size: 12px; font-weight: 500;
          border: 1px solid #d4c9b0; background: #faf8f4; color: #5a4a32;
          cursor: pointer; transition: all 0.2s ease;
        }
        .charter-sec-btn-regen:hover:not(:disabled) { background: #f5f0e8; border-color: #c9b99a; }
        .charter-sec-btn-regen:disabled { opacity: 0.4; cursor: not-allowed; }

        @keyframes goldShimmerSec {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }

        .charter-sec-table-row { transition: background-color 0.15s ease; }
        .charter-sec-table-row:hover { background-color: rgba(184,151,90,0.04); }

        .charter-sec-fade-in { animation: secFadeIn 0.3s cubic-bezier(0.4,0,0.2,1); }
        @keyframes secFadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div style={{ padding: "24px 32px", maxWidth: 1400, margin: "0 auto" }} className="space-y-5">

        {/* ── Charter Details (Meta) Card ─────────────────── */}
        <div className="charter-sec-card rounded-xl overflow-hidden"
          style={{ background: "linear-gradient(180deg, #fffcf7 0%, #faf6ee 100%)", border: "1px solid #e8e2d6", boxShadow: "0 1px 3px rgba(0,0,0,0.03), 0 6px 24px rgba(0,0,0,0.03)" }}>

          <button type="button" onClick={() => setMetaOpen((v) => !v)}
            className="w-full flex items-center justify-between px-6 py-4 transition-colors"
            style={{ fontFamily: "'DM Sans', sans-serif" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(212,201,176,0.15)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, #f5edd8 0%, #e8d9b8 100%)", border: "1px solid #d4c9b0" }}>
                <FileText className="h-[18px] w-[18px]" style={{ color: "#8a6a3a" }} />
              </div>
              <div className="text-left">
                <div className="text-[15px] font-semibold" style={{ color: "#2c2418", fontFamily: "'DM Sans', sans-serif" }}>Charter Details</div>
                <div className="text-xs mt-0.5" style={{ color: "#8a7d68", fontFamily: "'DM Sans', sans-serif" }}>Project metadata for exports and reports</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!metaOpen && safeStr(metaDraft?.project_title).trim() && (
                <span className="text-xs hidden sm:block truncate max-w-[200px]" style={{ color: "#a08e6c", fontFamily: "'DM Sans', sans-serif" }}>
                  {safeStr(metaDraft?.project_title)}
                </span>
              )}
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "#f5f0e8", border: "1px solid #e8e2d6", transform: metaOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s ease" }}>
                <ChevronDown className="h-4 w-4" style={{ color: "#8a7d68" }} />
              </div>
            </div>
          </button>

          {metaOpen && (
            <div className="px-6 pb-6 charter-sec-fade-in">
              <div className="h-px mb-5" style={{ background: "linear-gradient(90deg, transparent, #d4c9b0, transparent)" }} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {[
                  { label: "Project Title", field: "project_title", placeholder: "" },
                  { label: "Project Manager", field: "project_manager", placeholder: "" },
                  { label: "Sponsor", field: "sponsor", placeholder: "" },
                  { label: "Dates", field: "dates", placeholder: "e.g., Start 01/03/2026 – End 30/06/2026" },
                ].map(({ label, field, placeholder }) => (
                  <div key={field} className="space-y-2">
                    <label className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "#8a7d68", fontFamily: "'DM Sans', sans-serif" }}>{label}</label>
                    <input
                      className="charter-sec-input w-full rounded-xl px-4 py-3 text-sm"
                      style={{ border: "1px solid #d4c9b0", background: "rgba(255,252,247,0.9)", color: "#3d3529" }}
                      value={safeStr(metaDraft?.[field])}
                      disabled={readOnly}
                      placeholder={placeholder}
                      onChange={(e) => { lastMetaEditAtRef.current = Date.now(); setMetaDraft((s) => ({ ...(s || {}), [field]: e.target.value })); }}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "#a08e6c", fontFamily: "'DM Sans', sans-serif" }}>
                <div className="w-1 h-1 rounded-full" style={{ background: "#b8975a" }} />
                These fields power your exports
              </div>
            </div>
          )}
        </div>

        {/* ── Sections ────────────────────────────────────── */}
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
              <div key={`${key || "sec"}_${idx}`} className="charter-sec-card rounded-xl overflow-hidden"
                style={{
                  background: "linear-gradient(180deg, #fffcf7 0%, #faf6ee 100%)",
                  border: isLoading ? "1px solid #b8975a" : "1px solid #e8e2d6",
                  boxShadow: isLoading
                    ? "0 0 0 3px rgba(184,151,90,0.12), 0 4px 20px rgba(184,151,90,0.1)"
                    : "0 1px 3px rgba(0,0,0,0.03), 0 6px 24px rgba(0,0,0,0.03)",
                  transition: "box-shadow 0.3s ease, border-color 0.3s ease",
                }}>

                {/* Section header */}
                <div className="flex items-center gap-3 px-5 md:px-6 py-4">
                  <button type="button" onClick={() => toggleSection(idx)}
                    className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                    style={{ background: "transparent" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "#f5f0e8")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                  >
                    <ChevronDown className="h-4 w-4" style={{ color: "#a08e6c", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform 0.2s ease" }} />
                  </button>

                  {/* Section type icon */}
                  <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: isTable ? "linear-gradient(135deg, #e8f0f8 0%, #d4e4f0 100%)" : "linear-gradient(135deg, #e8f0e0 0%, #d4e8d0 100%)", border: isTable ? "1px solid #c0d4e4" : "1px solid #b8d4b0" }}>
                    {isTable
                      ? <TableIcon className="h-4 w-4" style={{ color: "#4a6a8a" }} />
                      : <List className="h-4 w-4" style={{ color: "#4a7a5a" }} />
                    }
                  </div>

                  {/* Title */}
                  <div className="flex-1 min-w-0 flex items-center gap-3 flex-wrap">
                    <span className="text-[15px] font-semibold truncate" style={{ color: "#2c2418", fontFamily: "'DM Sans', sans-serif" }}>{title}</span>
                    {isLoading && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold rounded-full px-2.5 py-1"
                        style={{ background: "#f5edd8", border: "1px solid #d4c9b0", color: "#8a6a3a", fontFamily: "'DM Sans', sans-serif" }}>
                        <Zap className="h-3 w-3 animate-pulse" /> AI working...
                      </span>
                    )}
                  </div>

                  {completenessByKey && key && <div className="shrink-0"><CompletenessRing score={score} size={36} /></div>}

                  {/* AI buttons */}
                  <div className="shrink-0 flex items-center gap-2">
                    {onImproveSection && (
                      <button type="button" className="charter-sec-btn-ai" disabled={readOnly || aiDisabled}
                        onClick={() => onImproveSection({ sectionKey: key, sectionTitle: title, section: sec, selectedText: "" })}
                        title="Improve with AI">
                        <Sparkles className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Improve</span>
                      </button>
                    )}
                    {onRegenerateSection && (
                      <button type="button" className="charter-sec-btn-regen" disabled={readOnly || aiDisabled || !key || isLoading}
                        onClick={() => key && onRegenerateSection(key)} title="Regenerate with AI">
                        <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} style={{ color: isLoading ? "#b8975a" : "#8a7d68" }} />
                        <span className="hidden sm:inline">{isLoading ? "Working..." : "Regen"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Issues */}
                {key && comp?.issues?.length ? (
                  <div className="mx-5 md:mx-6 mb-2">
                    <div className="rounded-xl px-4 py-3 flex items-start gap-3"
                      style={{ background: "#fef8ee", border: "1px solid #e8d4a0" }}>
                      <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#b8975a" }} />
                      <div className="space-y-1">
                        {comp.issues.slice(0, 2).map((it, i) => (
                          <div key={i} className="text-xs leading-relaxed" style={{ color: "#5a4a32", fontFamily: "'DM Sans', sans-serif" }}>
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider mr-1.5"
                              style={{ background: it.severity === "error" ? "#fde8e0" : it.severity === "warn" ? "#fef0d8" : "#e8f0f8", color: it.severity === "error" ? "#8a3020" : it.severity === "warn" ? "#8a6020" : "#3060a0" }}>
                              {it.severity}
                            </span>
                            {it.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}

                {/* Content */}
                {expanded && (
                  <div className="px-5 md:px-6 pb-5 charter-sec-fade-in">
                    <div className="h-px mb-5" style={{ background: "linear-gradient(90deg, transparent, #d4c9b0, transparent)" }} />
                    {isTable ? (
                      <TableEditor
                        value={ensureHeaderRow(sec.table!) as { columns: number; rows: RowObj[] }}
                        readOnly={readOnly}
                        onChange={(t) => patchTable(idx, t)}
                        onAddRow={() => addTableRow(idx)}
                        onAddCol={() => addColumn(idx)}
                        onDelCol={(c) => delColumn(idx, c)}
                        onDelRow={(ri) => delTableRow(idx, ri)}
                      />
                    ) : freeText ? (
                      <FreeTextEditor value={safeStr(sec?.bullets)} readOnly={readOnly} onChange={(v) => patchBullets(idx, v)}
                        label="Free text" placeholder="Write in short paragraphs. Keep it executive-friendly." />
                    ) : (
                      <BulletsEditor value={safeStr(sec?.bullets)} readOnly={readOnly} onChange={(v) => patchBullets(idx, v)} />
                    )}

                    {key && completenessByKey && score >= 80 && (
                      <div className="mt-4 flex items-center gap-2.5 text-xs rounded-xl px-4 py-2.5"
                        style={{ background: "#eef4e8", border: "1px solid #b8d4a8", color: "#4a7a3a", fontFamily: "'DM Sans', sans-serif" }}>
                        <CheckCircle2 className="h-4 w-4" />
                        <span className="font-semibold">Ready for export</span>
                      </div>
                    )}
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
   Sub-components — warm parchment palette
========================================================= */

function FreeTextEditor({ value, readOnly, onChange, label = "Free text", placeholder }: {
  value: string; readOnly: boolean; onChange: (v: string) => void; label?: string; placeholder?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "#a08e6c", fontFamily: "'DM Sans', sans-serif" }}>
        <FileText className="h-3 w-3" /> {label}
      </div>
      <textarea className="charter-sec-textarea w-full min-h-[200px] rounded-xl p-4 text-sm resize-y leading-relaxed"
        style={{ border: "1px solid #d4c9b0", background: "rgba(255,252,247,0.9)", color: "#3d3529" }}
        value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || "Write here..."} />
    </div>
  );
}

function BulletsEditor({ value, readOnly, onChange }: { value: string; readOnly: boolean; onChange: (v: string) => void; }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: "#a08e6c", fontFamily: "'DM Sans', sans-serif" }}>
        <List className="h-3 w-3" /> Bullet points — one per line
      </div>
      <textarea className="charter-sec-textarea w-full min-h-[180px] rounded-xl p-4 text-sm resize-y leading-relaxed"
        style={{ border: "1px solid #d4c9b0", background: "rgba(255,252,247,0.9)", color: "#3d3529" }}
        value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)}
        placeholder="- Add bullet points here..."
        onKeyDown={(e) => {
          if (readOnly || e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          const el = e.currentTarget;
          const pos = el.selectionStart ?? el.value.length;
          const { indent, marker } = currentLinePrefix(el.value, pos);
          const { next, nextPos } = insertAtCursor(el, `\n${indent}${marker} `);
          onChange(next);
          requestAnimationFrame(() => { try { el.selectionStart = el.selectionEnd = nextPos; } catch {} });
        }} />
    </div>
  );
}

function DatePickerCell({ value, onChange, disabled, placeholder = "dd/mm/yyyy" }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const date = useMemo(() => parseUkDate(value), [value]);
  const displayValue = useMemo(() => toUkDateDisplay(value), [value]);
  if (disabled) {
    return (
      <div className="w-full px-3 py-2 text-sm rounded-lg" style={{ border: "1px solid #e8e2d6", background: "#f5f0e8", color: "#8a7d68", fontFamily: "'DM Mono', monospace", fontSize: 13 }}>
        {displayValue || placeholder}
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <input type="text" className="charter-sec-input flex-1 min-w-0 rounded-lg px-3 py-2 text-sm"
        style={{ border: "1px solid #d4c9b0", background: "rgba(255,252,247,0.9)", color: "#3d3529", fontFamily: "'DM Mono', monospace", fontSize: 13 }}
        value={displayValue} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { const n = toUkDateDisplay(value); if (n !== value) onChange(n); }}
        onKeyDown={guardTableCellKeys} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="shrink-0 p-2 rounded-lg transition-all"
            style={{ border: "1px solid #d4c9b0", background: "#faf8f4", color: "#a08e6c" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#f5edd8"; (e.currentTarget as HTMLElement).style.borderColor = "#b8975a"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "#faf8f4"; (e.currentTarget as HTMLElement).style.borderColor = "#d4c9b0"; }}
            title="Pick date">
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar mode="single" selected={date || undefined}
            onSelect={(d) => { if (d && isValid(d)) onChange(formatDateToUk(d)); setOpen(false); }}
            initialFocus className="rounded-xl border-0" />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function TableEditor({ value, readOnly, onChange, onAddRow, onAddCol, onDelRow, onDelCol }: {
  value: { columns: number; rows: RowObj[] }; readOnly: boolean;
  onChange: (t: { columns: number; rows: RowObj[] }) => void;
  onAddRow: () => void; onAddCol: () => void;
  onDelRow: (i: number) => void; onDelCol: (i: number) => void;
}) {
  const t = ensureHeaderRow(value) as { columns: number; rows: RowObj[] };
  const header = t.rows[0].cells;
  const dataRows = t.rows.filter((r) => r.type === "data");
  const dateCols = useMemo(() => { const s = new Set<number>(); header.forEach((h, i) => { if (headerSuggestsDate(h)) s.add(i); }); return s; }, [header.join("|")]);

  function setHeader(col: number, v: string) { const n = ensureHeaderRow(t) as { columns: number; rows: RowObj[] }; n.rows[0].cells[col] = v; onChange(n); }
  function setCell(ri: number, ci: number, v: string) {
    const n = ensureHeaderRow(t) as { columns: number; rows: RowObj[] };
    const di = n.rows.map((r, i) => ({ r, i })).filter((x) => x.r.type === "data").map((x) => x.i)[ri];
    if (di == null) return; n.rows[di].cells[ci] = v; onChange(n);
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl" style={{ border: "1px solid #d4c9b0", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ background: "linear-gradient(180deg, #faf8f4 0%, #f5f0e8 100%)" }}>
                {header.map((h, i) => (
                  <th key={i} className="px-4 py-3.5 text-left align-middle" style={{ borderBottom: "2px solid #d4c9b0", borderRight: i < header.length - 1 ? "1px solid #e8e2d6" : "none" }}>
                    <div className="flex items-center gap-2">
                      <input className="w-full bg-transparent outline-none text-[11px] font-bold uppercase tracking-[0.12em]"
                        style={{ color: "#6b5c3e", fontFamily: "'DM Sans', sans-serif" }}
                        value={safeStr(h)} disabled={readOnly} onChange={(e) => setHeader(i, e.target.value)}
                        onKeyDown={guardTableCellKeys} placeholder={`Column ${i + 1}`} />
                      {!readOnly && t.columns > 1 && (
                        <button type="button" onClick={() => onDelCol(i)} title="Delete column"
                          className="shrink-0 rounded-md p-1 opacity-0 hover:opacity-100 transition-all"
                          style={{ color: "#c0524a" }}
                          onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                          onFocus={(e) => (e.currentTarget.style.opacity = "1")}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
                {!readOnly && <th className="w-12 px-2 py-3.5" style={{ borderBottom: "2px solid #d4c9b0", background: "linear-gradient(180deg, #faf8f4 0%, #f5f0e8 100%)" }} />}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((r, ri) => (
                <tr key={ri} className="charter-sec-table-row" style={{ borderBottom: ri < dataRows.length - 1 ? "1px solid #e8e2d6" : "none" }}>
                  {header.map((_, ci) => {
                    const isDate = dateCols.has(ci); const raw = safeStr(r.cells?.[ci]);
                    return (
                      <td key={ci} className="px-4 py-3 align-top" style={{ borderRight: ci < header.length - 1 ? "1px solid #e8e2d6" : "none" }}>
                        {isDate ? (
                          <DatePickerCell value={raw} onChange={(v) => setCell(ri, ci, v)} disabled={readOnly} />
                        ) : (
                          <input className="charter-sec-input w-full bg-transparent text-[13px]"
                            style={{ color: "#3d3529", border: "none", outline: "none" }}
                            value={raw} disabled={readOnly} onChange={(e) => setCell(ri, ci, e.target.value)}
                            onKeyDown={guardTableCellKeys} />
                        )}
                      </td>
                    );
                  })}
                  {!readOnly && (
                    <td className="px-2 py-3 text-center">
                      <button type="button" onClick={() => onDelRow(ri)} title="Delete row"
                        className="rounded-lg p-1.5 transition-all" style={{ color: "#c9b99a" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#fde8e0"; (e.currentTarget as HTMLElement).style.color = "#c0524a"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; (e.currentTarget as HTMLElement).style.color = "#c9b99a"; }}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {!readOnly && (
        <div className="flex flex-wrap gap-2.5 items-center">
          {[{ label: "Row", fn: onAddRow }, { label: "Column", fn: onAddCol }].map(({ label, fn }) => (
            <button key={label} type="button" onClick={fn}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ border: "1px dashed #c9b99a", color: "#8a7d68", background: "transparent", fontFamily: "'DM Sans', sans-serif" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#b8975a"; (e.currentTarget as HTMLElement).style.color = "#6b5030"; (e.currentTarget as HTMLElement).style.background = "#faf3e8"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "#c9b99a"; (e.currentTarget as HTMLElement).style.color = "#8a7d68"; (e.currentTarget as HTMLElement).style.background = "transparent"; }}>
              <Plus className="h-3.5 w-3.5" /> {label}
            </button>
          ))}
          <span className="ml-auto text-[11px]" style={{ color: "#c9b99a", fontFamily: "'DM Mono', monospace" }}>
            {dataRows.length}r × {header.length}c
          </span>
        </div>
      )}
    </div>
  );
}