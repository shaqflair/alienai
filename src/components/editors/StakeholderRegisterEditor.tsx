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

// Icons
const Icons = {
  Plus: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  ),
  Trash: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  ),
  Refresh: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  ),
  Search: () => (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  ),
  ChevronDown: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  ),
  ChevronRight: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  ),
  Grid: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
      />
    </svg>
  ),
  List: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" />
    </svg>
  ),
  Download: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  ),
  FileSpreadsheet: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  ),
  FileText: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  FilePdf: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  ),
  Lightbulb: () => (
    <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
      />
    </svg>
  ),
  AlertCircle: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  Save: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
    </svg>
  ),
  X: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  Expand: () => (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
      />
    </svg>
  ),
  Mail: () => (
    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
};

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `row_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function isDbUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x ?? ""));
}

// Cell background colors for Impact/Influence
function getImpactInfluenceCellClass(level: any) {
  const s = String(level ?? "").toLowerCase();
  if (s === "high") return "bg-rose-50/60 border-l-4 border-l-rose-500";
  if (s === "medium") return "bg-amber-50/60 border-l-4 border-l-amber-500";
  if (s === "low") return "bg-emerald-50/60 border-l-4 border-l-emerald-500";
  return "bg-white border-l-4 border-l-transparent";
}

function pillClassLevel(v: any) {
  const s = String(v ?? "").toLowerCase();
  if (s === "high") return "bg-rose-100 text-rose-800 border-rose-300 font-semibold";
  if (s === "medium") return "bg-amber-100 text-amber-800 border-amber-300 font-semibold";
  if (s === "low") return "bg-emerald-100 text-emerald-800 border-emerald-300 font-semibold";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

function pillClassMap(v: any) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("manage")) return "bg-rose-50 text-rose-800 border-rose-200";
  if (s.includes("satisfied")) return "bg-amber-50 text-amber-800 border-amber-200";
  if (s.includes("informed")) return "bg-blue-50 text-blue-800 border-blue-200";
  if (s.includes("monitor")) return "bg-gray-50 text-gray-800 border-gray-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

function channelChipClass(label: any) {
  const s = String(label ?? "").trim().toLowerCase();
  if (!s) return "bg-gray-100 text-gray-600 border-gray-200";
  if (s.includes("teams")) return "bg-indigo-50 text-indigo-700 border-indigo-200";
  if (s.includes("web") || s.includes("app") || s.includes("portal") || s.includes("sharepoint"))
    return "bg-violet-50 text-violet-700 border-violet-200";
  if (s.includes("email")) return "bg-sky-50 text-sky-700 border-sky-200";
  if (s.includes("phone") || s.includes("call")) return "bg-orange-50 text-orange-700 border-orange-200";
  if (s.includes("face") || s.includes("in person") || s.includes("workshop"))
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-gray-100 text-gray-600 border-gray-200";
}

function normalizeGroup(x: any) {
  const s = String(x ?? "").trim();
  return s || "Project";
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
  if (s === "high") return "High";
  if (s === "low") return "Low";
  return "Medium";
}

function normalizeUiInfluenceToDb(x: any): "high" | "medium" | "low" {
  const s = String(x ?? "").toLowerCase();
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

function normalizeChannel(x: any) {
  return String(x ?? "").trim().replace(/\s+/g, " ");
}

// ✅ normalize stakeholder name for uniqueness checks (client-side)
function normalizeNameKey(x: any) {
  return String(x ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

type StakeholdersChangedDetail = {
  projectId?: string;
  artifactId?: string;
  reason?: string;
};

type PendingSuggestion = {
  id: string;
  suggestion_type?: string;
  status?: string;
  rationale?: string | null;
  payload?: any;
  created_at?: string;
};

const DEFAULT_COL_WIDTHS: Record<string, number> = {
  name: 220,
  point_of_contact: 200,
  role: 150,
  internal_external: 120,
  title_role: 180,
  impact_level: 120,
  influence_level: 120,
  stakeholder_mapping: 150,
  involvement_milestone: 200,
  stakeholder_impact: 250,
  channels: 280,
  actions: 100,
};

export default function StakeholderRegisterEditor(props: {
  projectId: string;
  artifactId: string;
  initialJson: any | null;
  readOnly?: boolean;
}) {
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
  const downloadMenuRef = useRef<HTMLDivElement>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(0);

  // Instant paint from initialJson (if present)
  useEffect(() => {
    if (!initialJson) return;
    if (doc.rows?.length) return;
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
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialJson]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setShowDownloadMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
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
    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - resizeStartX.current;
      const newWidth = Math.max(80, resizeStartWidth.current + diff);
      setColWidths((prev) => ({ ...prev, [resizingCol]: newWidth }));
    };
    const handleMouseUp = () => {
      setResizingCol(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
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
    for (const r of doc.rows ?? []) {
      for (const c of r.channels ?? []) {
        const v = normalizeChannel(c);
        if (v) set.add(v);
      }
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
      if (!res.ok || !json?.ok) {
        console.warn("[ai/suggestions/list] failed");
        setPendingSugs([]);
        return;
      }
      const arr = Array.isArray(json?.suggestions) ? json.suggestions : [];
      setPendingSugs(arr);
    } catch (e) {
      console.warn("[ai/suggestions/list] exception", e);
      setPendingSugs([]);
    }
  }

  async function acceptAllSuggestions() {
    if (readOnly) return;
    const ids = (pendingSugs ?? []).map((s) => String(s?.id ?? "")).filter(Boolean);
    if (!ids.length) return;
    startSugTransition(async () => {
      for (const id of ids) {
        await fetch(`/api/ai/suggestions/apply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, suggestionId: id }),
        }).catch(() => null);
      }
      await loadFromDb().catch(() => null);
      await loadSuggestions().catch(() => null);
      window.dispatchEvent(
        new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-changed", {
          detail: { projectId, artifactId, reason: "suggestions_accepted_all" },
        })
      );
    });
  }

  async function seedFromCharter() {
    try {
      const res = await fetch(`/api/stakeholders/seed-from-charter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, artifactId }),
      });
      const json = await safeJson(res);
      if (!res.ok || !json?.ok) {
        console.warn("[seed-from-charter] failed");
        return;
      }
      window.dispatchEvent(
        new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-seeded", {
          detail: { projectId, artifactId, reason: "seeded_from_charter" },
        })
      );
    } catch (e) {
      console.warn("[seed-from-charter] exception", e);
    }
  }

  async function loadFromDb() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/stakeholders?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`,
        { method: "GET" }
      );
      const json = await safeJson(res);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load stakeholders");

      const rows: StakeholderRow[] = (Array.isArray(json.stakeholders) ? json.stakeholders : []).map((s: any) => {
        const name = String(s?.name ?? "");

        const contact =
          s?.contact_info && typeof s.contact_info === "object" && s.contact_info !== null ? s.contact_info : {};

        const influence = normalizeInfluenceToUi(s?.influence_level);

        const impactRaw = contact?.impact_level ?? s?.impact_level ?? "Medium";
        const impact: Impact =
          String(impactRaw) === "High" ? "High" : String(impactRaw) === "Low" ? "Low" : "Medium";

        const channelsRaw = Array.isArray(contact?.channels) ? contact.channels : ["Teams"];
        const channels = channelsRaw.map((x: any) => normalizeChannel(x)).filter(Boolean);

        const internal_external: InternalExternal =
          String(contact?.internal_external ?? "Internal") === "External" ? "External" : "Internal";

        const title_role = String(contact?.title_role ?? "");
        const point_of_contact = String(contact?.point_of_contact ?? "");

        const stakeholder_mapping: Mapping =
          (contact?.stakeholder_mapping as Mapping) || inferMapping(influence, impact);

        const group = normalizeGroup(contact?.group ?? "Project");

        return {
          id: String(s?.id ?? uuid()),
          name,
          role: String(s?.role ?? ""),
          influence_level: influence,
          impact_level: impact,
          stakeholder_mapping,
          internal_external,
          title_role,
          point_of_contact,
          involvement_milestone: String(contact?.involvement_milestone ?? ""),
          stakeholder_impact: String(contact?.stakeholder_impact ?? ""),
          channels: channels.length ? channels : ["Teams"],
          group,
          __draft: false,
        };
      });

      // ✅ only seed from charter when the register is EMPTY (prevents unique constraint collisions)
      if (!seededFromCharterOnceRef.current && rows.length === 0) {
        seededFromCharterOnceRef.current = true;

        await seedFromCharter();

        // After seeding, reload once to pick up newly inserted rows
        const res2 = await fetch(
          `/api/stakeholders?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`,
          { method: "GET" }
        );
        const json2 = await safeJson(res2);
        if (res2.ok && json2?.ok) {
          const rows2: StakeholderRow[] = (Array.isArray(json2.stakeholders) ? json2.stakeholders : []).map((s: any) => {
            const name = String(s?.name ?? "");
            const contact = s?.contact_info && typeof s.contact_info === "object" ? s.contact_info : {};

            const influence = normalizeInfluenceToUi(s?.influence_level);

            const impact: Impact =
              String(contact?.impact_level ?? "Medium") === "High"
                ? "High"
                : String(contact?.impact_level ?? "Medium") === "Low"
                ? "Low"
                : "Medium";

            const channelsRaw = Array.isArray(contact?.channels) ? contact.channels : ["Teams"];
            const channels = channelsRaw.map((x: any) => normalizeChannel(x)).filter(Boolean);

            const internal_external: InternalExternal =
              String(contact?.internal_external ?? "Internal") === "External" ? "External" : "Internal";

            const title_role = String(contact?.title_role ?? "");
            const point_of_contact = String(contact?.point_of_contact ?? "");
            const stakeholder_mapping = (contact?.stakeholder_mapping as Mapping) || inferMapping(influence, impact);
            const group = String(contact?.group ?? "Project");

            return {
              id: String(s?.id ?? uuid()),
              name,
              role: String(s?.role ?? ""),
              influence_level: influence,
              impact_level: impact,
              stakeholder_mapping,
              internal_external,
              title_role,
              point_of_contact,
              involvement_milestone: String(contact?.involvement_milestone ?? ""),
              stakeholder_impact: String(contact?.stakeholder_impact ?? ""),
              channels: channels.length ? channels : ["Teams"],
              group,
              __draft: false,
            };
          });

          setDoc({ version: 1, type: "stakeholder_register", rows: rows2 });
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
    }
  }

  useEffect(() => {
    seededFromCharterOnceRef.current = false;
    loadFromDb();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, artifactId]);

  useEffect(() => {
    function matches(detail: StakeholdersChangedDetail | null | undefined) {
      const pid = String(detail?.projectId ?? "");
      const aid = String(detail?.artifactId ?? "");
      return pid === projectId && aid === artifactId;
    }
    function onChanged(ev: Event) {
      const ce = ev as CustomEvent<StakeholdersChangedDetail>;
      if (!ce?.detail) {
        loadFromDb();
        return;
      }
      if (matches(ce.detail)) loadFromDb();
    }
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
        !q ||
        String(r.name ?? "").toLowerCase().includes(q) ||
        String(r.role ?? "").toLowerCase().includes(q) ||
        String(r.title_role ?? "").toLowerCase().includes(q) ||
        String(r.point_of_contact ?? "").toLowerCase().includes(q) ||
        (Array.isArray(r.channels) && r.channels.join(" ").toLowerCase().includes(q));
      const matchPerson =
        personFilter === "all"
          ? true
          : personFilter === "internal"
          ? String(r.internal_external ?? "") === "Internal"
          : String(r.internal_external ?? "") === "External";
      return matchQ && matchPerson;
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
    setDoc((prev) => ({ ...prev, rows: prev.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    setDirty(true);
  }

  function addRow(group?: string) {
    const g = normalizeGroup(group ?? "");
    const row: StakeholderRow = {
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
    };
    setDoc((prev) => ({ ...prev, rows: [row, ...prev.rows] }));
    setDirty(true);
    setCollapsed((c) => ({ ...c, [g]: false }));
  }

  async function removeRow(id: string) {
    if (readOnly) return;
    setErr(null);
    const row = (doc.rows ?? []).find((r) => r.id === id);
    if (!row || row.__draft || !isDbUuid(row.id)) {
      setDoc((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== id) }));
      setDirty(true);
      return;
    }
    const prevRows = doc.rows;
    setDoc((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== id) }));
    setDeletingId(id);
    try {
      const res = await fetch(
        `/api/stakeholders/${encodeURIComponent(id)}?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`,
        { method: "DELETE" }
      );
      const json = await safeJson(res);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Delete failed");
      setDirty(false);
      window.dispatchEvent(
        new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-changed", {
          detail: { projectId, artifactId, reason: "row_deleted" },
        })
      );
      loadSuggestions().catch(() => null);
    } catch (e: any) {
      setDoc((prev) => ({ ...prev, rows: prevRows }));
      setErr(String(e?.message ?? e));
    } finally {
      setDeletingId(null);
    }
  }

  async function deleteAll() {
    if (readOnly) return;
    setErr(null);
    const sure = window.confirm("Delete ALL stakeholders for this artifact? This cannot be undone.");
    if (!sure) return;
    const prevRows = doc.rows;
    setDoc((prev) => ({ ...prev, rows: [] }));
    setDeletingAll(true);
    try {
      const res = await fetch(
        `/api/stakeholders?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`,
        { method: "DELETE" }
      );
      const json = await safeJson(res);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Delete all failed");
      setDirty(false);
      window.dispatchEvent(
        new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-changed", {
          detail: { projectId, artifactId, reason: "deleted_all" },
        })
      );
      loadSuggestions().catch(() => null);
    } catch (e: any) {
      setDoc((prev) => ({ ...prev, rows: prevRows }));
      setErr(String(e?.message ?? e));
    } finally {
      setDeletingAll(false);
    }
  }

  // ✅ Build grouped doc for artifacts.content_json (used by exports if they read artifacts.content_json)
  function buildArtifactStakeholderDoc(rows: StakeholderRow[]) {
    const byGroup = new Map<string, StakeholderRow[]>();
    for (const r of rows) {
      const g = normalizeGroup(r.group ?? "Project");
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g)!.push(r);
    }

    const groupsArr = Array.from(byGroup.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, rs]) => ({
        name,
        rows: rs
          .filter((x) => String(x?.name ?? "").trim() !== "")
          .map((x) => ({
            id: String(x.id ?? ""),
            name: String(x.name ?? "").trim(),
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
      }));

    return {
      version: 1,
      type: "stakeholder_register",
      groups: groupsArr,
    };
  }

  async function persistArtifactContentJsonFromRows(rows: StakeholderRow[]) {
    const content_json = buildArtifactStakeholderDoc(rows);

    const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/content-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        title: "Stakeholder Register",
        content_json,
      }),
    });

    const json = await safeJson(res);
    if (!res.ok || !json?.ok) {
      throw new Error(String(json?.error || "Failed to update artifact content_json"));
    }
  }

  async function saveNow() {
    setErr(null);
    startSaving(async () => {
      try {
        // ✅ Client-side duplicate guard (prevents Postgres unique constraint banner)
        const seen = new Set<string>();
        for (const r of doc.rows ?? []) {
          const key = normalizeNameKey(r?.name);
          if (!key) continue;
          if (seen.has(key)) {
            throw new Error(`Duplicate stakeholder name: "${String(r?.name ?? "").trim()}". Each name must be unique.`);
          }
          seen.add(key);
        }

        const items = (doc.rows ?? [])
          .map((r) => {
            const name = String(r.name ?? "").trim();
            if (!name) return null;

            const name_key = normalizeNameKey(name);

            const influence_db = normalizeUiInfluenceToDb(r.influence_level);
            const impact_ui: Impact =
              r.impact_level === "High" ? "High" : r.impact_level === "Low" ? "Low" : "Medium";

            return {
              // ✅ include id when it looks like a DB uuid so server can update instead of duplicating
              id: isDbUuid(r.id) ? r.id : undefined,

              name,
              name_key,

              role: String(r.role ?? "").trim() || null,

              // ✅ keep core levels top-level (your table appears to store influence_level here)
              influence_level: influence_db,

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

                // ✅ IMPORTANT: persist impact_level inside contact_info (because your loader reads it from there)
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
          if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
            throw new Error(
              "A stakeholder with that name already exists in this project. Please choose a unique name (or edit the existing stakeholder)."
            );
          }
          throw new Error(msg);
        }

        // ✅ keep artifact content_json in sync so exports won't be blank even if they read artifacts.content_json
        await persistArtifactContentJsonFromRows(doc.rows ?? []);

        setDirty(false);
        await loadFromDb();

        window.dispatchEvent(
          new CustomEvent<StakeholdersChangedDetail>("alienai:stakeholders-changed", {
            detail: { projectId, artifactId, reason: "saved" },
          })
        );
        loadSuggestions().catch(() => null);
      } catch (e: any) {
        setErr(String(e?.message ?? e));
      }
    });
  }

  const toggleRowExpand = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ✅ BUSY MUST BE DEFINED BEFORE EXPORT HELPERS
  const busy = loading || saving || sugBusy || deletingAll || deletingId !== null;

  // ─────────────────────────────────────────────────────────────
  // Export helpers
  // IMPORTANT: exports must call API routes only (never import server exporters in client).
  // ─────────────────────────────────────────────────────────────

  function filenameFromDisposition(header: string | null) {
    if (!header) return null;
    const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(header);
    const raw = decodeURIComponent(m?.[1] || m?.[2] || m?.[3] || "");
    return raw ? raw.trim() : null;
  }

  async function downloadFromRoute(opts: { url: string; fallbackName: string; mime?: string }) {
    // If you have unsaved edits, warn because exports read from DB.
    if (dirty && !readOnly) {
      const ok = window.confirm("You have unsaved changes. Export may be out of date. Export anyway?");
      if (!ok) return;
    }

    const u = new URL(opts.url, window.location.origin);
    u.searchParams.set("projectId", projectId);
    u.searchParams.set("artifactId", artifactId);

    const res = await fetch(u.toString(), { method: "GET", cache: "no-store" });

    if (!res.ok) {
      const j = await safeJson(res);
      throw new Error(j?.error || j?.message || `Export failed (${res.status})`);
    }

    const ab = await res.arrayBuffer();
    const cd = res.headers.get("Content-Disposition");
    const name = filenameFromDisposition(cd) || opts.fallbackName;

    const blob = new Blob([ab], { type: opts.mime || res.headers.get("content-type") || "application/octet-stream" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = name;
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

  const downloadExcel = async () => {
    const date = new Date().toISOString().slice(0, 10);
    await runExport({
      url: "/api/artifacts/stakeholder-register/export/xlsx",
      fallbackName: `Stakeholder_Register_${date}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
  };

  const downloadPDF = async () => {
    const date = new Date().toISOString().slice(0, 10);
    await runExport({
      url: "/api/artifacts/stakeholder-register/export/pdf",
      fallbackName: `Stakeholder_Register_${date}.pdf`,
      mime: "application/pdf",
    });
  };

  const downloadWord = async () => {
    const date = new Date().toISOString().slice(0, 10);
    await runExport({
      url: "/api/artifacts/stakeholder-register/export/docx",
      fallbackName: `Stakeholder_Register_${date}.docx`,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  };

  const stats = useMemo(() => {
    const rows = doc.rows || [];
    return {
      total: rows.length,
      internal: rows.filter((r) => r.internal_external === "Internal").length,
      external: rows.filter((r) => r.internal_external === "External").length,
      highInfluence: rows.filter((r) => r.influence_level === "High").length,
    };
  }, [doc.rows]);

  const ResizableHeader = ({
    children,
    colKey,
    className = "",
  }: {
    children: React.ReactNode;
    colKey: string;
    className?: string;
  }) => (
    <th
      className={`relative px-4 py-3.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50/80 border-b border-gray-200 group ${className}`}
      style={{
        width: colWidths[colKey] || DEFAULT_COL_WIDTHS[colKey],
        minWidth: colWidths[colKey] || DEFAULT_COL_WIDTHS[colKey],
      }}
    >
      <div className="flex items-center justify-between overflow-hidden">
        <span className="truncate">{children}</span>
      </div>
      <div
        className={`absolute right-0 top-0 h-full w-4 cursor-col-resize flex items-center justify-center hover:bg-blue-100/50 transition-colors ${
          resizingCol === colKey ? "bg-blue-200" : ""
        }`}
        onMouseDown={(e) => handleResizeStart(e, colKey)}
        title="Drag to resize"
      >
        <div className="w-0.5 h-4 bg-gray-300 group-hover:bg-blue-400 rounded-full" />
      </div>
    </th>
  );

  return (
    <div className="min-h-screen bg-gray-50/50">
      <div className="max-w-[1920px] mx-auto p-6 space-y-6">
        {/* Header Section */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white rounded-2xl border border-gray-200/60 p-6 shadow-sm">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Stakeholder Register</h1>
            <p className="text-sm text-gray-500 mt-1">
              Manage project stakeholders, influence levels, and communication strategies
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 mr-4">
              <div className="px-3 py-1.5 bg-gray-50 rounded-full border border-gray-200 text-xs font-medium text-gray-600">
                {stats.total} Total
              </div>
              <div className="px-3 py-1.5 bg-blue-50 rounded-full border border-blue-100 text-xs font-medium text-blue-700">
                {stats.internal} Internal
              </div>
              <div className="px-3 py-1.5 bg-purple-50 rounded-full border border-purple-100 text-xs font-medium text-purple-700">
                {stats.external} External
              </div>
            </div>

            <div className="relative" ref={downloadMenuRef}>
              <button
                onClick={() => setShowDownloadMenu((v) => !v)}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
                disabled={busy}
              >
                <Icons.Download />
                Export
                <Icons.ChevronDown />
              </button>

              {showDownloadMenu && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl border border-gray-200 shadow-lg z-50 py-1 animate-in fade-in slide-in-from-top-2 duration-200">
                  <button
                    onClick={downloadExcel}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                    type="button"
                    disabled={busy}
                  >
                    <span className="text-emerald-600">
                      <Icons.FileSpreadsheet />
                    </span>
                    Excel (.xlsx)
                  </button>

                  <div className="h-px bg-gray-100 my-1" />

                  <button
                    onClick={downloadPDF}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                    type="button"
                    disabled={busy}
                  >
                    <span className="text-red-600">
                      <Icons.FilePdf />
                    </span>
                    PDF Document
                  </button>

                  <button
                    onClick={downloadWord}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3 transition-colors"
                    type="button"
                    disabled={busy}
                  >
                    <span className="text-blue-600">
                      <Icons.FileText />
                    </span>
                    Word Document
                  </button>
                </div>
              )}
            </div>

            <button
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={readOnly || busy}
              onClick={() => addRow(groups[0]?.[0] ?? "Project")}
              type="button"
            >
              <Icons.Plus />
              New Stakeholder
            </button>
          </div>
        </div>

        {/* AI Suggestions Banner */}
        {pendingSugs.length > 0 && (
          <div className="bg-gradient-to-r from-amber-50/80 to-orange-50/80 border border-amber-200 rounded-2xl p-5 shadow-sm backdrop-blur-sm">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="p-2 bg-white rounded-xl border border-amber-200 shadow-sm">
                  <Icons.Lightbulb />
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">
                    {pendingSugs.length} stakeholder suggestion{pendingSugs.length === 1 ? "" : "s"} from Project Charter
                  </h3>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Review AI-generated stakeholders based on your project charter analysis
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  className="flex-1 sm:flex-none px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  disabled={busy}
                  onClick={() => document.getElementById("ai-suggestions-panel")?.scrollIntoView({ behavior: "smooth" })}
                >
                  Review
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    className="flex-1 sm:flex-none px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors shadow-sm"
                    disabled={busy}
                    onClick={acceptAllSuggestions}
                  >
                    {sugBusy ? "Accepting..." : "Accept All"}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {err && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3 text-red-800 animate-in slide-in-from-top-1">
            <Icons.AlertCircle />
            <span className="text-sm font-medium">{err}</span>
            <button onClick={() => setErr(null)} className="ml-auto p-1 hover:bg-red-100 rounded" type="button">
              <Icons.X />
            </button>
          </div>
        )}

        {/* Toolbar */}
        <div className="bg-white rounded-2xl border border-gray-200/60 p-4 shadow-sm flex flex-col lg:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-2 bg-gray-100/50 p-1 rounded-xl border border-gray-200/50 w-full lg:w-auto">
            <button
              onClick={() => setMode("table")}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === "table"
                  ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
              }`}
              type="button"
              disabled={busy}
            >
              <Icons.List />
              Table View
            </button>
            <button
              onClick={() => setMode("cards")}
              className={`flex-1 lg:flex-none flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                mode === "cards"
                  ? "bg-white text-gray-900 shadow-sm border border-gray-200"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-200/50"
              }`}
              type="button"
              disabled={busy}
            >
              <Icons.Grid />
              Card View
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-3 w-full lg:w-auto">
            <div className="relative w-full sm:w-72">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Icons.Search />
              </div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="block w-full pl-10 pr-3 py-2.5 bg-white border border-gray-300 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                placeholder="Search stakeholders..."
                disabled={busy}
              />
            </div>

            <div className="relative w-full sm:w-40">
              <select
                className="block w-full px-3 py-2.5 bg-white border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer"
                value={personFilter}
                onChange={(e) => setPersonFilter(e.target.value as any)}
                disabled={readOnly || busy}
              >
                <option value="all">All Types</option>
                <option value="internal">Internal Only</option>
                <option value="external">External Only</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                <Icons.ChevronDown />
              </div>
            </div>

            <div className="h-8 w-px bg-gray-200 hidden sm:block" />

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 hover:border-gray-400 transition-all disabled:opacity-50"
                type="button"
                onClick={loadFromDb}
                disabled={busy}
              >
                <Icons.Refresh />
                <span className="hidden sm:inline">{loading ? "Loading..." : "Refresh"}</span>
              </button>

              <button
                className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm ${
                  dirty ? "bg-blue-600 text-white hover:bg-blue-700 hover:shadow-md" : "bg-gray-100 text-gray-600 cursor-default"
                }`}
                onClick={saveNow}
                disabled={readOnly || saving || !dirty || busy}
                type="button"
              >
                <Icons.Save />
                {saving ? "Saving..." : dirty ? "Save Changes" : "Saved"}
              </button>

              {!readOnly && (
                <button
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-red-200 text-red-700 rounded-xl text-sm font-medium hover:bg-red-50 transition-all disabled:opacity-50"
                  disabled={busy || (doc.rows?.length ?? 0) === 0}
                  onClick={deleteAll}
                  type="button"
                >
                  <Icons.Trash />
                  <span className="hidden sm:inline">Clear All</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="bg-white rounded-2xl border border-gray-200/60 shadow-sm overflow-hidden">
          {mode === "cards" ? (
            <div className="p-6">
              {filtered.length === 0 ? (
                <div className="text-center py-16">
                  <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Icons.Grid />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">No stakeholders found</h3>
                  <p className="text-sm text-gray-500 mb-4">Get started by adding your first stakeholder</p>
                  <button
                    onClick={() => addRow()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    disabled={readOnly || busy}
                    type="button"
                  >
                    <Icons.Plus />
                    Add Stakeholder
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {filtered.map((s) => (
                    <div
                      key={s.id}
                      className="group relative bg-white rounded-xl border border-gray-200 p-5 hover:shadow-lg hover:border-blue-300 transition-all duration-200"
                    >
                      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
                        {!readOnly && (
                          <button
                            onClick={() => removeRow(s.id)}
                            disabled={busy || deletingId === s.id}
                            className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            type="button"
                          >
                            <Icons.Trash />
                          </button>
                        )}
                      </div>

                      <div className="flex items-start gap-3 mb-4">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-semibold text-sm shadow-sm">
                          {s.name ? s.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2) : "ST"}
                        </div>
                        <div className="flex-1 min-w-0 pr-8">
                          <h3 className="font-semibold text-gray-900 truncate" title={s.name}>
                            {s.name || "Unnamed stakeholder"}
                          </h3>
                          <p className="text-sm text-gray-500 truncate" title={s.title_role || s.role}>
                            {s.title_role || s.role || "—"}
                          </p>
                          <span className="inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                            {normalizeGroup(s.group ?? "")}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-2">
                          {(s.channels ?? []).length ? (
                            s.channels!.map((c) => (
                              <span
                                key={c}
                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${channelChipClass(
                                  c
                                )}`}
                              >
                                {c}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-gray-400 italic">No channels specified</span>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-100">
                          <div className="bg-gray-50 rounded-lg p-2.5">
                            <div className="text-xs text-gray-500 mb-1">Internal/External</div>
                            <div className="text-sm font-medium text-gray-900">{s.internal_external ?? "—"}</div>
                          </div>
                          <div className="bg-gray-50 rounded-lg p-2.5">
                            <div className="text-xs text-gray-500 mb-1">Mapping</div>
                            <div
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${pillClassMap(
                                s.stakeholder_mapping ?? ""
                              )}`}
                            >
                              {s.stakeholder_mapping ?? "—"}
                            </div>
                          </div>
                          <div className={`rounded-lg p-2.5 border-l-4 ${getImpactInfluenceCellClass(s.impact_level)}`}>
                            <div className="text-xs text-gray-500 mb-1">Impact</div>
                            <div
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${pillClassLevel(
                                s.impact_level ?? ""
                              )}`}
                            >
                              {s.impact_level ?? "—"}
                            </div>
                          </div>
                          <div className={`rounded-lg p-2.5 border-l-4 ${getImpactInfluenceCellClass(s.influence_level)}`}>
                            <div className="text-xs text-gray-500 mb-1">Influence</div>
                            <div
                              className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${pillClassLevel(
                                s.influence_level ?? ""
                              )}`}
                            >
                              {s.influence_level ?? "—"}
                            </div>
                          </div>
                        </div>

                        {s.point_of_contact && (
                          <div className="pt-3 border-t border-gray-100">
                            <div className="text-xs text-gray-500 mb-1">Point of Contact</div>
                            <div className="text-sm text-gray-900 flex items-center gap-2">
                              <Icons.Mail />
                              {s.point_of_contact}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {groups.length === 0 ? (
                <div className="text-center py-16 px-4">
                  <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Icons.List />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">No stakeholders yet</h3>
                  <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
                    Build your stakeholder register to track influence, impact, and communication strategies
                  </p>
                  <button
                    onClick={() => addRow()}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                    disabled={readOnly || busy}
                    type="button"
                  >
                    <Icons.Plus />
                    Add First Stakeholder
                  </button>
                </div>
              ) : (
                groups.map(([groupName, rows]) => {
                  const isCollapsed = !!collapsed[groupName];
                  return (
                    <div key={groupName} className="bg-white">
                      <div className="flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors group">
                        <button
                          type="button"
                          className="flex items-center gap-3 flex-1 text-left"
                          onClick={() => setCollapsed((c) => ({ ...c, [groupName]: !c[groupName] }))}
                          disabled={busy}
                        >
                          <span className={`transform transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}>
                            <Icons.ChevronRight />
                          </span>
                          <h3 className="font-semibold text-gray-900">{groupName}</h3>
                          <span className="px-2.5 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs font-medium border border-gray-200">
                            {rows.length}
                          </span>
                        </button>

                        {!readOnly && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                            onClick={() => addRow(groupName)}
                            disabled={busy}
                          >
                            <Icons.Plus />
                            Add to group
                          </button>
                        )}
                      </div>

                      {!isCollapsed && (
                        <div
                          className="overflow-x-auto border-t border-gray-100"
                          style={{ cursor: resizingCol ? "col-resize" : "default" }}
                        >
                          <table ref={tableRef} className="w-full border-collapse">
                            <thead>
                              <tr>
                                <ResizableHeader colKey="name">Stakeholder</ResizableHeader>
                                <ResizableHeader colKey="point_of_contact">Contact Details</ResizableHeader>
                                <ResizableHeader colKey="role">Role</ResizableHeader>
                                <ResizableHeader colKey="internal_external">Type</ResizableHeader>
                                <ResizableHeader colKey="title_role">Title/Role</ResizableHeader>
                                <ResizableHeader colKey="impact_level">Impact</ResizableHeader>
                                <ResizableHeader colKey="influence_level">Influence</ResizableHeader>
                                <ResizableHeader colKey="stakeholder_mapping">Mapping</ResizableHeader>
                                <ResizableHeader colKey="involvement_milestone">Milestone</ResizableHeader>
                                <ResizableHeader colKey="stakeholder_impact">Impact Notes</ResizableHeader>
                                <ResizableHeader colKey="channels">Channels</ResizableHeader>
                                {!readOnly && <ResizableHeader colKey="actions">Actions</ResizableHeader>}
                              </tr>
                            </thead>

                            <tbody className="divide-y divide-gray-100">
                              {rows.map((r, idx) => {
                                const isExpanded = expandedRows.has(r.id);
                                return (
                                  <React.Fragment key={r.id}>
                                    <tr
                                      className={`group hover:bg-blue-50/30 transition-colors ${
                                        idx % 2 === 0 ? "bg-white" : "bg-gray-50/30"
                                      }`}
                                    >
                                      {/* Name */}
                                      <td
                                        className="px-4 py-3 align-top"
                                        style={{ width: colWidths.name, minWidth: colWidths.name }}
                                      >
                                        <input
                                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                          value={r.name ?? ""}
                                          onChange={(e) => updateRow(r.id, { name: e.target.value })}
                                          readOnly={readOnly}
                                          placeholder="Enter name..."
                                          disabled={busy}
                                          title={r.name}
                                        />
                                      </td>

                                      {/* Contact */}
                                      <td
                                        className="px-4 py-3 align-top"
                                        style={{ width: colWidths.point_of_contact, minWidth: colWidths.point_of_contact }}
                                      >
                                        <div className="relative">
                                          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                            <Icons.Mail />
                                          </div>
                                          <input
                                            className="w-full pl-10 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                            value={r.point_of_contact ?? ""}
                                            onChange={(e) => updateRow(r.id, { point_of_contact: e.target.value })}
                                            readOnly={readOnly}
                                            placeholder="Email / Phone / Contact..."
                                            disabled={busy}
                                            title={r.point_of_contact}
                                          />
                                        </div>
                                      </td>

                                      {/* Role */}
                                      <td className="px-4 py-3 align-top" style={{ width: colWidths.role, minWidth: colWidths.role }}>
                                        <input
                                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                          value={r.role ?? ""}
                                          onChange={(e) => updateRow(r.id, { role: e.target.value })}
                                          readOnly={readOnly}
                                          placeholder="Role..."
                                          disabled={busy}
                                          title={r.role}
                                        />
                                      </td>

                                      {/* Type */}
                                      <td
                                        className="px-4 py-3 align-top"
                                        style={{ width: colWidths.internal_external, minWidth: colWidths.internal_external }}
                                      >
                                        <select
                                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all cursor-pointer"
                                          value={r.internal_external ?? "Internal"}
                                          onChange={(e) => updateRow(r.id, { internal_external: e.target.value as InternalExternal })}
                                          disabled={readOnly || busy}
                                        >
                                          <option value="Internal">Internal</option>
                                          <option value="External">External</option>
                                        </select>
                                      </td>

                                      {/* Title/Role */}
                                      <td
                                        className="px-4 py-3 align-top"
                                        style={{ width: colWidths.title_role, minWidth: colWidths.title_role }}
                                      >
                                        <input
                                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                          value={r.title_role ?? ""}
                                          onChange={(e) => updateRow(r.id, { title_role: e.target.value })}
                                          readOnly={readOnly}
                                          placeholder="Title..."
                                          disabled={busy}
                                          title={r.title_role}
                                        />
                                      </td>

                                      {/* Impact */}
                                      <td
                                        className={`px-4 py-3 align-top transition-colors ${getImpactInfluenceCellClass(r.impact_level)}`}
                                        style={{ width: colWidths.impact_level, minWidth: colWidths.impact_level }}
                                      >
                                        <select
                                          className={`w-full px-3 py-2 border rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-offset-0 transition-all cursor-pointer shadow-sm ${pillClassLevel(
                                            r.impact_level ?? ""
                                          )}`}
                                          value={r.impact_level ?? "Medium"}
                                          onChange={(e) => updateRow(r.id, { impact_level: e.target.value as Impact })}
                                          disabled={readOnly || busy}
                                        >
                                          <option value="High">HIGH</option>
                                          <option value="Medium">MEDIUM</option>
                                          <option value="Low">LOW</option>
                                        </select>
                                      </td>

                                      {/* Influence */}
                                      <td
                                        className={`px-4 py-3 align-top transition-colors ${getImpactInfluenceCellClass(r.influence_level)}`}
                                        style={{ width: colWidths.influence_level, minWidth: colWidths.influence_level }}
                                      >
                                        <select
                                          className={`w-full px-3 py-2 border rounded-lg text-sm font-bold focus:outline-none focus:ring-2 focus:ring-offset-0 transition-all cursor-pointer shadow-sm ${pillClassLevel(
                                            r.influence_level ?? ""
                                          )}`}
                                          value={r.influence_level ?? "Medium"}
                                          onChange={(e) => updateRow(r.id, { influence_level: e.target.value as Influence })}
                                          disabled={readOnly || busy}
                                        >
                                          <option value="High">HIGH</option>
                                          <option value="Medium">MEDIUM</option>
                                          <option value="Low">LOW</option>
                                        </select>
                                      </td>

                                      {/* Mapping */}
                                      <td
                                        className="px-4 py-3 align-top"
                                        style={{ width: colWidths.stakeholder_mapping, minWidth: colWidths.stakeholder_mapping }}
                                      >
                                        <select
                                          className={`w-full px-3 py-2 border rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-0 transition-all cursor-pointer ${pillClassMap(
                                            r.stakeholder_mapping ?? ""
                                          )}`}
                                          value={r.stakeholder_mapping ?? "Keep Informed"}
                                          onChange={(e) => updateRow(r.id, { stakeholder_mapping: e.target.value as Mapping })}
                                          disabled={readOnly || busy}
                                        >
                                          <option value="Manage Closely">Manage Closely</option>
                                          <option value="Keep Satisfied">Keep Satisfied</option>
                                          <option value="Keep Informed">Keep Informed</option>
                                          <option value="Monitor">Monitor</option>
                                        </select>
                                      </td>

                                      {/* Milestone */}
                                      <td
                                        className="px-4 py-3 align-top"
                                        style={{ width: colWidths.involvement_milestone, minWidth: colWidths.involvement_milestone }}
                                      >
                                        <input
                                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                          value={r.involvement_milestone ?? ""}
                                          onChange={(e) => updateRow(r.id, { involvement_milestone: e.target.value })}
                                          readOnly={readOnly}
                                          placeholder="Milestone..."
                                          disabled={busy}
                                          title={r.involvement_milestone}
                                        />
                                      </td>

                                      {/* Impact Notes */}
                                      <td
                                        className="px-4 py-3 align-top"
                                        style={{ width: colWidths.stakeholder_impact, minWidth: colWidths.stakeholder_impact }}
                                      >
                                        <div className="relative">
                                          <textarea
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all resize-none"
                                            value={r.stakeholder_impact ?? ""}
                                            onChange={(e) => updateRow(r.id, { stakeholder_impact: e.target.value })}
                                            readOnly={readOnly}
                                            placeholder="Impact notes..."
                                            disabled={busy}
                                            rows={isExpanded ? 3 : 1}
                                            style={{ minHeight: isExpanded ? "60px" : "36px" }}
                                          />
                                          {r.stakeholder_impact && r.stakeholder_impact.length > 30 && (
                                            <button
                                              onClick={() => toggleRowExpand(r.id)}
                                              className="absolute right-1 bottom-1 p-1 text-gray-400 hover:text-blue-600 bg-white rounded"
                                              title={isExpanded ? "Collapse" : "Expand"}
                                              type="button"
                                              disabled={busy}
                                            >
                                              <Icons.Expand />
                                            </button>
                                          )}
                                        </div>
                                      </td>

                                      {/* Channels */}
                                      <td
                                        className="px-4 py-3 align-top"
                                        style={{ width: colWidths.channels, minWidth: colWidths.channels }}
                                      >
                                        <MultiSelectPopover
                                          value={Array.isArray(r.channels) ? r.channels : []}
                                          options={channelOptions}
                                          onChange={(next) =>
                                            updateRow(r.id, {
                                              channels: Array.isArray(next) ? next.map((x) => normalizeChannel(x)).filter(Boolean) : [],
                                            })
                                          }
                                          disabled={readOnly || busy}
                                          placeholder="Select channels..."
                                          widthClassName="w-full"
                                          maxChips={isExpanded ? 5 : 2}
                                        />
                                      </td>

                                      {/* Actions */}
                                      {!readOnly && (
                                        <td
                                          className="px-4 py-3 text-right align-top"
                                          style={{ width: colWidths.actions, minWidth: colWidths.actions }}
                                        >
                                          <button
                                            type="button"
                                            className="inline-flex items-center justify-center p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100 focus:opacity-100"
                                            onClick={() => removeRow(r.id)}
                                            disabled={busy || deletingId === r.id}
                                            title="Delete stakeholder"
                                          >
                                            {deletingId === r.id ? (
                                              <span className="w-4 h-4 border-2 border-red-200 border-t-red-600 rounded-full animate-spin" />
                                            ) : (
                                              <Icons.Trash />
                                            )}
                                          </button>
                                        </td>
                                      )}
                                    </tr>
                                  </React.Fragment>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between text-sm text-gray-500 px-2">
          <div className="flex items-center gap-4">
            <span>{readOnly ? "🔒 Read-only mode" : dirty ? "⚡ Unsaved changes" : "✓ All changes saved"}</span>
            <span className="hidden sm:inline text-gray-300">|</span>
            <span className="hidden sm:inline opacity-75">Tip: Drag column borders to resize</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Auto-sync enabled</span>
          </div>
        </div>
      </div>
    </div>
  );
}
