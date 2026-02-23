// src/components/editors/StakeholderRegisterEditor.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useTransition, useCallback } from "react";
import MultiSelectPopover, { type MultiSelectOption } from "@/components/ui/MultiSelectPopover";

type Impact = "Low" | "Medium" | "High";
type Influence = "Low" | "Medium" | "High";
type InternalExternal = "Internal" | "External";
type Mapping = "Manage Closely" | "Keep Satisfied" | "Keep Informed" | "Monitor";

export type StakeholderRow = {
  id: string;
  name: string;
  point_of_contact?: string;
  role?: string;
  internal_external?: InternalExternal;
  title_role?: string;
  impact_level?: Impact;
  influence_level?: Influence;
  stakeholder_mapping?: Mapping;
  involvement_milestone?: string;
  stakeholder_impact?: string;
  channels?: string[];
  group?: string;
  __draft?: boolean;
};

export type StakeholderRegisterV1 = {
  version: 1;
  type: "stakeholder_register";
  rows: StakeholderRow[];
};

const CHANNEL_PRESETS = ["Teams", "Web app", "Email", "Phone", "Face to face"] as const;

// ─── Icons ───────────────────────────────────────────────────────────────────
const Icons = {
  Plus: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  Trash: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  ),
  Refresh: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  ),
  Search: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  ChevronDown: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ),
  ChevronRight: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  ),
  Grid: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
      />
    </svg>
  ),
  List: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
  Download: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  ),
  FileSpreadsheet: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  FileText: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  FilePdf: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  Lightbulb: () => (
    <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  ),
  AlertCircle: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Save: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
    </svg>
  ),
  X: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Expand: () => (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
      />
    </svg>
  ),
  Mail: () => (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  ),
  DotsVertical: () => (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  ),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `row_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
function isDbUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x ?? ""));
}
function normalizeGroup(x: any) {
  return String(x ?? "").trim() || "Project";
}
function inferMapping(influence?: Influence, impact?: Impact): Mapping {
  const i = String(influence ?? "").toLowerCase();
  const p = String(impact ?? "").toLowerCase();
  if (i === "high" && p === "high") return "Manage Closely";
  if (i === "high" && p !== "high") return "Keep Satisfied";
  if (i !== "high" && p === "high") return "Keep Informed";
  return "Monitor";
}
function normalizeInfluenceToUi(x: any): Influence {
  const s = String(x ?? "").toLowerCase();
  return s === "high" ? "High" : s === "low" ? "Low" : "Medium";
}
function normalizeUiInfluenceToDb(x: any): "high" | "medium" | "low" {
  const s = String(x ?? "").toLowerCase();
  return s === "high" ? "high" : s === "low" ? "low" : "medium";
}
function normalizeChannel(x: any) {
  return String(x ?? "").trim().replace(/\s+/g, " ");
}
function normalizeNameKey(x: any) {
  return String(x ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// ─── Notion-style soft pill classes ──────────────────────────────────────────
function levelPill(v: any) {
  const s = String(v ?? "").toLowerCase();
  if (s === "high") return "bg-red-100 text-red-700 border border-red-200";
  if (s === "medium") return "bg-amber-100 text-amber-700 border border-amber-200";
  if (s === "low") return "bg-green-100 text-green-700 border border-green-200";
  return "bg-gray-100 text-gray-500 border border-gray-200";
}
function levelDot(v: any) {
  const s = String(v ?? "").toLowerCase();
  return s === "high" ? "bg-red-500" : s === "medium" ? "bg-amber-500" : s === "low" ? "bg-green-500" : "bg-gray-400";
}
function mappingPill(v: any) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("manage")) return "bg-red-100 text-red-700 border border-red-200";
  if (s.includes("satisfied")) return "bg-amber-100 text-amber-700 border border-amber-200";
  if (s.includes("informed")) return "bg-blue-100 text-blue-700 border border-blue-200";
  return "bg-gray-100 text-gray-600 border border-gray-200";
}
function typePill(v: any) {
  return String(v ?? "") === "External"
    ? "bg-purple-100 text-purple-700 border border-purple-200"
    : "bg-blue-100 text-blue-700 border border-blue-200";
}
function channelChip(label: any) {
  const s = String(label ?? "").toLowerCase();
  if (s.includes("teams")) return "bg-indigo-50 text-indigo-700 border-indigo-200";
  if (s.includes("web") || s.includes("app") || s.includes("portal")) return "bg-violet-50 text-violet-700 border-violet-200";
  if (s.includes("email")) return "bg-sky-50 text-sky-700 border-sky-200";
  if (s.includes("phone") || s.includes("call")) return "bg-orange-50 text-orange-700 border-orange-200";
  if (s.includes("face") || s.includes("in person")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-gray-100 text-gray-500 border-gray-200";
}

type StakeholdersChangedDetail = { projectId?: string; artifactId?: string; reason?: string };
type PendingSuggestion = { id: string; suggestion_type?: string; status?: string; rationale?: string | null; payload?: any; created_at?: string };

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  name: 200,
  point_of_contact: 190,
  role: 155,
  internal_external: 110,
  title_role: 155,
  impact_level: 110,
  influence_level: 110,
  stakeholder_mapping: 155,
  involvement_milestone: 175,
  stakeholder_impact: 230,
  channels: 215,
  actions: 56,
};

// ─── Shared primitives ────────────────────────────────────────────────────────
const TH_CLS =
  "px-4 py-2.5 text-left text-[11px] font-semibold tracking-widest uppercase text-gray-400 bg-[#f9f9f8] border-b border-gray-200 whitespace-nowrap select-none";
const TD_CLS = "border-b border-gray-100 align-middle bg-white group-hover/row:bg-[#f9f9f8] transition-colors";
const INLINE_INPUT_CLS = "w-full h-full px-4 py-2.5 bg-transparent border-0 outline-none text-[13px] text-gray-800 placeholder-gray-300";

// ─── BadgeSelect: shows a pill badge; clicking opens a native select overlay ─
function BadgeSelect({
  value,
  onChange,
  options,
  disabled,
  pillFn,
  showDot = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
  pillFn: (v: string) => string;
  showDot?: boolean;
}) {
  return (
    <div className="relative inline-flex">
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${pillFn(value)}`}>
        {showDot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${levelDot(value)}`} />}
        {value}
      </span>
      {!disabled && (
        <select className="absolute inset-0 opacity-0 w-full cursor-pointer" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function StakeholderRegisterEditor(props: { projectId: string; artifactId: string; initialJson: any | null; readOnly?: boolean }) {
  const { projectId, artifactId, initialJson, readOnly = false } = props;

  const [mode, setMode] = useState<"table" | "cards">("table");
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState<"all" | "internal" | "external">("all");
  const [doc, setDoc] = useState<StakeholderRegisterV1>({ version: 1, type: "stakeholder_register", rows: [] });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, startSaving] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [pendingSugs, setPendingSugs] = useState<PendingSuggestion[]>([]);
  const [sugBusy, startSugTransition] = useTransition();
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_COL_WIDTHS);
  const [resizingCol, setResizingCol] = useState<string | null>(null);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const seededFromCharterOnceRef = useRef(false);
  const loadingRef = useRef(false); // race-condition guard
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Seed from initialJson
  useEffect(() => {
    if (!initialJson || doc.rows?.length) return;
    try {
      const rows = Array.isArray(initialJson?.rows) ? initialJson.rows : [];
      const mapped: StakeholderRow[] = rows.map((r: any) => ({
        id: String(r?.id ?? uuid()),
        name: String(r?.name ?? ""),
        point_of_contact: String(r?.point_of_contact ?? ""),
        role: String(r?.role ?? ""),
        internal_external: (r?.internal_external as InternalExternal) || "Internal",
        title_role: String(r?.title_role ?? ""),
        impact_level: (r?.impact_level as Impact) || "Medium",
        influence_level: (r?.influence_level as Influence) || "Medium",
        stakeholder_mapping: (r?.stakeholder_mapping as Mapping) || inferMapping(r?.influence_level, r?.impact_level),
        involvement_milestone: String(r?.involvement_milestone ?? ""),
        stakeholder_impact: String(r?.stakeholder_impact ?? ""),
        channels: Array.isArray(r?.channels) ? r.channels.map((x: any) => normalizeChannel(x)).filter(Boolean) : ["Teams"],
        group: normalizeGroup(r?.group ?? "Project"),
        __draft: false,
      }));
      if (mapped.length) setDoc({ version: 1, type: "stakeholder_register", rows: mapped });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(e.target as Node)) setShowDownloadMenu(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colKey: string) => {
      e.preventDefault();
      e.stopPropagation();
      setResizingCol(colKey);
      resizeStartX.current = e.clientX;
      resizeStartWidth.current = colWidths[colKey] || DEFAULT_COL_WIDTHS[colKey];
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [colWidths]
  );

  useEffect(() => {
    if (!resizingCol) return;
    const onMove = (e: MouseEvent) =>
      setColWidths((p) => ({ ...p, [resizingCol]: Math.max(60, resizeStartWidth.current + (e.clientX - resizeStartX.current)) }));
    const onUp = () => {
      setResizingCol(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [resizingCol]);

  async function safeJson(res: Response) {
    try {
      return await res.json();
    } catch {
      try {
        const t = await res.text();
        return t ? { _raw: t } : null;
      } catch {
        return null;
      }
    }
  }

  const channelOptions = useMemo<MultiSelectOption[]>(() => {
    const set = new Set<string>();
    for (const p of CHANNEL_PRESETS) set.add(normalizeChannel(p));
    for (const r of doc.rows ?? []) for (const c of r.channels ?? []) {
      const v = normalizeChannel(c);
      if (v) set.add(v);
    }
    return Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .map((v) => ({ value: v, label: v }));
  }, [doc.rows]);

  async function loadSuggestions() {
    try {
      const res = await fetch(`/api/ai/suggestions/list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, target_artifact_type: "stakeholder_register" }),
      });
      const json = await safeJson(res);
      setPendingSugs(!res.ok || !json?.ok ? [] : Array.isArray(json?.suggestions) ? json.suggestions : []);
    } catch {
      setPendingSugs([]);
    }
  }

  async function acceptAllSuggestions() {
    if (readOnly) return;

    // ✅ hard guard: apply route requires projectId + artifactId + suggestionId
    if (!projectId || !artifactId) {
      setErr("Missing projectId or artifactId — cannot apply suggestions.");
      return;
    }

    const ids = (pendingSugs ?? [])
      .map((s) => String(s?.id ?? ""))
      .filter(Boolean);

    if (!ids.length) return;

    startSugTransition(async () => {
      try {
        for (const id of ids) {
          await fetch(`/api/ai/suggestions/apply`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // ✅ FIX: include artifactId
            body: JSON.stringify({ projectId, artifactId })
                      }).catch(() => null);
        }

        await loadFromDb().catch(() => null);
        await loadSuggestions().catch(() => null);

        window.dispatchEvent(
          new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-changed", {
            detail: { projectId, artifactId, reason: "suggestions_accepted_all" },
          })
        );
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    });
  }

async function seedFromCharter() {
  try {
    const res = await fetch(`/api/stakeholders/seed-from-charter`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ projectId, artifactId })
    });
    const json = await safeJson(res);
    if (res.ok && json?.ok)
      window.dispatchEvent(
        new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-seeded", {
          detail: { projectId, artifactId, reason: "seeded_from_charter" },
        })
      );
  } catch {}
}
  function mapServerRow(s: any): StakeholderRow {
    const contact = s?.contact_info && typeof s.contact_info === "object" ? s.contact_info : {};
    const influence = normalizeInfluenceToUi(s?.influence_level);
    const impactRaw = contact?.impact_level ?? s?.impact_level ?? "Medium";
    const impact: Impact = String(impactRaw) === "High" ? "High" : String(impactRaw) === "Low" ? "Low" : "Medium";
    const channels = (Array.isArray(contact?.channels) ? contact.channels : ["Teams"]).map((x: any) => normalizeChannel(x)).filter(Boolean);
    return {
      id: String(s?.id ?? uuid()),
      name: String(s?.name ?? ""),
      role: String(s?.role ?? ""),
      influence_level: influence,
      impact_level: impact,
      stakeholder_mapping: (contact?.stakeholder_mapping as Mapping) || inferMapping(influence, impact),
      internal_external: String(contact?.internal_external ?? "Internal") === "External" ? "External" : "Internal",
      title_role: String(contact?.title_role ?? ""),
      point_of_contact: String(contact?.point_of_contact ?? ""),
      involvement_milestone: String(contact?.involvement_milestone ?? ""),
      stakeholder_impact: String(contact?.stakeholder_impact ?? ""),
      channels: channels.length ? channels : ["Teams"],
      group: normalizeGroup(contact?.group ?? "Project"),
      __draft: false,
    };
  }

  async function loadFromDb() {
    if (loadingRef.current) return; // prevent concurrent fetches
    loadingRef.current = true;
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/stakeholders?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`);
      const json = await safeJson(res);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load stakeholders");
      const rows = (Array.isArray(json.stakeholders) ? json.stakeholders : []).map(mapServerRow);

      if (!seededFromCharterOnceRef.current && rows.length === 0) {
        seededFromCharterOnceRef.current = true;
        await seedFromCharter();
        const res2 = await fetch(`/api/stakeholders?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`);
        const json2 = await safeJson(res2);
        if (res2.ok && json2?.ok) {
          setDoc({
            version: 1,
            type: "stakeholder_register",
            rows: (Array.isArray(json2.stakeholders) ? json2.stakeholders : []).map(mapServerRow),
          });
          setDirty(false);
          await loadSuggestions().catch(() => null);
        }
        return;
      }

      setDoc({ version: 1, type: "stakeholder_register", rows });
      setDirty(false);
      await loadSuggestions().catch(() => null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    seededFromCharterOnceRef.current = false;
    loadFromDb();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [projectId, artifactId]);

  useEffect(() => {
    const onChanged = (ev: Event) => {
      const ce = ev as CustomEvent<StakeholdersChangedDetail>;
      if (!ce?.detail || (String(ce.detail.projectId) === projectId && String(ce.detail.artifactId) === artifactId)) loadFromDb();
    };
    window.addEventListener("alienai:stakeholders-changed", onChanged as any);
    window.addEventListener("alienai:stakeholders-seeded", onChanged as any);
    return () => {
      window.removeEventListener("alienai:stakeholders-changed", onChanged as any);
      window.removeEventListener("alienai:stakeholders-seeded", onChanged as any);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, artifactId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (doc.rows ?? []).filter((r) => {
      const matchQ =
        !q || [r.name, r.role, r.title_role, r.point_of_contact, ...(r.channels ?? [])].some((v) => String(v ?? "").toLowerCase().includes(q));
      const matchP =
        personFilter === "all" || (personFilter === "internal" ? r.internal_external === "Internal" : r.internal_external === "External");
      return matchQ && matchP;
    });
  }, [doc.rows, search, personFilter]);

  const groups = useMemo(() => {
    const m = new Map<string, StakeholderRow[]>();
    for (const r of filtered) {
      const g = normalizeGroup(r.group ?? "");
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(r);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function updateRow(id: string, patch: Partial<StakeholderRow>) {
    setDoc((p) => ({ ...p, rows: p.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    setDirty(true);
  }

  function addRow(group?: string) {
    const g = normalizeGroup(group ?? "");
    setDoc((p) => ({
      ...p,
      rows: [
        {
          id: uuid(),
          name: "",
          point_of_contact: "",
          role: "Stakeholder",
          internal_external: "Internal",
          title_role: "",
          impact_level: "Medium",
          influence_level: "Medium",
          stakeholder_mapping: "Keep Informed",
          involvement_milestone: "",
          stakeholder_impact: "",
          channels: ["Teams"],
          group: g,
          __draft: true,
        },
        ...p.rows,
      ],
    }));
    setDirty(true);
    setCollapsed((c) => ({ ...c, [g]: false }));
  }

  async function removeRow(id: string) {
    if (readOnly) return;
    setErr(null);
    const row = (doc.rows ?? []).find((r) => r.id === id);
    if (!row || row.__draft || !isDbUuid(row.id)) {
      setDoc((p) => ({ ...p, rows: p.rows.filter((r) => r.id !== id) }));
      setDirty(true);
      return;
    }
    const prevRows = doc.rows;
    setDoc((p) => ({ ...p, rows: p.rows.filter((r) => r.id !== id) }));
    setDeletingId(id);
    try {
      const res = await fetch(`/api/stakeholders/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`, {
        method: "DELETE",
      });
      const json = await safeJson(res);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Delete failed");
      setDirty(false);
      window.dispatchEvent(new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-changed", { detail: { projectId, artifactId, reason: "row_deleted" } }));
      loadSuggestions().catch(() => null);
    } catch (e: any) {
      setDoc((p) => ({ ...p, rows: prevRows }));
      setErr(String(e?.message ?? e));
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteAll() {
    if (readOnly || !window.confirm("Delete ALL stakeholders? This cannot be undone.")) return;
    setErr(null);
    const prevRows = doc.rows;
    setDoc((p) => ({ ...p, rows: [] }));
    setDeletingAll(true);
    try {
      const res = await fetch(`/api/stakeholders?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`, { method: "DELETE" });
      const json = await safeJson(res);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Delete all failed");
      setDirty(false);
      window.dispatchEvent(new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-changed", { detail: { projectId, artifactId, reason: "deleted_all" } }));
      loadSuggestions().catch(() => null);
    } catch (e: any) {
      setDoc((p) => ({ ...p, rows: prevRows }));
      setErr(String(e?.message ?? e));
    } finally {
      setDeletingAll(false);
    }
  }

  function buildDoc(rows: StakeholderRow[]) {
    const byGroup = new Map<string, StakeholderRow[]>();
    for (const r of rows) {
      const g = normalizeGroup(r.group ?? "Project");
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(r);
    }
    return {
      version: 1,
      type: "stakeholder_register",
      groups: Array.from(byGroup.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, rs]) => ({
          name,
          rows: rs
            .filter((x) => String(x?.name ?? "").trim())
            .map((x) => ({
              id: String(x.id),
              name: String(x.name).trim(),
              point_of_contact: String(x.point_of_contact ?? "").trim(),
              role: String(x.role ?? "").trim(),
              internal_external: x.internal_external ?? "Internal",
              title_role: String(x.title_role ?? "").trim(),
              impact_level: x.impact_level ?? "Medium",
              influence_level: x.influence_level ?? "Medium",
              stakeholder_mapping: x.stakeholder_mapping ?? inferMapping(x.influence_level, x.impact_level),
              involvement_milestone: String(x.involvement_milestone ?? "").trim(),
              stakeholder_impact: String(x.stakeholder_impact ?? "").trim(),
              channels: Array.isArray(x.channels) ? x.channels.map(normalizeChannel).filter(Boolean) : [],
              group: name,
            })),
        })),
    };
  }

  async function persistArtifactContentJson(rows: StakeholderRow[]) {
    const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/content-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, title: "Stakeholder Register", content_json: buildDoc(rows) }),
    });
    const json = await safeJson(res);
    if (!res.ok || !json?.ok) throw new Error(String(json?.error || "Failed to update artifact content_json"));
  }

  async function saveNow() {
    setErr(null);
    startSaving(async () => {
      try {
        const seen = new Set<string>();
        for (const r of doc.rows ?? []) {
          const key = normalizeNameKey(r?.name);
          if (!key) continue;
          if (seen.has(key)) throw new Error(`Duplicate name: "${String(r?.name ?? "").trim()}".`);
          seen.add(key);
        }

        const items = (doc.rows ?? [])
          .map((r) => {
            const name = String(r.name ?? "").trim();
            if (!name) return null;
            const impact_ui: Impact = r.impact_level === "High" ? "High" : r.impact_level === "Low" ? "Low" : "Medium";
            return {
              id: isDbUuid(r.id) ? r.id : undefined,
              name,
              name_key: normalizeNameKey(name),
              role: String(r.role ?? "").trim() || null,
              influence_level: normalizeUiInfluenceToDb(r.influence_level),
              expectations: null,
              communication_strategy: null,
              contact_info: {
                point_of_contact: String(r.point_of_contact ?? "").trim(),
                internal_external: r.internal_external ?? "Internal",
                title_role: String(r.title_role ?? "").trim(),
                stakeholder_mapping: r.stakeholder_mapping ?? inferMapping(r.influence_level, impact_ui),
                involvement_milestone: String(r.involvement_milestone ?? "").trim(),
                stakeholder_impact: String(r.stakeholder_impact ?? "").trim(),
                channels: Array.isArray(r.channels) ? r.channels.map(normalizeChannel).filter(Boolean) : [],
                group: normalizeGroup(r.group ?? "Project"),
                impact_level: impact_ui,
              },
            };
          })
          .filter(Boolean);

        const res = await fetch(`/api/stakeholders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, artifactId, items }),
        });
        const json = await safeJson(res);
        if (!res.ok || !json?.ok) {
          const msg = String(json?.error || "Save failed");
          throw new Error(
            msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")
              ? "A stakeholder with that name already exists. Please use a unique name."
              : msg
          );
        }

        await persistArtifactContentJson(doc.rows ?? []);
        setDirty(false);
        await loadFromDb();
        window.dispatchEvent(new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-changed", { detail: { projectId, artifactId, reason: "saved" } }));
        loadSuggestions().catch(() => null);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    });
  }

  const toggleExpand = (id: string) =>
    setExpandedRows((p) => {
      const n = new Set(p);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  const busy = loading || saving || sugBusy || deletingAll || deletingId !== null;

  // Export
  function filenameFromDisposition(h: string | null) {
    if (!h) return null;
    const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(h);
    const raw = decodeURIComponent(m?.[1] || m?.[2] || m?.[3] || "");
    return raw ? raw.trim() : null;
  }
  async function downloadFromRoute(opts: { url: string; fallbackName: string; mime?: string }) {
    if (dirty && !readOnly && !window.confirm("Unsaved changes. Export anyway?")) return;
    const u = new URL(opts.url, window.location.origin);
    u.searchParams.set("projectId", projectId);
    u.searchParams.set("artifactId", artifactId);
    const res = await fetch(u.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error(j?.error || `Export failed (${res.status})`);
    }
    const ab = await res.arrayBuffer();
    const name = filenameFromDisposition(res.headers.get("Content-Disposition")) || opts.fallbackName;
    const blob = new Blob([ab], { type: opts.mime || res.headers.get("content-type") || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  async function runExport(opts: { url: string; fallbackName: string; mime?: string }) {
    if (busy) return;
    setErr(null);
    try {
      await downloadFromRoute(opts);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setShowDownloadMenu(false);
    }
  }
  const D = new Date().toISOString().slice(0, 10);
  const downloadExcel = () =>
    runExport({
      url: "/api/artifacts/stakeholder-register/export/xlsx",
      fallbackName: `Stakeholder_Register_${D}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  const downloadPDF = () => runExport({ url: "/api/artifacts/stakeholder-register/export/pdf", fallbackName: `Stakeholder_Register_${D}.pdf`, mime: "application/pdf" });
  const downloadWord = () =>
    runExport({
      url: "/api/artifacts/stakeholder-register/export/docx",
      fallbackName: `Stakeholder_Register_${D}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

  const stats = useMemo(
    () => ({
      total: doc.rows?.length ?? 0,
      internal: (doc.rows ?? []).filter((r) => r.internal_external === "Internal").length,
      external: (doc.rows ?? []).filter((r) => r.internal_external === "External").length,
      highInfluence: (doc.rows ?? []).filter((r) => r.influence_level === "High").length,
    }),
    [doc.rows]
  );

  // Resizable TH component
  const Th = ({ colKey, children, last }: { colKey: string; children?: React.ReactNode; last?: boolean }) => (
    <th className={`${TH_CLS} relative group/th ${last ? "" : "border-r border-gray-200"}`} style={{ width: colWidths[colKey], minWidth: colWidths[colKey] }}>
      {children}
      <div
        className="absolute right-0 top-0 h-full w-3 cursor-col-resize flex items-center justify-center opacity-0 group-hover/th:opacity-100 z-10 transition-opacity"
        onMouseDown={(e) => handleResizeStart(e, colKey)}
      >
        <div className="h-3 w-px bg-gray-400" />
      </div>
    </th>
  );

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-screen bg-[#f7f7f5]" style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div className="max-w-[1920px] mx-auto">
        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200">
          <div className="flex items-center gap-3">
            <span className="text-[15px] font-semibold text-gray-900">Stakeholder Register</span>
            {/* Stat chips */}
            {[
              { n: stats.total, label: "Total", dot: "bg-gray-400" },
              { n: stats.internal, label: "Internal", dot: "bg-blue-500" },
              { n: stats.external, label: "External", dot: "bg-purple-500" },
              { n: stats.highInfluence, label: "High Influence", dot: "bg-red-500" },
            ].map(({ n, label, dot }) => (
              <span
                key={label}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 border border-gray-200 text-[11px] font-medium text-gray-600"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                <span className="font-semibold">{n}</span> {label}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* View toggle */}
            <div className="flex items-center bg-gray-100 border border-gray-200 rounded-lg p-0.5 gap-0.5">
              {(["table", "cards"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  disabled={busy}
                  type="button"
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-[12px] font-medium transition-all ${
                    mode === m ? "bg-white shadow-sm text-gray-900 border border-gray-200" : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {m === "table" ? <Icons.List /> : <Icons.Grid />}
                  {m === "table" ? "Table" : "Cards"}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-gray-400 pointer-events-none">
                <Icons.Search />
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={busy}
                className="w-48 pl-8 pr-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[13px] placeholder-gray-400 focus:outline-none focus:border-gray-400 transition-colors"
                placeholder="Search…"
              />
            </div>

            {/* Filter */}
            <div className="relative">
              <select
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value as any)}
                disabled={readOnly || busy}
                className="pl-3 pr-8 py-1.5 bg-white border border-gray-200 rounded-lg text-[13px] text-gray-700 focus:outline-none focus:border-gray-400 appearance-none cursor-pointer"
              >
                <option value="all">All</option>
                <option value="internal">Internal</option>
                <option value="external">External</option>
              </select>
              <div className="absolute inset-y-0 right-0 pr-2 flex items-center pointer-events-none text-gray-400">
                <Icons.ChevronDown />
              </div>
            </div>

            <div className="w-px h-5 bg-gray-200" />

            <button
              onClick={loadFromDb}
              disabled={busy}
              type="button"
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-600 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              <span className={loading ? "animate-spin" : ""}>
                <Icons.Refresh />
              </span>
              {loading ? "Loading…" : "Refresh"}
            </button>

            <button
              onClick={saveNow}
              disabled={readOnly || saving || !dirty || busy}
              type="button"
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                dirty ? "bg-gray-900 text-white hover:bg-gray-800" : "bg-gray-100 text-gray-400 cursor-default"
              }`}
            >
              <Icons.Save />
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>

            {/* Export */}
            <div className="relative" ref={downloadMenuRef}>
              <button
                onClick={() => setShowDownloadMenu((v) => !v)}
                disabled={busy}
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[12px] text-gray-600 hover:bg-gray-50 transition-colors"
              >
                <Icons.Download /> Export <Icons.ChevronDown />
              </button>
              {showDownloadMenu && (
                <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg border border-gray-200 shadow-xl py-1 z-50">
                  <button
                    onClick={downloadExcel}
                    disabled={busy}
                    type="button"
                    className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50"
                  >
                    <span className="text-green-600">
                      <Icons.FileSpreadsheet />
                    </span>{" "}
                    Excel (.xlsx)
                  </button>
                  <div className="h-px bg-gray-100 my-0.5" />
                  <button onClick={downloadPDF} disabled={busy} type="button" className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50">
                    <span className="text-red-500">
                      <Icons.FilePdf />
                    </span>{" "}
                    PDF
                  </button>
                  <button onClick={downloadWord} disabled={busy} type="button" className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50">
                    <span className="text-blue-600">
                      <Icons.FileText />
                    </span>{" "}
                    Word (.docx)
                  </button>
                </div>
              )}
            </div>

            {!readOnly && (
              <button
                onClick={deleteAll}
                disabled={busy || !doc.rows?.length}
                type="button"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-[12px] text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors disabled:opacity-40"
              >
                <Icons.Trash /> Clear All
              </button>
            )}
          </div>
        </div>

        {/* ── Error ──────────────────────────────────────────────────────── */}
        {err && (
          <div className="flex items-center gap-2 px-5 py-2.5 bg-red-50 border-b border-red-200 text-[13px] text-red-700">
            <Icons.AlertCircle />
            <span className="flex-1">{err}</span>
            <button onClick={() => setErr(null)} type="button" className="p-0.5 hover:bg-red-100 rounded">
              <Icons.X />
            </button>
          </div>
        )}

        {/* ── AI suggestions ─────────────────────────────────────────────── */}
        {pendingSugs.length > 0 && (
          <div className="flex items-center gap-3 px-5 py-2.5 bg-amber-50 border-b border-amber-200">
            <Icons.Lightbulb />
            <span className="text-[13px] text-gray-700 flex-1">
              <strong>{pendingSugs.length}</strong> stakeholder suggestion{pendingSugs.length > 1 ? "s" : ""} from Project Charter
            </span>
            <button
              onClick={() => document.getElementById("ai-suggestions-panel")?.scrollIntoView({ behavior: "smooth" })}
              disabled={busy}
              type="button"
              className="px-3 py-1 bg-white border border-amber-200 rounded-md text-[12px] text-gray-700 hover:bg-amber-50 transition-colors"
            >
              Review
            </button>
            {!readOnly && (
              <button
                onClick={acceptAllSuggestions}
                disabled={busy}
                type="button"
                className="px-3 py-1 bg-gray-900 text-white rounded-md text-[12px] hover:bg-gray-800 transition-colors"
              >
                {sugBusy ? "Accepting…" : "Accept All"}
              </button>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            CARD VIEW
        ═══════════════════════════════════════════════════════════════ */}
        {mode === "cards" && (
          <div className="p-6">
            {filtered.length === 0 ? (
              <div className="text-center py-20">
                <p className="text-2xl mb-2">👥</p>
                <p className="text-[14px] font-medium text-gray-700 mb-1">No stakeholders found</p>
                <p className="text-[13px] text-gray-400 mb-4">Add stakeholders to get started</p>
                {!readOnly && (
                  <button
                    onClick={() => addRow()}
                    disabled={busy}
                    type="button"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-[13px] font-medium hover:bg-gray-800 transition-colors"
                  >
                    <Icons.Plus /> Add Stakeholder
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                {filtered.map((s) => {
                  const initials = s.name ? s.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : "?";
                  return (
                    <div key={s.id} className="group relative bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 hover:shadow-sm transition-all">
                      {!readOnly && (
                        <button
                          onClick={() => removeRow(s.id)}
                          disabled={busy || deletingId === s.id}
                          type="button"
                          aria-label={`Delete ${s.name || "stakeholder"}`}
                          className="absolute top-3 right-3 p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Icons.Trash />
                        </button>
                      )}
                      <div className="flex items-center gap-2.5 mb-3 pr-7">
                        <div className="w-8 h-8 rounded-full bg-gray-900 flex items-center justify-center text-white text-[11px] font-bold shrink-0">{initials}</div>
                        <div className="min-w-0">
                          <p className="font-semibold text-[13px] text-gray-900 truncate">{s.name || "Unnamed"}</p>
                          <p className="text-[11px] text-gray-400 truncate">{s.title_role || s.role || "—"}</p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${typePill(s.internal_external ?? "Internal")}`}>{s.internal_external ?? "Internal"}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${levelPill(s.impact_level)}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${levelDot(s.impact_level)}`} /> Impact: {s.impact_level}
                        </span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${levelPill(s.influence_level)}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${levelDot(s.influence_level)}`} /> Influence: {s.influence_level}
                        </span>
                      </div>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${mappingPill(s.stakeholder_mapping ?? "")}`}>{s.stakeholder_mapping ?? "—"}</span>
                      {(s.channels ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2.5">
                          {s.channels!.map((c) => (
                            <span key={c} className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium border ${channelChip(c)}`}>
                              {c}
                            </span>
                          ))}
                        </div>
                      )}
                      {s.point_of_contact && (
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-400 mt-2.5 pt-2.5 border-t border-gray-100">
                          <Icons.Mail />
                          <span className="truncate">{s.point_of_contact}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════
            TABLE VIEW — true Notion-style spreadsheet
        ═══════════════════════════════════════════════════════════════ */}
        {mode === "table" && (
          <div className="relative">
            {/* Loading overlay — keeps existing rows visible while refreshing */}
            {loading && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-20 flex items-start justify-center pt-16 pointer-events-none">
                <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-full shadow-sm text-[12px] text-gray-500">
                  <span className="w-3.5 h-3.5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                  Loading…
                </div>
              </div>
            )}
            {groups.length === 0 ? (
              <div className="text-center py-20 bg-white">
                <p className="text-2xl mb-2">👥</p>
                <p className="text-[14px] font-medium text-gray-700 mb-1">No stakeholders yet</p>
                <p className="text-[13px] text-gray-400 mb-4">Add stakeholders to track influence, impact and communication</p>
                {!readOnly && (
                  <button
                    onClick={() => addRow()}
                    disabled={busy}
                    type="button"
                    className="inline-flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white rounded-lg text-[13px] font-medium hover:bg-gray-800 transition-colors"
                  >
                    <Icons.Plus /> Add First Stakeholder
                  </button>
                )}
              </div>
            ) : (
              groups.map(([groupName, rows]) => {
                const isCollapsed = !!collapsed[groupName];
                return (
                  <div key={groupName} className="border-b border-gray-200">
                    {/* Group header — matching RAID "Risks / Assumptions" header */}
                    <div className="flex items-center justify-between px-5 py-3 bg-white group/grp">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setCollapsed((c) => ({ ...c, [groupName]: !c[groupName] }))}
                          disabled={busy}
                          className="flex items-center gap-2"
                        >
                          <span className={`text-gray-400 transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`}>
                            <Icons.ChevronRight />
                          </span>
                          <span className="text-[14px]">👥</span>
                          <span className="font-bold text-[14px] text-gray-800">{groupName}</span>
                        </button>
                        <span className="text-[13px] text-gray-400 font-normal pl-0.5">Stakeholder group</span>
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-[11px] font-bold text-gray-500 ml-1">{rows.length}</span>
                      </div>

                      <div className="flex items-center gap-2 opacity-0 group-hover/grp:opacity-100 transition-opacity">
                        <button type="button" aria-label="Group options" className="p-1.5 rounded text-gray-400 hover:bg-gray-100 transition-colors">
                          <Icons.DotsVertical />
                        </button>
                        {!readOnly && (
                          <button
                            onClick={() => addRow(groupName)}
                            disabled={busy}
                            type="button"
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white rounded-lg text-[12px] font-medium hover:bg-gray-800 transition-colors"
                          >
                            <Icons.Plus /> New Stakeholder
                          </button>
                        )}
                      </div>
                    </div>

                    {!isCollapsed && (
                      <>
                        <div className="overflow-x-auto border-t border-gray-200" style={{ cursor: resizingCol ? "col-resize" : "default" }}>
                          <table ref={tableRef} className="w-full border-collapse text-[13px]">
                            <colgroup>
                              {Object.entries(DEFAULT_COL_WIDTHS)
                                .filter(([k]) => k !== "actions" || !readOnly)
                                .map(([k]) => (
                                  <col key={k} style={{ width: colWidths[k], minWidth: colWidths[k] }} />
                                ))}
                            </colgroup>
                            <thead>
                              <tr>
                                <Th colKey="name"># Name</Th>
                                <Th colKey="point_of_contact">Contact Details</Th>
                                <Th colKey="role">Role</Th>
                                <Th colKey="internal_external">Type</Th>
                                <Th colKey="title_role">Title / Role</Th>
                                <Th colKey="impact_level">Impact</Th>
                                <Th colKey="influence_level">Influence</Th>
                                <Th colKey="stakeholder_mapping">Mapping</Th>
                                <Th colKey="involvement_milestone">Milestone</Th>
                                <Th colKey="stakeholder_impact">Impact Notes</Th>
                                <Th colKey="channels">Channels</Th>
                                {!readOnly && <Th colKey="actions" last> </Th>}
                              </tr>
                            </thead>

                            <tbody>
                              {rows.map((r) => {
                                const isExpanded = expandedRows.has(r.id);
                                return (
                                  <tr key={r.id} className="group/row hover:bg-[#f9f9f8] transition-colors">
                                    {/* Name */}
                                    <td className={`${TD_CLS} border-r border-gray-100`} style={{ width: colWidths.name }}>
                                      <input
                                        className={INLINE_INPUT_CLS}
                                        value={r.name ?? ""}
                                        onChange={(e) => updateRow(r.id, { name: e.target.value })}
                                        readOnly={readOnly}
                                        placeholder="Stakeholder name…"
                                        disabled={busy}
                                        aria-label="Stakeholder name"
                                      />
                                    </td>

                                    {/* Contact */}
                                    <td className={`${TD_CLS} border-r border-gray-100`} style={{ width: colWidths.point_of_contact }}>
                                      <div className="flex items-center">
                                        <span className="pl-4 text-gray-300 shrink-0 pointer-events-none">
                                          <Icons.Mail />
                                        </span>
                                        <input
                                          className={`${INLINE_INPUT_CLS} pl-2`}
                                          value={r.point_of_contact ?? ""}
                                          onChange={(e) => updateRow(r.id, { point_of_contact: e.target.value })}
                                          readOnly={readOnly}
                                          placeholder="Email / Phone…"
                                          disabled={busy}
                                          aria-label="Contact details"
                                        />
                                      </div>
                                    </td>

                                    {/* Role */}
                                    <td className={`${TD_CLS} border-r border-gray-100`} style={{ width: colWidths.role }}>
                                      <input
                                        className={INLINE_INPUT_CLS}
                                        value={r.role ?? ""}
                                        onChange={(e) => updateRow(r.id, { role: e.target.value })}
                                        readOnly={readOnly}
                                        placeholder="Role…"
                                        disabled={busy}
                                        aria-label="Role"
                                      />
                                    </td>

                                    {/* Type — badge select */}
                                    <td className={`${TD_CLS} border-r border-gray-100 px-4`} style={{ width: colWidths.internal_external }}>
                                      <BadgeSelect
                                        value={r.internal_external ?? "Internal"}
                                        onChange={(v) => updateRow(r.id, { internal_external: v as InternalExternal })}
                                        options={[
                                          { value: "Internal", label: "Internal" },
                                          { value: "External", label: "External" },
                                        ]}
                                        disabled={readOnly || busy}
                                        pillFn={typePill}
                                      />
                                    </td>

                                    {/* Title */}
                                    <td className={`${TD_CLS} border-r border-gray-100`} style={{ width: colWidths.title_role }}>
                                      <input
                                        className={INLINE_INPUT_CLS}
                                        value={r.title_role ?? ""}
                                        onChange={(e) => updateRow(r.id, { title_role: e.target.value })}
                                        readOnly={readOnly}
                                        placeholder="Title…"
                                        disabled={busy}
                                        aria-label="Title / Role"
                                      />
                                    </td>

                                    {/* Impact — badge select */}
                                    <td className={`${TD_CLS} border-r border-gray-100 px-4`} style={{ width: colWidths.impact_level }}>
                                      <BadgeSelect
                                        value={r.impact_level ?? "Medium"}
                                        onChange={(v) => updateRow(r.id, { impact_level: v as Impact })}
                                        options={[
                                          { value: "High", label: "High" },
                                          { value: "Medium", label: "Medium" },
                                          { value: "Low", label: "Low" },
                                        ]}
                                        disabled={readOnly || busy}
                                        pillFn={levelPill}
                                        showDot
                                      />
                                    </td>

                                    {/* Influence — badge select */}
                                    <td className={`${TD_CLS} border-r border-gray-100 px-4`} style={{ width: colWidths.influence_level }}>
                                      <BadgeSelect
                                        value={r.influence_level ?? "Medium"}
                                        onChange={(v) => updateRow(r.id, { influence_level: v as Influence })}
                                        options={[
                                          { value: "High", label: "High" },
                                          { value: "Medium", label: "Medium" },
                                          { value: "Low", label: "Low" },
                                        ]}
                                        disabled={readOnly || busy}
                                        pillFn={levelPill}
                                        showDot
                                      />
                                    </td>

                                    {/* Mapping — badge select */}
                                    <td className={`${TD_CLS} border-r border-gray-100 px-4`} style={{ width: colWidths.stakeholder_mapping }}>
                                      <BadgeSelect
                                        value={r.stakeholder_mapping ?? "Keep Informed"}
                                        onChange={(v) => updateRow(r.id, { stakeholder_mapping: v as Mapping })}
                                        options={[
                                          { value: "Manage Closely", label: "Manage Closely" },
                                          { value: "Keep Satisfied", label: "Keep Satisfied" },
                                          { value: "Keep Informed", label: "Keep Informed" },
                                          { value: "Monitor", label: "Monitor" },
                                        ]}
                                        disabled={readOnly || busy}
                                        pillFn={mappingPill}
                                      />
                                    </td>

                                    {/* Milestone */}
                                    <td className={`${TD_CLS} border-r border-gray-100`} style={{ width: colWidths.involvement_milestone }}>
                                      <input
                                        className={INLINE_INPUT_CLS}
                                        value={r.involvement_milestone ?? ""}
                                        onChange={(e) => updateRow(r.id, { involvement_milestone: e.target.value })}
                                        readOnly={readOnly}
                                        placeholder="Milestone…"
                                        disabled={busy}
                                        aria-label="Involvement milestone"
                                      />
                                    </td>

                                    {/* Impact Notes */}
                                    <td className={`${TD_CLS} border-r border-gray-100`} style={{ width: colWidths.stakeholder_impact }}>
                                      <div className="relative">
                                        <textarea
                                          className={`${INLINE_INPUT_CLS} resize-none leading-snug`}
                                          value={r.stakeholder_impact ?? ""}
                                          onChange={(e) => updateRow(r.id, { stakeholder_impact: e.target.value })}
                                          readOnly={readOnly}
                                          placeholder="Notes…"
                                          disabled={busy}
                                          rows={isExpanded ? 3 : 1}
                                          style={{ minHeight: isExpanded ? 64 : 36 }}
                                          aria-label="Impact notes"
                                        />
                                        {r.stakeholder_impact && r.stakeholder_impact.length > 40 && (
                                          <button
                                            onClick={() => toggleExpand(r.id)}
                                            type="button"
                                            disabled={busy}
                                            aria-label={isExpanded ? "Collapse notes" : "Expand notes"}
                                            className="absolute bottom-1 right-1 p-0.5 text-gray-300 hover:text-gray-600 rounded transition-colors"
                                          >
                                            <Icons.Expand />
                                          </button>
                                        )}
                                      </div>
                                    </td>

                                    {/* Channels */}
                                    <td className={`${TD_CLS} border-r border-gray-100`} style={{ width: colWidths.channels }}>
                                      <div className="px-3 py-1.5">
                                        <MultiSelectPopover
                                          value={Array.isArray(r.channels) ? r.channels : []}
                                          options={channelOptions}
                                          onChange={(next) =>
                                            updateRow(r.id, { channels: Array.isArray(next) ? next.map(normalizeChannel).filter(Boolean) : [] })
                                          }
                                          disabled={readOnly || busy}
                                          placeholder="Channels…"
                                          widthClassName="w-full"
                                          maxChips={isExpanded ? 5 : 2}
                                          helpText=""
                                        />
                                      </div>
                                    </td>

                                    {/* Delete */}
                                    {!readOnly && (
                                      <td className={TD_CLS} style={{ width: colWidths.actions }}>
                                        <div className="flex items-center justify-center opacity-0 group-hover/row:opacity-100 transition-opacity px-2">
                                          <button
                                            onClick={() => removeRow(r.id)}
                                            disabled={busy || deletingId === r.id}
                                            type="button"
                                            aria-label={`Delete ${r.name || "stakeholder"}`}
                                            className="p-1.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                                          >
                                            {deletingId === r.id ? (
                                              <span className="block w-3 h-3 border-2 border-red-200 border-t-red-500 rounded-full animate-spin" />
                                            ) : (
                                              <Icons.Trash />
                                            )}
                                          </button>
                                        </div>
                                      </td>
                                    )}
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>

                        {/* Add row — matching RAID "+ Add risk" button */}
                        {!readOnly && (
                          <button
                            onClick={() => addRow(groupName)}
                            disabled={busy}
                            type="button"
                            className="flex items-center gap-2 px-5 py-2.5 w-full bg-white text-[13px] text-gray-400 hover:text-gray-700 hover:bg-gray-50 transition-colors border-t border-gray-200"
                          >
                            <Icons.Plus /> Add stakeholder
                          </button>
                        )}
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-2 bg-white border-t border-gray-200 text-[11px] text-gray-400">
          <span>{readOnly ? "🔒 Read-only" : dirty ? "⚡ Unsaved changes" : "✓ All saved"}</span>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            Auto-sync enabled
          </div>
        </div>
      </div>
    </div>
  );
}