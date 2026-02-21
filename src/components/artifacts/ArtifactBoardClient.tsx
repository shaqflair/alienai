// src/components/artifacts/ArtifactBoardClient.tsx
"use client";

import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  Trash2,
  Sparkles,
  Calendar,
  AlertCircle,
  X,
  Search,
  Copy,
  Zap,
  Shield,
  Clock,
  ArrowUpRight,
  Layers,
  BarChart3,
  Target,
  Flag,
  GitBranch,
  FileCheck,
  ChevronDown,
  Filter,
} from "lucide-react";

import {
  cloneArtifact as cloneArtifactAction,
  deleteDraftArtifact as deleteDraftArtifactAction,
  setArtifactCurrent as setArtifactCurrentAction,
} from "@/app/projects/[id]/artifacts/actions";

/* =========================================================
   Types
========================================================= */

export type UiStatus = "Draft" | "In review" | "Approved" | "Blocked";
export type Phase =
  | "Initiating"
  | "Planning"
  | "Executing"
  | "Monitoring & Controlling"
  | "Closing";

export type ArtifactBoardRow = {
  id: string;
  artifactType: string;
  title: string;
  ownerEmail: string;
  ownerName?: string;
  ownerInitials?: string;
  progress: number;
  status: UiStatus;
  phase: Phase;
  isBaseline?: boolean;
  canClone?: boolean;
  canDeleteDraft?: boolean;
  approvalStatus?: string;
  isLocked?: boolean;
  deletedAt?: string | null;
  isCurrent?: boolean;
  typeKey?: string;
  currentLabel?: string;
  __idx?: number;
};

/* =========================================================
   Utilities
========================================================= */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function clampPct(n: any, fallback = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function fmtUkDateOnly(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

function initialsFromEmail(email: string) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return "—";
  const local = e.split("@")[0] || e;
  const parts = local.split(/[.\-_+]/g).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0]?.[0] ?? "";
    const b = parts[parts.length - 1]?.[0] ?? "";
    return (a + b).toUpperCase() || local.slice(0, 2).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

function normalizeArtifactLink(href: string) {
  const raw = safeStr(href).trim();
  if (!raw) return "";
  return raw
    .replace(/\/RAID(\/|$)/g, "/raid$1")
    .replace(/\/WBS(\/|$)/g, "/wbs$1")
    .replace(/\/SCHEDULE(\/|$)/g, "/schedule$1")
    .replace(/\/CHANGE(\/|$)/g, "/change$1")
    .replace(/\/CHANGE_REQUESTS(\/|$)/g, "/change$1")
    .replace(/\/ARTIFACTS(\/|$)/g, "/artifacts$1");
}

function booly(v: any) {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  const s = safeLower(v);
  return ["true", "t", "yes", "y", "1"].includes(s);
}

function extractProjectRefFromHref(href: string): string | null {
  const h = safeStr(href).trim();
  const m = h.match(/\/projects\/([^\/?#]+)/i);
  return m?.[1] ? String(m[1]) : null;
}

function aiItemHref(args: { item: any; fallbackProjectRef: string }): string {
  const { item, fallbackProjectRef } = args;
  const rawLink = safeStr(item?.href || item?.link || "").trim();
  const normalized = rawLink ? normalizeArtifactLink(rawLink) : "";

  if (normalized.startsWith("/projects/")) {
    const m = normalized.match(/\/projects\/[^\/]+\/artifacts\/([^\/?#]+)/i);
    if (m?.[1] && !looksLikeUuid(String(m[1]))) {
      return `/projects/${fallbackProjectRef}`;
    }
    return normalized;
  }

  const refFromLink = normalized ? extractProjectRefFromHref(normalized) : null;
  const projRef = refFromLink || fallbackProjectRef;
  const kind = safeLower(item?.kind || item?.source || item?.type || item?.itemType || "");
  const artifactId = safeStr(item?.artifact_id || item?.artifactId || "").trim();
  if (artifactId && looksLikeUuid(artifactId)) return `/projects/${projRef}/artifacts/${artifactId}`;
  if (kind.includes("milestone") || kind.includes("schedule")) return `/projects/${projRef}/schedule`;
  if (kind.includes("wbs") || kind.includes("work_item") || kind.includes("work item")) return `/projects/${projRef}/wbs`;
  if (kind.includes("raid") || kind.includes("risk") || kind.includes("issue") || kind.includes("dependency"))
    return `/projects/${projRef}/raid`;
  if (kind.includes("change")) return `/projects/${projRef}/change`;
  return `/projects/${projRef}`;
}

/* =========================================================
   Type Mapping
========================================================= */

function canonType(x: any): string {
  const raw = safeLower(x);
  if (!raw) return "";
  const t = raw.replace(/\s+/g, " ").replace(/[\/]+/g, " / ").replace(/[_-]+/g, "_").trim();

  if (["weekly_report", "weekly report", "weekly_status", "weekly status", "weekly_update", "weekly update", "delivery_report", "delivery report", "status_report", "status report"].includes(t))
    return "WEEKLY_REPORT";
  if (t === "status_dashboard" || t === "status dashboard") return "PROJECT_CLOSURE_REPORT";
  if (t.includes("charter") || t === "pid") return "PROJECT_CHARTER";
  if (t.includes("stakeholder")) return "STAKEHOLDER_REGISTER";
  if (t === "wbs" || t.includes("work breakdown")) return "WBS";
  if (t.includes("schedule") || t.includes("roadmap") || t.includes("gantt")) return "SCHEDULE";
  if (t.includes("change")) return "CHANGE_REQUESTS";
  if (t.includes("raid")) return "RAID";
  if (t.includes("lessons") || t.includes("retro")) return "LESSONS_LEARNED";
  if (t.includes("closure") || t.includes("closeout")) return "PROJECT_CLOSURE_REPORT";
  return t.toUpperCase().replace(/\s+/g, "_");
}

function phaseForCanonType(typeKey: string): Phase {
  switch (typeKey) {
    case "PROJECT_CHARTER": return "Initiating";
    case "STAKEHOLDER_REGISTER": case "WBS": case "SCHEDULE": return "Planning";
    case "WEEKLY_REPORT": return "Executing";
    case "RAID": case "CHANGE_REQUESTS": return "Monitoring & Controlling";
    case "LESSONS_LEARNED": case "PROJECT_CLOSURE_REPORT": return "Closing";
    default: return "Planning";
  }
}

function statusForArtifactLike(a: any): UiStatus {
  const approval = safeLower(a?.approval_status);
  if (approval === "approved" || a?.is_baseline) return "Approved";
  if (["submitted", "review", "in_review"].includes(approval)) return "In review";
  if (a?.is_locked) return "In review";
  if (approval === "rejected") return "Blocked";
  return "Draft";
}

function progressForArtifactLike(a: any): number {
  const approval = safeLower(a?.approval_status);
  if (a?.is_baseline) return 100;
  if (approval === "approved") return 95;
  if (["submitted", "review", "in_review"].includes(approval)) return 70;
  if (approval === "changes_requested") return 45;
  if (approval === "rejected") return 0;
  if (a?.is_locked) return 70;
  return 20;
}

function applyCurrentFallback(rows: ArtifactBoardRow[]) {
  if (!rows.length) return rows;
  const hasAnyCurrent = rows.some((r) => booly(r.isCurrent));
  if (hasAnyCurrent) return rows.map((r) => ({ ...r, isCurrent: booly(r.isCurrent) }));
  const seenType = new Set<string>();
  return rows.map((r) => {
    const tk = safeStr(r.typeKey || canonType(r.artifactType)).trim() || safeStr(r.artifactType).trim();
    const key = tk || r.id;
    const mark = !seenType.has(key);
    if (mark) seenType.add(key);
    return { ...r, typeKey: tk, isCurrent: mark };
  });
}

/* =========================================================
   Phase & Status Config
========================================================= */

const PHASE_CONFIG: Record<Phase, {
  icon: React.ElementType;
  color: string;
  bg: string;
  label: string;
  order: number;
}> = {
  Initiating: { icon: Target, color: "#D97706", bg: "#FFFBEB", label: "Initiate", order: 0 },
  Planning: { icon: GitBranch, color: "#2563EB", bg: "#EFF6FF", label: "Plan", order: 1 },
  Executing: { icon: Zap, color: "#7C3AED", bg: "#F5F3FF", label: "Execute", order: 2 },
  "Monitoring & Controlling": { icon: BarChart3, color: "#0891B2", bg: "#ECFEFF", label: "Monitor", order: 3 },
  Closing: { icon: Flag, color: "#059669", bg: "#ECFDF5", label: "Close", order: 4 },
};

const STATUS_STYLES: Record<UiStatus, { color: string; bg: string; dot: string }> = {
  Draft: { color: "#6B7280", bg: "#F3F4F6", dot: "#9CA3AF" },
  "In review": { color: "#2563EB", bg: "#EFF6FF", dot: "#3B82F6" },
  Approved: { color: "#059669", bg: "#ECFDF5", dot: "#10B981" },
  Blocked: { color: "#DC2626", bg: "#FEF2F2", dot: "#EF4444" },
};

/* =========================================================
   Notion-style Spreadsheet Components
========================================================= */

/** Thin progress bar (Notion-style, no arc) */
function ProgressBar({ value, color }: { value: number; color: string }) {
  const v = clampPct(value);
  return (
    <div className="flex items-center gap-2.5 w-full">
      <div className="flex-1 h-[5px] rounded-full overflow-hidden" style={{ background: "#F1F5F9" }}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${v}%`,
            background: color,
            transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </div>
      <span className="text-[12px] tabular-nums font-medium" style={{ color: "#94A3B8", minWidth: 30, textAlign: "right" }}>
        {v}%
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: UiStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[12px] font-medium"
      style={{ color: s.color, background: s.bg }}
    >
      <span className="w-[6px] h-[6px] rounded-full" style={{ background: s.dot }} />
      {status}
    </span>
  );
}

function PhaseBadge({ phase }: { phase: Phase }) {
  const cfg = PHASE_CONFIG[phase];
  const Icon = cfg.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[12px] font-medium"
      style={{ color: cfg.color, background: cfg.bg }}
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function AvatarChip({ email, name }: { email: string; name?: string }) {
  const initials = initialsFromEmail(email);
  const displayName = name || email.split("@")[0] || "Unassigned";
  const hue = email ? email.split("").reduce((a, c) => a + c.charCodeAt(0), 0) % 360 : 220;

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
        style={{
          background: `hsl(${hue}, 55%, 92%)`,
          color: `hsl(${hue}, 60%, 35%)`,
        }}
      >
        {initials}
      </div>
      <span className="text-[13px] text-[#374151] truncate">{displayName}</span>
    </div>
  );
}

function TagPill({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[10px] font-semibold uppercase tracking-wide"
      style={{ color, background: bg }}
    >
      {children}
    </span>
  );
}

/* =========================================================
   Table Row
========================================================= */

const COL_TEMPLATE = "minmax(260px, 2fr) 180px 140px 130px 120px 100px";

function ArtifactTableRow({
  row,
  projectUuid,
  onOpen,
  onMakeCurrent,
  makingCurrentId,
  onClone,
  cloningId,
  onDelete,
  deletingId,
}: {
  row: ArtifactBoardRow;
  projectUuid: string;
  onOpen: (id: string) => void;
  onMakeCurrent: (id: string) => void;
  makingCurrentId: string;
  onClone: (id: string) => void;
  cloningId: string;
  onDelete: (id: string) => void;
  deletingId: string;
}) {
  const isCurrent = booly(row.isCurrent);
  const isMaking = makingCurrentId === row.id;
  const isCloning = cloningId === row.id;
  const isDeleting = deletingId === row.id;
  const canDelete =
    row.canDeleteDraft !== false &&
    row.status === "Draft" &&
    !row.isBaseline &&
    !row.isLocked &&
    !row.deletedAt;
  const phaseCfg = PHASE_CONFIG[row.phase];

  return (
    <div
      onClick={() => onOpen(row.id)}
      className="notion-row group relative grid items-center cursor-pointer"
      style={{
        gridTemplateColumns: COL_TEMPLATE,
        borderBottom: "1px solid #F1F5F9",
        minHeight: 44,
      }}
    >
      {/* Name cell */}
      <div className="flex items-center gap-2 px-3 py-2.5 min-w-0 h-full" style={{ borderRight: "1px solid #F8FAFC" }}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[13px] font-medium text-[#111827] truncate">{row.title || row.artifactType}</span>
            {isCurrent && (
              <TagPill color="#059669" bg="#ECFDF5">
                <CheckCircle2 className="h-2.5 w-2.5" /> live
              </TagPill>
            )}
            {row.isBaseline && (
              <TagPill color="#6B7280" bg="#F3F4F6">
                <Shield className="h-2.5 w-2.5" /> baseline
              </TagPill>
            )}
          </div>
          <span className="text-[11px] text-[#9CA3AF] truncate block">{row.artifactType}</span>
        </div>
      </div>

      {/* Owner cell */}
      <div className="px-3 py-2.5 h-full flex items-center" style={{ borderRight: "1px solid #F8FAFC" }}>
        <AvatarChip email={row.ownerEmail} name={row.ownerName} />
      </div>

      {/* Phase cell */}
      <div className="px-3 py-2.5 h-full flex items-center" style={{ borderRight: "1px solid #F8FAFC" }}>
        <PhaseBadge phase={row.phase} />
      </div>

      {/* Status cell */}
      <div className="px-3 py-2.5 h-full flex items-center" style={{ borderRight: "1px solid #F8FAFC" }}>
        <StatusBadge status={row.status} />
      </div>

      {/* Progress cell */}
      <div className="px-3 py-2.5 h-full flex items-center" style={{ borderRight: "1px solid #F8FAFC" }}>
        <ProgressBar value={row.progress} color={phaseCfg.color} />
      </div>

      {/* Actions cell */}
      <div className="px-2 py-2.5 h-full flex items-center justify-end gap-0.5">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isCurrent && (
            <button
              onClick={(e) => { e.stopPropagation(); onMakeCurrent(row.id); }}
              disabled={isMaking || !projectUuid || !looksLikeUuid(projectUuid)}
              className="p-1 rounded hover:bg-emerald-50 transition-colors disabled:opacity-30"
              style={{ color: "#059669" }}
              title="Set as current"
            >
              {isMaking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onClone(row.id); }}
            disabled={isCloning || !projectUuid || !looksLikeUuid(projectUuid)}
            className="p-1 rounded hover:bg-blue-50 transition-colors disabled:opacity-30"
            style={{ color: "#2563EB" }}
            title="Clone"
          >
            {isCloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(row.id); }}
              disabled={isDeleting || !projectUuid || !looksLikeUuid(projectUuid)}
              className="p-1 rounded hover:bg-red-50 transition-colors disabled:opacity-30"
              style={{ color: "#DC2626" }}
              title="Delete draft"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(row.id); }}
            className="p-1 rounded hover:bg-gray-100 transition-colors"
            style={{ color: "#6B7280" }}
            title="Open"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Search / Filter Bar (inline, Notion-style)
========================================================= */

function InlineFilterBar({
  search,
  setSearch,
  statusSet,
  toggleStatus,
  phaseSet,
  togglePhase,
  clearAll,
  activeCount,
}: {
  search: string;
  setSearch: (v: string) => void;
  statusSet: Set<UiStatus>;
  toggleStatus: (s: UiStatus) => void;
  phaseSet: Set<Phase>;
  togglePhase: (p: Phase) => void;
  clearAll: () => void;
  activeCount: number;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K to focus
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="mb-1">
      {/* Search row */}
      <div className="flex items-center gap-2 px-1 py-2">
        <div
          className="flex items-center gap-2 flex-1 px-3 py-[7px] rounded-lg border transition-colors"
          style={{ borderColor: "#E5E7EB", background: "#FAFAFA" }}
        >
          <Search className="h-4 w-4 text-[#9CA3AF] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (search) {
                  setSearch("");
                } else {
                  (e.target as HTMLInputElement).blur();
                }
              }
            }}
            placeholder="Filter artifacts..."
            className="flex-1 bg-transparent text-[13px] outline-none text-[#111827] placeholder:text-[#9CA3AF]"
          />
          {search && (
            <button onClick={() => setSearch("")} className="p-0.5 rounded hover:bg-gray-200 transition-colors">
              <X className="h-3 w-3 text-[#6B7280]" />
            </button>
          )}
          <kbd className="hidden sm:inline text-[10px] text-[#9CA3AF] border border-[#E5E7EB] rounded px-1.5 py-0.5 bg-white font-mono">
            ⌘K
          </kbd>
        </div>

        <button
          onClick={() => setShowFilters((v) => !v)}
          className="flex items-center gap-1.5 px-3 py-[7px] rounded-lg border text-[13px] font-medium transition-colors"
          style={{
            borderColor: activeCount > 0 ? "#BFDBFE" : "#E5E7EB",
            background: activeCount > 0 ? "#EFF6FF" : "#FAFAFA",
            color: activeCount > 0 ? "#2563EB" : "#6B7280",
          }}
        >
          <Filter className="h-3.5 w-3.5" />
          Filter
          {activeCount > 0 && (
            <span className="text-[11px] font-semibold bg-blue-600 text-white rounded-full w-4 h-4 flex items-center justify-center">
              {activeCount}
            </span>
          )}
          <ChevronDown className={`h-3 w-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Filter pills */}
      {showFilters && (
        <div className="px-1 pb-3 flex flex-wrap items-center gap-4 animate-[notionFadeIn_0.15s_ease-out]">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wider">Status</span>
            {(["Draft", "In review", "Approved", "Blocked"] as UiStatus[]).map((status) => {
              const active = statusSet.has(status);
              const s = STATUS_STYLES[status];
              return (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className="px-2 py-1 rounded-md text-[12px] font-medium transition-all"
                  style={{
                    background: active ? s.bg : "transparent",
                    color: active ? s.color : "#9CA3AF",
                    border: `1px solid ${active ? s.bg : "#E5E7EB"}`,
                  }}
                >
                  {status}
                </button>
              );
            })}
          </div>

          <div className="w-px h-5 bg-[#E5E7EB]" />

          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wider">Phase</span>
            {(["Initiating", "Planning", "Executing", "Monitoring & Controlling", "Closing"] as Phase[]).map((phase) => {
              const active = phaseSet.has(phase);
              const cfg = PHASE_CONFIG[phase];
              return (
                <button
                  key={phase}
                  onClick={() => togglePhase(phase)}
                  className="px-2 py-1 rounded-md text-[12px] font-medium transition-all"
                  style={{
                    background: active ? cfg.bg : "transparent",
                    color: active ? cfg.color : "#9CA3AF",
                    border: `1px solid ${active ? cfg.bg : "#E5E7EB"}`,
                  }}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {activeCount > 0 && (
            <>
              <div className="w-px h-5 bg-[#E5E7EB]" />
              <button
                onClick={clearAll}
                className="text-[12px] font-medium text-[#9CA3AF] hover:text-[#6B7280] transition-colors"
              >
                Clear all
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Stats Row (compact, Notion-style)
========================================================= */

function StatsRow({ rows }: { rows: ArtifactBoardRow[] }) {
  const stats = useMemo(() => {
    const total = rows.length;
    const approved = rows.filter((r) => r.status === "Approved").length;
    const inReview = rows.filter((r) => r.status === "In review").length;
    const blocked = rows.filter((r) => r.status === "Blocked").length;
    const avgProgress = total ? Math.round(rows.reduce((s, r) => s + r.progress, 0) / total) : 0;
    return { total, approved, inReview, blocked, avgProgress };
  }, [rows]);

  return (
    <div className="flex items-center gap-5 text-[12px] text-[#9CA3AF]">
      <span><b className="text-[#374151] font-semibold">{stats.total}</b> total</span>
      <span><b className="text-emerald-600 font-semibold">{stats.approved}</b> approved</span>
      <span><b className="text-blue-600 font-semibold">{stats.inReview}</b> in review</span>
      {stats.blocked > 0 && <span><b className="text-red-600 font-semibold">{stats.blocked}</b> blocked</span>}
      <span><b className="text-violet-600 font-semibold">{stats.avgProgress}%</b> avg progress</span>
    </div>
  );
}

/* =========================================================
   AI Panel (preserved, restyled)
========================================================= */

function daysUntil(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function AiPanel({
  open,
  onClose,
  projectUuid,
  projectCode,
  projectName,
  projectHumanId,
}: {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
  projectCode: string;
  projectName: string;
  projectHumanId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) { setLoading(false); setResult(null); setError(""); }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  async function runCheck() {
    if (!projectUuid || !looksLikeUuid(projectUuid)) { setError("Invalid project UUID"); return; }
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/ai/events", {
        method: "POST", credentials: "include",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ eventType: "artifact_due", windowDays: 14, project_id: projectUuid, project_human_id: projectCode }),
      });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch {}
      if (!res.ok) { throw new Error(data?.error || data?.message || `Request failed (${res.status})`); }
      setResult(data);
    } catch (e: any) {
      setError(e?.message || "AI request failed");
      setResult((prev: any) => prev ?? { ai: { dueSoon: [] } });
    } finally { setLoading(false); }
  }

  if (!open) return null;
  const items = result?.ai?.dueSoon || [];
  const projectRef = projectHumanId || projectCode || projectUuid;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-[notionFadeIn_0.12s_ease-out]" onClick={onClose} />
      <div
        className="relative w-full max-w-md max-h-[70vh] rounded-xl overflow-hidden flex flex-col bg-white animate-[notionSlideUp_0.2s_ease-out]"
        style={{ border: "1px solid #E5E7EB", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.15)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#F1F5F9]">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-violet-100 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            </div>
            <div>
              <span className="text-[13px] font-semibold text-[#111827]">AI Assistant</span>
              <span className="text-[11px] text-[#9CA3AF] ml-2">{projectCode || projectHumanId || "—"}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-gray-100" aria-label="Close">
            <X className="h-4 w-4 text-[#6B7280]" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {error ? (
            <div className="p-3 rounded-lg bg-red-50 text-[13px] text-red-700 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-[1px] shrink-0" />
              <div>
                <div className="font-medium">Scan failed</div>
                <div className="text-[12px] opacity-80">{error}</div>
                <button onClick={runCheck} disabled={loading} className="mt-2 px-3 py-1 rounded-md text-[12px] font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                  {loading ? "Retrying..." : "Retry"}
                </button>
              </div>
            </div>
          ) : !result ? (
            <div className="text-center py-10">
              <Clock className="h-8 w-8 mx-auto mb-3 text-violet-400" />
              <p className="text-[13px] text-[#6B7280] mb-4">Check what&apos;s due in the next 14 days</p>
              <button
                onClick={runCheck} disabled={loading}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning...</span>
                ) : "Scan Due Dates"}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10">
              <FileCheck className="h-8 w-8 mx-auto mb-3 text-emerald-400" />
              <p className="text-[13px] text-[#6B7280]">Nothing due in the next 14 days</p>
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item: any, idx: number) => {
                const days = daysUntil(item.dueDate);
                const isOverdue = days !== null && days < 0;
                const href = aiItemHref({ item, fallbackProjectRef: projectRef });
                return (
                  <div key={idx} className="p-3 rounded-lg border border-[#F1F5F9] hover:border-[#E5E7EB] transition-colors">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] bg-[#F9FAFB] px-1.5 py-0.5 rounded">
                        {item.itemType || "Item"}
                      </span>
                      {days !== null && (
                        <span className="text-[11px] font-semibold tabular-nums" style={{ color: isOverdue ? "#DC2626" : "#D97706" }}>
                          {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d`}
                        </span>
                      )}
                    </div>
                    <h4 className="text-[13px] font-medium text-[#111827] mb-1">{item.title}</h4>
                    <div className="flex items-center gap-1.5 text-[11px] text-[#9CA3AF] mb-2.5">
                      <Calendar className="h-3 w-3" /> {fmtUkDateOnly(item.dueDate)}
                    </div>
                    <div className="flex gap-2">
                      <Link href={href} className="flex-1 px-3 py-1.5 rounded-md text-center text-[11px] font-medium bg-[#F9FAFB] border border-[#E5E7EB] text-[#374151] hover:bg-[#F3F4F6] transition-colors">
                        Open
                      </Link>
                      <button
                        onClick={() => navigator.clipboard.writeText(`Reminder: ${item.title} due ${fmtUkDateOnly(item.dueDate)}`)}
                        className="px-3 py-1.5 rounded-md text-[11px] font-medium text-white bg-violet-600 hover:bg-violet-700 transition-colors"
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-4 py-2.5 border-t border-[#F1F5F9]">
          <button onClick={runCheck} disabled={loading} className="w-full py-1.5 rounded-lg text-[12px] font-medium text-[#6B7280] bg-[#F9FAFB] border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors disabled:opacity-50">
            {loading ? "Scanning..." : "Rescan"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Main Board
========================================================= */

export default function ArtifactBoardClient(props: {
  projectHumanId: string;
  projectUuid?: string;
  projectCode?: string | null;
  projectName?: string | null;
  rows?: ArtifactBoardRow[];
  projectId?: string;
  artifacts?: any[];
}) {
  const router = useRouter();

  const projectHumanId = safeStr(props.projectHumanId).trim();
  const projectUuid = safeStr(props.projectUuid || props.projectId).trim();
  const projectName = safeStr(props.projectName).trim();
  const projectCode = useMemo(() => {
    const c = safeStr(props.projectCode).trim();
    return looksLikeUuid(c) ? "" : c;
  }, [props.projectCode]);

  const baseRows = useMemo(() => {
    const incoming = Array.isArray(props.rows) ? props.rows : [];
    const arts = Array.isArray(props.artifacts) ? props.artifacts : [];

    if (incoming.length) {
      return applyCurrentFallback(incoming.map((r, i) => ({ ...r, __idx: i })));
    }
    if (!arts.length) return [];

    return applyCurrentFallback(
      arts
        .map(
          (a, i) =>
            ({
              id: safeStr(a?.id),
              artifactType: canonType(a?.type) || safeStr(a?.type) || "Artifact",
              title: safeStr(a?.title) || "Untitled",
              ownerEmail: safeStr(a?.ownerEmail ?? a?.owner_email ?? ""),
              ownerName: safeStr(a?.ownerName ?? a?.owner_name ?? ""),
              progress: progressForArtifactLike(a),
              status: statusForArtifactLike(a),
              phase: phaseForCanonType(canonType(a?.type)),
              isBaseline: !!a?.is_baseline,
              isCurrent: booly(a?.is_current ?? a?.isCurrent),
              typeKey: canonType(a?.type),
              __idx: i,
            }) as ArtifactBoardRow
        )
        .filter((r) => r.id)
    );
  }, [props.rows, props.artifacts]);

  const [aiOpen, setAiOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusSet, setStatusSet] = useState<Set<UiStatus>>(new Set());
  const [phaseSet, setPhaseSet] = useState<Set<Phase>>(new Set());

  const toggleStatus = (s: UiStatus) => {
    const next = new Set(statusSet);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusSet(next);
  };

  const togglePhase = useCallback(
    (p: Phase) => {
      const next = new Set(phaseSet);
      next.has(p) ? next.delete(p) : next.add(p);
      setPhaseSet(next);
    },
    [phaseSet]
  );

  const clearAll = () => { setSearch(""); setStatusSet(new Set()); setPhaseSet(new Set()); };

  const filteredRows = useMemo(() => {
    const q = safeLower(search);
    return baseRows.filter((r) => {
      if (statusSet.size && !statusSet.has(r.status)) return false;
      if (phaseSet.size && !phaseSet.has(r.phase)) return false;
      if (q) {
        const text = [r.artifactType, r.title, r.ownerEmail, r.ownerName].join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [baseRows, search, statusSet, phaseSet]);

  // Sort: current first, then baseline, then original order
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => {
      const phaseA = PHASE_CONFIG[a.phase]?.order ?? 99;
      const phaseB = PHASE_CONFIG[b.phase]?.order ?? 99;
      if (phaseA !== phaseB) return phaseA - phaseB;
      const ac = booly(a.isCurrent) ? 1 : 0;
      const bc = booly(b.isCurrent) ? 1 : 0;
      if (ac !== bc) return bc - ac;
      const ab = a.isBaseline ? 1 : 0;
      const bb = b.isBaseline ? 1 : 0;
      if (ab !== bb) return bb - ab;
      return (a.__idx ?? 0) - (b.__idx ?? 0);
    });
  }, [filteredRows]);

  const activeFiltersCount = (search ? 1 : 0) + statusSet.size + phaseSet.size;

  const [cloningId, setCloningId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [makingCurrentId, setMakingCurrentId] = useState("");
  const [actionError, setActionError] = useState("");

  const openArtifact = useCallback(
    (id: string) => {
      const ref = projectHumanId || projectCode || projectUuid;
      router.push(`/projects/${ref}/artifacts/${id}`);
    },
    [projectHumanId, projectCode, projectUuid, router]
  );

  const handleClone = async (id: string) => {
    if (!projectUuid || !looksLikeUuid(projectUuid)) { setActionError("Invalid project UUID"); return; }
    setCloningId(id);
    try {
      const fd = new FormData();
      fd.set("projectId", projectUuid);
      fd.set("artifactId", id);
      const res = await cloneArtifactAction(fd);
      if (res?.ok && res?.newArtifactId) {
        const ref = projectHumanId || projectCode || projectUuid;
        router.push(`/projects/${ref}/artifacts/${res.newArtifactId}`);
      }
    } catch (e: any) { setActionError(e.message); }
    finally { setCloningId(""); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    if (!projectUuid || !looksLikeUuid(projectUuid)) return;
    setDeletingId(id);
    try {
      const fd = new FormData();
      fd.set("projectId", projectUuid);
      fd.set("artifactId", id);
      await deleteDraftArtifactAction(fd);
      router.refresh();
    } catch (e: any) { setActionError(e.message); }
    finally { setDeletingId(""); }
  };

  const handleMakeCurrent = async (id: string) => {
    if (!projectUuid || !looksLikeUuid(projectUuid)) return;
    setMakingCurrentId(id);
    try {
      await setArtifactCurrentAction({ projectId: projectUuid, artifactId: id });
      router.refresh();
    } catch (e: any) { setActionError(e.message); }
    finally { setMakingCurrentId(""); }
  };

  return (
    <>
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");

        @keyframes notionFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes notionSlideUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .notion-board * {
          font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        .notion-row:hover {
          background: #FAFAFA !important;
        }

        .notion-board ::-webkit-scrollbar { width: 6px; height: 6px; }
        .notion-board ::-webkit-scrollbar-track { background: transparent; }
        .notion-board ::-webkit-scrollbar-thumb { background: #E5E7EB; border-radius: 3px; }
        .notion-board ::-webkit-scrollbar-thumb:hover { background: #D1D5DB; }
      `}</style>

      <div className="notion-board min-h-screen bg-white" style={{ WebkitFontSmoothing: "antialiased" }}>
        {/* Header */}
        <header className="sticky top-0 z-40 bg-white border-b border-[#F1F5F9]">
          <div className="max-w-[1320px] mx-auto px-6">
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-[#F3F4F6] flex items-center justify-center">
                  <Layers className="h-4 w-4 text-[#6B7280]" />
                </div>
                <div>
                  <h1 className="text-[15px] font-semibold text-[#111827]">Artifacts</h1>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[12px] text-[#9CA3AF]">{projectName || "Project"}</span>
                    {projectCode && (
                      <span className="text-[11px] font-mono text-[#9CA3AF] bg-[#F9FAFB] border border-[#F1F5F9] px-1.5 py-0.5 rounded">
                        {projectCode}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <StatsRow rows={filteredRows} />
                <div className="w-px h-5 bg-[#E5E7EB] mx-1 hidden md:block" />
                <button
                  onClick={() => setAiOpen(true)}
                  disabled={!projectUuid || !looksLikeUuid(projectUuid)}
                  className="flex items-center gap-1.5 px-3 py-[7px] rounded-lg text-[12px] font-medium bg-violet-50 text-violet-600 border border-violet-100 hover:bg-violet-100 transition-colors disabled:opacity-30"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* Error bar */}
        {actionError && (
          <div className="max-w-[1320px] mx-auto px-6 pt-3 relative z-10">
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-[13px] bg-red-50 text-red-700 border border-red-100 animate-[notionSlideUp_0.15s_ease-out]">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {actionError}
              <button onClick={() => setActionError("")} className="ml-auto p-0.5 rounded hover:bg-red-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        <main className="max-w-[1320px] mx-auto px-6 py-4 relative z-10">
          {/* Inline Filter Bar */}
          <InlineFilterBar
            search={search}
            setSearch={setSearch}
            statusSet={statusSet}
            toggleStatus={toggleStatus}
            phaseSet={phaseSet}
            togglePhase={togglePhase}
            clearAll={clearAll}
            activeCount={activeFiltersCount}
          />

          {/* Spreadsheet */}
          {sortedRows.length === 0 ? (
            <div className="text-center py-20 animate-[notionFadeIn_0.3s_ease-out]">
              <Layers className="h-8 w-8 mx-auto mb-3 text-[#D1D5DB]" />
              <p className="text-[14px] text-[#6B7280] mb-1">No artifacts found</p>
              <p className="text-[12px] text-[#9CA3AF]">
                {activeFiltersCount > 0 ? "Try adjusting your filters" : "Create your first artifact to get started"}
              </p>
            </div>
          ) : (
            <div
              className="rounded-lg border border-[#E5E7EB] overflow-hidden overflow-x-auto"
              style={{ background: "#FFFFFF" }}
            >
              {/* Column Header */}
              <div
                className="grid items-center sticky top-0 bg-[#F9FAFB] border-b border-[#E5E7EB] z-10"
                style={{ gridTemplateColumns: COL_TEMPLATE, minHeight: 36 }}
              >
                <span className="px-3 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Name</span>
                <span className="px-3 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Owner</span>
                <span className="px-3 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Phase</span>
                <span className="px-3 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Status</span>
                <span className="px-3 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider">Progress</span>
                <span className="px-3 text-[11px] font-semibold text-[#6B7280] uppercase tracking-wider"></span>
              </div>

              {/* Rows */}
              {sortedRows.map((row) => (
                <ArtifactTableRow
                  key={row.id}
                  row={row}
                  projectUuid={projectUuid}
                  onOpen={openArtifact}
                  onMakeCurrent={handleMakeCurrent}
                  makingCurrentId={makingCurrentId}
                  onClone={handleClone}
                  cloningId={cloningId}
                  onDelete={handleDelete}
                  deletingId={deletingId}
                />
              ))}

              {/* Footer count */}
              <div className="px-3 py-2 bg-[#F9FAFB] border-t border-[#E5E7EB]">
                <span className="text-[11px] text-[#9CA3AF]">
                  {sortedRows.length} artifact{sortedRows.length !== 1 ? "s" : ""}
                  {activeFiltersCount > 0 && ` (filtered from ${baseRows.length})`}
                </span>
              </div>
            </div>
          )}
        </main>

        {/* AI Panel */}
        <AiPanel
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          projectUuid={projectUuid}
          projectCode={projectCode || projectHumanId}
          projectName={projectName}
          projectHumanId={projectHumanId}
        />
      </div>
    </>
  );
}