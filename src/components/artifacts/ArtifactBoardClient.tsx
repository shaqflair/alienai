// src/components/artifacts/ArtifactBoardClient.tsx
"use client";

import React, { useMemo, useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { portfolioGlobalCss } from "@/lib/ui/portfolioTheme";
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
  Shield,
  Clock,
  ArrowUpRight,
  Layers,
  BarChart3,
  Zap,
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
   Board-manageable types (mirrors server actions constraint)
========================================================= */
const BOARD_MANAGEABLE_TYPES = new Set([
  "PROJECT_CHARTER",
  "PROJECT_CLOSURE_REPORT",
  "SCHEDULE",
]);

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
  href?: string;
  isVirtual?: boolean;
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

  const hashIdx = raw.indexOf("#");
  const qIdx = raw.indexOf("?");
  const cutIdx =
    qIdx >= 0 && hashIdx >= 0
      ? Math.min(qIdx, hashIdx)
      : qIdx >= 0
      ? qIdx
      : hashIdx >= 0
      ? hashIdx
      : -1;

  const path = cutIdx >= 0 ? raw.slice(0, cutIdx) : raw;
  const tail = cutIdx >= 0 ? raw.slice(cutIdx) : "";

  const fixedPath = path
    .replace(/\/RAID(\/|$)/g, "/raid$1")
    .replace(/\/WBS(\/|$)/g, "/wbs$1")
    .replace(/\/SCHEDULE(\/|$)/g, "/schedule$1")
    .replace(/\/CHANGE(\/|$)/g, "/change$1")
    .replace(/\/CHANGES(\/|$)/g, "/change$1")
    .replace(/\/CHANGE_REQUESTS(\/|$)/g, "/change$1")
    .replace(/\/ARTIFACTS(\/|$)/g, "/artifacts$1");

  return `${fixedPath}${tail}`;
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

function safeNum(x: any, fb = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

function aiItemHref(args: { item: any; fallbackProjectRef: string }) {
  const { item, fallbackProjectRef } = args;

  const rawLink = safeStr(item?.href || item?.link || "").trim();
  const normalized = rawLink ? normalizeArtifactLink(rawLink) : "";
  if (normalized.startsWith("/")) return normalized;

  const meta = item?.meta ?? {};

  const projectUuid =
    safeStr(meta?.project_id).trim() || safeStr(item?.project_id).trim() || "";
  const projectHuman =
    safeStr(meta?.project_human_id).trim() ||
    safeStr(meta?.project_code).trim() ||
    extractProjectRefFromHref(normalized) ||
    "";
  const projectRef = projectUuid || projectHuman || fallbackProjectRef;

  const kind = safeLower(item?.itemType || item?.kind || item?.type || "");

  const artifactId = safeStr(
    meta?.sourceArtifactId ||
      meta?.artifactId ||
      item?.artifact_id ||
      item?.artifactId ||
      ""
  ).trim();

  if (projectRef && artifactId && looksLikeUuid(artifactId)) {
    const qs = new URLSearchParams();
    qs.set("artifactId", artifactId);

    if (kind.includes("milestone") || kind.includes("schedule")) qs.set("panel", "schedule");
    else if (kind.includes("work_item") || kind.includes("work item") || kind.includes("wbs")) qs.set("panel", "wbs");
    else if (kind.includes("change")) qs.set("panel", "change");

    return `/projects/${projectRef}/artifacts?${qs.toString()}`;
  }

  if (kind.includes("milestone") || kind.includes("schedule"))
    return `/projects/${projectRef}/artifacts?panel=schedule`;
  if (
    kind.includes("work_item") ||
    kind.includes("work item") ||
    kind.includes("wbs")
  )
    return `/projects/${projectRef}/artifacts?panel=wbs`;
  if (
    kind.includes("raid") ||
    kind.includes("risk") ||
    kind.includes("issue") ||
    kind.includes("dependency")
  )
    return `/projects/${projectRef}/raid`;
  if (kind.includes("change")) return `/projects/${projectRef}/change`;

  return `/projects/${projectRef}`;
}

/* =========================================================
   Type Mapping
========================================================= */

function canonType(x: any): string {
  const raw = safeLower(x);
  if (!raw) return "";
  const t = raw
    .replace(/\s+/g, " ")
    .replace(/[\/]+/g, " / ")
    .replace(/[_-]+/g, "_")
    .trim();

  if (
    t === "governance" ||
    t === "delivery_governance" ||
    t === "delivery governance" ||
    t === "governance_hub" ||
    t === "governance hub"
  )
    return "GOVERNANCE";

  if (
    [
      "weekly_report",
      "weekly report",
      "weekly_status",
      "weekly status",
      "weekly_update",
      "weekly update",
      "delivery_report",
      "delivery report",
      "status_report",
      "status report",
    ].includes(t)
  )
    return "WEEKLY_REPORT";

  if (t === "status_dashboard" || t === "status dashboard")
    return "PROJECT_CLOSURE_REPORT";
  if (t.includes("charter") || t === "pid") return "PROJECT_CHARTER";
  if (t.includes("stakeholder")) return "STAKEHOLDER_REGISTER";
  if (t === "wbs" || t.includes("work breakdown")) return "WBS";
  if (t.includes("schedule") || t.includes("roadmap") || t.includes("gantt"))
    return "SCHEDULE";

  if (
    t === "financial_plan" ||
    t === "financial plan" ||
    t === "financial" ||
    t === "budget_plan" ||
    t === "budget plan" ||
    t === "financials"
  )
    return "FINANCIAL_PLAN";

  if (t.includes("change")) return "CHANGE_REQUESTS";
  if (t.includes("raid")) return "RAID";
  if (t.includes("lessons") || t.includes("retro")) return "LESSONS_LEARNED";
  if (t.includes("closure") || t.includes("closeout"))
    return "PROJECT_CLOSURE_REPORT";
  return t.toUpperCase().replace(/\s+/g, "_");
}

function phaseForCanonType(typeKey: string): Phase {
  switch (typeKey) {
    case "PROJECT_CHARTER":
      return "Initiating";
    case "STAKEHOLDER_REGISTER":
    case "WBS":
    case "SCHEDULE":
    case "FINANCIAL_PLAN":
      return "Planning";
    case "WEEKLY_REPORT":
      return "Executing";
    case "GOVERNANCE":
    case "RAID":
    case "CHANGE_REQUESTS":
      return "Monitoring & Controlling";
    case "LESSONS_LEARNED":
    case "PROJECT_CLOSURE_REPORT":
      return "Closing";
    default:
      return "Planning";
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
    const tk =
      safeStr(r.typeKey || canonType(r.artifactType)).trim() ||
      safeStr(r.artifactType).trim();
    const key = tk || r.id;
    const mark = !seenType.has(key);
    if (mark) seenType.add(key);
    return { ...r, typeKey: tk, isCurrent: mark };
  });
}

/* =========================================================
   Virtual/module rows
========================================================= */

function rowTypeKey(row: ArtifactBoardRow) {
  return safeStr(row.typeKey || canonType(row.artifactType) || row.artifactType)
    .trim()
    .toUpperCase();
}

function isVirtualRow(row: ArtifactBoardRow) {
  if (booly((row as any).isVirtual)) return true;
  const id = safeStr(row.id).trim();
  return id.startsWith("__") || !looksLikeUuid(id);
}

function rowHref(projectRef: string, projectUuid: string, row: ArtifactBoardRow) {
  const direct = safeStr((row as any).href).trim();
  if (direct) return normalizeArtifactLink(direct);

  const tk = rowTypeKey(row);
  if (tk === "CHANGE_REQUESTS" || tk === "CHANGE" || tk === "CHANGE_REQUEST")
    return `/projects/${projectRef}/change`;
  if (tk === "RAID" || tk === "RAID_LOG") return `/projects/${projectRef}/raid`;
  if (tk === "GOVERNANCE") return `/projects/${projectRef}/governance`;

  const id = safeStr(row.id).trim();
  if (id === "__financial_plan__")
    return `/projects/${projectRef}/artifacts/new?type=financial_plan`;

  return `/projects/${projectRef}/artifacts/${id}`;
}

function rowOpensArtifactDetail(row: ArtifactBoardRow) {
  const tk = rowTypeKey(row);
  if (tk === "CHANGE_REQUESTS" || tk === "CHANGE" || tk === "CHANGE_REQUEST")
    return false;
  if (tk === "RAID" || tk === "RAID_LOG") return false;
  if (tk === "GOVERNANCE") return false;
  return true;
}

/* =========================================================
   Phase & Status Config
========================================================= */

const PHASE_CONFIG: Record<
  Phase,
  { icon: React.ElementType; color: string; bg: string; label: string; order: number }
> = {
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
   Spreadsheet Components
========================================================= */

function ProgressBar({ value, color }: { value: number; color: string }) {
  const v = clampPct(value);
  return (
    <div className="flex items-center gap-2.5 w-full">
      <div
        className="flex-1 h-[4px] rounded-full overflow-hidden"
        style={{ background: "var(--rule)" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${v}%`,
            background: color,
            transition: "width 0.6s cubic-bezier(0.4, 0, 0.2, 1)",
          }}
        />
      </div>
      <span
        className="artifact-mono text-[11px] font-medium"
        style={{ color: "var(--ink-4)", minWidth: 30, textAlign: "right" }}
      >
        {v}%
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: UiStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className="artifact-mono inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[9px] font-medium uppercase tracking-[0.08em]"
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
      className="artifact-mono inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full text-[9px] font-medium uppercase tracking-[0.08em]"
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
        className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0"
        style={{ background: `hsl(${hue}, 55%, 92%)`, color: `hsl(${hue}, 60%, 35%)` }}
      >
        {initials}
      </div>
      <span className="text-[13px] truncate" style={{ color: "var(--ink-2)" }}>
        {displayName}
      </span>
    </div>
  );
}

function TagPill({ children, color, bg }: { children: React.ReactNode; color: string; bg: string }) {
  return (
    <span
      className="artifact-mono inline-flex items-center gap-1 px-1.5 py-[2px] rounded-full text-[9px] font-medium uppercase tracking-[0.08em]"
      style={{ color, background: bg }}
    >
      {children}
    </span>
  );
}

/* =========================================================
   Table Row
========================================================= */

const COL_TEMPLATE = "minmax(320px, 2fr) 220px 170px 150px 150px 110px";

function ArtifactTableRow({
  row,
  projectRef,
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
  projectRef: string;
  projectUuid: string;
  onOpen: (row: ArtifactBoardRow) => void;
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

  const virtual = isVirtualRow(row);
  const opensArtifact = rowOpensArtifactDetail(row);
  const tk = rowTypeKey(row);
  const isBoardManageable = BOARD_MANAGEABLE_TYPES.has(tk);

  const canDelete =
    !virtual &&
    isBoardManageable &&
    row.canDeleteDraft !== false &&
    row.status === "Draft" &&
    !row.isBaseline &&
    !row.isLocked &&
    !row.deletedAt;

  const canClone = !virtual && isBoardManageable;
  const canMakeCurrent = !virtual && opensArtifact;

  const phaseCfg = PHASE_CONFIG[row.phase];
  const openHref = rowHref(projectRef, projectUuid, row);

  return (
    <div
      onClick={() => onOpen(row)}
      className="artifact-row group relative grid items-center cursor-pointer"
      style={{
        gridTemplateColumns: COL_TEMPLATE,
        borderBottom: "1px solid var(--rule)",
        minHeight: 68,
        background: "var(--white)",
      }}
    >
      <div className="flex items-center gap-2 px-4 py-3 min-w-0 h-full">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span
              className="truncate"
              style={{
                fontSize: 15,
                fontWeight: 650,
                color: "var(--ink)",
                letterSpacing: "-0.01em",
              }}
            >
              {row.title || row.artifactType}
            </span>

            {isCurrent && (
              <TagPill color="var(--green)" bg="var(--green-bg)">
                <CheckCircle2 className="h-2.5 w-2.5" /> live
              </TagPill>
            )}

            {row.isBaseline && (
              <TagPill color="var(--ink-3)" bg="var(--off)">
                <Shield className="h-2.5 w-2.5" /> baseline
              </TagPill>
            )}

            {virtual && <TagPill color="var(--ink-3)" bg="var(--off)">module</TagPill>}
          </div>

          <span
            className="artifact-mono truncate block"
            style={{
              fontSize: 10,
              fontWeight: 400,
              color: "var(--ink-4)",
              letterSpacing: "0.04em",
              marginTop: 4,
            }}
          >
            {row.artifactType}
          </span>
        </div>
      </div>

      <div
        className="px-4 py-3 h-full flex items-center"
        style={{ borderLeft: "1px solid var(--rule)" }}
      >
        <AvatarChip email={row.ownerEmail} name={row.ownerName} />
      </div>

      <div
        className="px-4 py-3 h-full flex items-center"
        style={{ borderLeft: "1px solid var(--rule)" }}
      >
        <PhaseBadge phase={row.phase} />
      </div>

      <div
        className="px-4 py-3 h-full flex items-center"
        style={{ borderLeft: "1px solid var(--rule)" }}
      >
        <StatusBadge status={row.status} />
      </div>

      <div
        className="px-4 py-3 h-full flex items-center"
        style={{ borderLeft: "1px solid var(--rule)" }}
      >
        <ProgressBar value={row.progress} color={phaseCfg.color} />
      </div>

      <div
        className="px-3 py-3 h-full flex items-center justify-end gap-1"
        style={{ borderLeft: "1px solid var(--rule)" }}
      >
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {!isCurrent && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (!canMakeCurrent) return;
                onMakeCurrent(row.id);
              }}
              disabled={isMaking || !canMakeCurrent || !projectUuid || !looksLikeUuid(projectUuid)}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: "var(--green)" }}
              title={canMakeCurrent ? "Set as current" : "Not available for modules" }
            >
              {isMaking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </button>
          )}

          {canClone && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClone(row.id);
              }}
              disabled={isCloning || !projectUuid || !looksLikeUuid(projectUuid)}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: "#2563EB" }}
              title="Clone"
            >
              {isCloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}

          {canDelete && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(row.id);
              }}
              disabled={isDeleting || !projectUuid || !looksLikeUuid(projectUuid)}
              className="p-1.5 rounded transition-colors disabled:opacity-30"
              style={{ color: "var(--red)" }}
              title="Delete draft"
            >
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          )}

          <Link
            href={openHref}
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded transition-colors"
            style={{ color: "var(--ink-3)" }}
            title="Open"
          >
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Search / Filter Bar
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
    <div className="toolbar-artifacts">
      <div className="toolbar-search-wrap">
        <div className="toolbar-search">
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--ink-4)" }} />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (search) setSearch("");
                else (e.target as HTMLInputElement).blur();
              }
            }}
            placeholder="Filter artifacts..."
            className="toolbar-search-input"
          />
          {search && (
            <button onClick={() => setSearch("")} className="icon-mini-btn">
              <X className="h-3 w-3" />
            </button>
          )}
          <kbd className="artifact-mono shortcut-kbd">⌘K</kbd>
        </div>

        <button
          onClick={() => setShowFilters((v) => !v)}
          className="toolbar-filter-btn"
          style={{
            borderColor: activeCount > 0 ? "#d7e6ff" : "var(--rule)",
            background: activeCount > 0 ? "#f4f8ff" : "var(--white)",
            color: activeCount > 0 ? "#2563EB" : "var(--ink-3)",
          }}
        >
          <Filter className="h-3.5 w-3.5" />
          Filter
          {activeCount > 0 && <span className="toolbar-filter-count">{activeCount}</span>}
          <ChevronDown className={`h-3 w-3 transition-transform ${showFilters ? "rotate-180" : ""}`} />
        </button>
      </div>

      {showFilters && (
        <div className="toolbar-filter-panel">
          <div className="toolbar-chip-group">
            <span className="artifact-mono toolbar-chip-label">Status</span>
            {(["Draft", "In review", "Approved", "Blocked"] as UiStatus[]).map((status) => {
              const active = statusSet.has(status);
              const s = STATUS_STYLES[status];
              return (
                <button
                  key={status}
                  onClick={() => toggleStatus(status)}
                  className="toolbar-chip-btn artifact-mono"
                  style={{
                    background: active ? s.bg : "transparent",
                    color: active ? s.color : "var(--ink-4)",
                    borderColor: active ? s.bg : "var(--rule)",
                  }}
                >
                  {status}
                </button>
              );
            })}
          </div>

          <div className="toolbar-divider" />

          <div className="toolbar-chip-group">
            <span className="artifact-mono toolbar-chip-label">Phase</span>
            {(["Initiating", "Planning", "Executing", "Monitoring & Controlling", "Closing"] as Phase[]).map((phase) => {
              const active = phaseSet.has(phase);
              const cfg = PHASE_CONFIG[phase];
              return (
                <button
                  key={phase}
                  onClick={() => togglePhase(phase)}
                  className="toolbar-chip-btn artifact-mono"
                  style={{
                    background: active ? cfg.bg : "transparent",
                    color: active ? cfg.color : "var(--ink-4)",
                    borderColor: active ? cfg.bg : "var(--rule)",
                  }}
                >
                  {cfg.label}
                </button>
              );
            })}
          </div>

          {activeCount > 0 && (
            <>
              <div className="toolbar-divider" />
              <button onClick={clearAll} className="toolbar-clear-btn artifact-mono">
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
   Stats Row
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
    <div className="artifact-stats-row artifact-mono">
      <span>
        <b style={{ color: "var(--ink)", fontWeight: 500 }}>{stats.total}</b> total
      </span>
      <span>
        <b style={{ color: "var(--green)", fontWeight: 500 }}>{stats.approved}</b> approved
      </span>
      <span>
        <b style={{ color: "#2563EB", fontWeight: 500 }}>{stats.inReview}</b> in review
      </span>
      {stats.blocked > 0 && (
        <span>
          <b style={{ color: "var(--red)", fontWeight: 500 }}>{stats.blocked}</b> blocked
        </span>
      )}
      <span>
        <b style={{ color: "#7C3AED", fontWeight: 500 }}>{stats.avgProgress}%</b> avg progress
      </span>
    </div>
  );
}

/* =========================================================
   AI Panel
========================================================= */

function daysUntil(iso: string | null | undefined) {
  const s = safeStr(iso).trim();
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

type AiScope = "project" | "org";

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
  const canProject = !!projectUuid && looksLikeUuid(projectUuid);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [scope, setScope] = useState<AiScope>(canProject ? "project" : "org");

  useEffect(() => {
    if (open) {
      setLoading(false);
      setResult(null);
      setError("");
      setScope(canProject ? "project" : "org");
    }
  }, [open, canProject]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  function extractDueSoon(data: any): any[] {
    const a = data?.ai ?? data ?? {};
    const cand =
      a?.dueSoon ??
      a?.due_soon ??
      a?.items ??
      a?.events ??
      a?.ai?.dueSoon ??
      a?.ai?.due_soon ??
      [];
    return Array.isArray(cand) ? cand : [];
  }

  function extractCounts(data: any): any {
    return data?.counts ?? data?.ai?.counts ?? data?.stats ?? data?.ai?.stats ?? null;
  }

  async function runCheck() {
    if (scope === "project" && !canProject) {
      setError("Invalid project UUID");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const qs = new URLSearchParams();
      qs.set("windowDays", "14");
      qs.set("eventType", "artifact_due");
      if (scope === "project") qs.set("project_id", projectUuid);

      const res = await fetch(`/api/ai/events?${qs.toString()}`, {
        method: "GET",
        credentials: "include",
        headers: { accept: "application/json" },
        cache: "no-store",
      });

      const text = await res.text();
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {}

      if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);

      setResult(data);
    } catch (e: any) {
      setError(e?.message || "AI request failed");
      setResult((prev: any) => prev ?? { ai: { dueSoon: [] } });
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  const items = extractDueSoon(result);
  const counts = extractCounts(result);

  const projectRef = projectHumanId || projectCode || projectUuid;
  const scopeLabel = scope === "org" ? "All projects" : "This project";

  const grouped = useMemo(() => {
    if (scope !== "org") return null;
    const map = new Map<string, { label: string; items: any[]; sortKey: string }>();

    for (const it of items) {
      const meta = it?.meta ?? {};
      const code = safeStr(meta?.project_code).trim();
      const name = safeStr(meta?.project_name).trim();
      const human = safeStr(meta?.project_human_id).trim();
      const pid = safeStr(meta?.project_id).trim();

      const key = code || human || pid || "Project";
      const label = code && name ? `${code} — ${name}` : code || name || human || pid || "Project";

      const existing = map.get(key);
      if (!existing) map.set(key, { label, items: [it], sortKey: code || human || name || pid || key });
      else existing.items.push(it);
    }

    return Array.from(map.entries())
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [items, scope]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div
        className="relative w-full max-w-md max-h-[70vh] rounded-xl overflow-hidden flex flex-col bg-white"
        style={{ border: "1px solid var(--rule)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.15)" }}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--rule)" }}>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md flex items-center justify-center" style={{ background: "#f3e8ff" }}>
              <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            </div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>AI Assistant</span>
              <span className="artifact-mono" style={{ fontSize: 10, color: "var(--ink-4)", marginLeft: 8 }}>
                {scope === "org" ? "Portfolio" : projectCode || projectHumanId || "—"}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="inline-flex items-center rounded-lg border overflow-hidden"
              style={{ borderColor: "var(--rule)", background: "var(--off-2)", height: 28 }}
            >
              <button
                onClick={() => {
                  if (!canProject) return;
                  setScope("project");
                  setResult(null);
                  setError("");
                }}
                className="artifact-mono px-2.5 text-[10px] font-medium uppercase tracking-[0.08em]"
                style={{
                  background: scope === "project" ? "#EEF2FF" : "transparent",
                  color: scope === "project" ? "#4F46E5" : "var(--ink-3)",
                  opacity: canProject ? 1 : 0.4,
                  cursor: canProject ? "pointer" : "not-allowed",
                }}
                title={canProject ? "Due items for this project" : "Project scope unavailable (missing project UUID)"}
              >
                Project
              </button>
              <button
                onClick={() => {
                  setScope("org");
                  setResult(null);
                  setError("");
                }}
                className="artifact-mono px-2.5 text-[10px] font-medium uppercase tracking-[0.08em]"
                style={{
                  background: scope === "org" ? "#EEF2FF" : "transparent",
                  color: scope === "org" ? "#4F46E5" : "var(--ink-3)",
                }}
                title="Due items across all my projects"
              >
                All
              </button>
            </div>

            <button onClick={onClose} className="icon-mini-btn" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {scope === "org" && counts && (
            <div className="mb-3 p-3 rounded-lg border" style={{ background: "#FAFBFF", borderColor: "#EEF2FF" }}>
              <div className="flex items-center justify-between">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{scopeLabel}</div>
                <div className="artifact-mono" style={{ fontSize: 10, color: "var(--ink-3)" }}>
                  Due soon:{" "}
                  <span style={{ fontWeight: 500, color: "var(--ink)" }}>
                    {safeNum(counts?.dueSoon ?? counts?.due_soon ?? items.length)}
                  </span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  ["Milestones", counts?.schedule_milestones ?? counts?.milestones ?? counts?.milestone],
                  ["Work items", counts?.work_items ?? counts?.workItems ?? counts?.wbs],
                  ["RAID", counts?.raid_items ?? counts?.raidItems ?? counts?.raid],
                  ["Change", counts?.change_requests ?? counts?.changeRequests ?? counts?.changes],
                ].map(([label, val]) => {
                  const n = safeNum(val, 0);
                  if (!n) return null;
                  return (
                    <span
                      key={String(label)}
                      className="artifact-mono"
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        color: "var(--ink-2)",
                        background: "var(--white)",
                        border: "1px solid var(--rule)",
                        borderRadius: 999,
                        padding: "4px 8px",
                      }}
                    >
                      {label}: {n}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {error ? (
            <div className="p-3 rounded-lg text-[13px] flex items-start gap-2" style={{ background: "var(--red-bg)", color: "var(--red)" }}>
              <AlertCircle className="h-4 w-4 mt-[1px] shrink-0" />
              <div>
                <div style={{ fontWeight: 600 }}>Scan failed</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{error}</div>
                <button
                  onClick={runCheck}
                  disabled={loading}
                  className="mt-2 px-3 py-1 rounded-md text-[12px] font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50"
                >
                  {loading ? "Retrying..." : "Retry"}
                </button>
              </div>
            </div>
          ) : !result ? (
            <div className="text-center py-10">
              <Clock className="h-8 w-8 mx-auto mb-3 text-violet-400" />
              <p style={{ fontSize: 13, color: "var(--ink-3)", marginBottom: 4 }}>Check what&apos;s due in the next 14 days</p>
              <p className="artifact-mono" style={{ fontSize: 10, color: "var(--ink-4)", marginBottom: 16 }}>
                {scopeLabel}
              </p>
              <button
                onClick={runCheck}
                disabled={loading}
                className="px-4 py-2 rounded-lg text-[13px] font-medium text-white bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning...
                  </span>
                ) : (
                  "Scan Due Dates"
                )}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10">
              <FileCheck className="h-8 w-8 mx-auto mb-3 text-emerald-400" />
              <p style={{ fontSize: 13, color: "var(--ink-3)" }}>Nothing due in the next 14 days</p>
              <p className="artifact-mono" style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 4 }}>
                {scopeLabel}
              </p>
            </div>
          ) : scope === "org" && grouped ? (
            <div className="space-y-3">
              {grouped.map((g) => (
                <div key={g.key} className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--rule)" }}>
                  <div
                    className="px-3 py-2 border-b flex items-center justify-between"
                    style={{ background: "var(--off-2)", borderColor: "var(--rule)" }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ink)" }}>{g.label}</div>
                    <div className="artifact-mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>
                      {g.items.length} due
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {g.items.slice(0, 25).map((item: any, idx: number) => {
                      const days = daysUntil(item?.dueDate || item?.due_date);
                      const isOverdue = days !== null && days < 0;
                      const href = aiItemHref({ item, fallbackProjectRef: projectRef });
                      const label = safeStr(item?.itemType || item?.type || "item").replace(/_/g, " ");
                      const dueRaw = safeStr(item?.dueDate || item?.due_date).trim();
                      return (
                        <div
                          key={`${g.key}:${idx}`}
                          className="p-3 rounded-lg border transition-colors"
                          style={{ borderColor: "var(--rule)" }}
                        >
                          <div className="flex items-center justify-between mb-1.5">
                            <span
                              className="artifact-mono"
                              style={{
                                fontSize: 9,
                                fontWeight: 500,
                                letterSpacing: "0.08em",
                                textTransform: "uppercase",
                                color: "var(--ink-4)",
                                background: "var(--off-2)",
                                padding: "4px 6px",
                                borderRadius: 999,
                              }}
                            >
                              {label}
                            </span>
                            {days !== null && (
                              <span
                                className="artifact-mono"
                                style={{ fontSize: 10, fontWeight: 500, color: isOverdue ? "var(--red)" : "var(--amber)" }}
                              >
                                {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d`}
                              </span>
                            )}
                          </div>
                          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>{item?.title}</h4>
                          <div className="flex items-center gap-1.5 artifact-mono" style={{ fontSize: 10, color: "var(--ink-4)", marginBottom: 10 }}>
                            <Calendar className="h-3 w-3" /> {dueRaw ? fmtUkDateOnly(dueRaw) : "No due date"}
                          </div>
                          <div className="flex gap-2">
                            <Link
                              href={href}
                              className="flex-1 px-3 py-1.5 rounded-md text-center text-[11px] font-medium border transition-colors"
                              style={{ background: "var(--off-2)", borderColor: "var(--rule)", color: "var(--ink-2)" }}
                            >
                              Open
                            </Link>
                            <button
                              onClick={() =>
                                navigator.clipboard.writeText(
                                  `Reminder: ${safeStr(item?.title)} due ${dueRaw ? fmtUkDateOnly(dueRaw) : "TBC"}`
                                )
                              }
                              className="px-3 py-1.5 rounded-md text-[11px] font-medium text-white bg-violet-600 hover:bg-violet-700 transition-colors"
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {items.map((item: any, idx: number) => {
                const days = daysUntil(item?.dueDate || item?.due_date);
                const isOverdue = days !== null && days < 0;
                const href = aiItemHref({ item, fallbackProjectRef: projectRef });
                const label = safeStr(item?.itemType || item?.type || "item").replace(/_/g, " ");
                const dueRaw = safeStr(item?.dueDate || item?.due_date).trim();
                return (
                  <div key={idx} className="p-3 rounded-lg border" style={{ borderColor: "var(--rule)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span
                        className="artifact-mono"
                        style={{
                          fontSize: 9,
                          fontWeight: 500,
                          letterSpacing: "0.08em",
                          textTransform: "uppercase",
                          color: "var(--ink-4)",
                          background: "var(--off-2)",
                          padding: "4px 6px",
                          borderRadius: 999,
                        }}
                      >
                        {label}
                      </span>
                      {days !== null && (
                        <span
                          className="artifact-mono"
                          style={{ fontSize: 10, fontWeight: 500, color: isOverdue ? "var(--red)" : "var(--amber)" }}
                        >
                          {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d`}
                        </span>
                      )}
                    </div>
                    <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", marginBottom: 4 }}>{item?.title}</h4>
                    <div className="flex items-center gap-1.5 artifact-mono" style={{ fontSize: 10, color: "var(--ink-4)", marginBottom: 10 }}>
                      <Calendar className="h-3 w-3" /> {dueRaw ? fmtUkDateOnly(dueRaw) : "No due date"}
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={href}
                        className="flex-1 px-3 py-1.5 rounded-md text-center text-[11px] font-medium border transition-colors"
                        style={{ background: "var(--off-2)", borderColor: "var(--rule)", color: "var(--ink-2)" }}
                      >
                        Open
                      </Link>
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(
                            `Reminder: ${safeStr(item?.title)} due ${dueRaw ? fmtUkDateOnly(dueRaw) : "TBC"}`
                          )
                        }
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

        <div className="px-4 py-2.5 border-t" style={{ borderColor: "var(--rule)" }}>
          <button
            onClick={runCheck}
            disabled={loading}
            className="w-full py-1.5 rounded-lg text-[12px] font-medium border transition-colors disabled:opacity-50"
            style={{ color: "var(--ink-3)", background: "var(--off-2)", borderColor: "var(--rule)" }}
          >
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
        .map((a, i) => ({
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
        }) as ArtifactBoardRow)
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

  const clearAll = () => {
    setSearch("");
    setStatusSet(new Set());
    setPhaseSet(new Set());
  };

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

  const projectRef = useMemo(
    () => safeStr(projectHumanId || projectCode || projectUuid).trim(),
    [projectHumanId, projectCode, projectUuid]
  );

  const openRow = useCallback(
    (row: ArtifactBoardRow) => {
      router.push(rowHref(projectRef, projectUuid, row));
    },
    [projectRef, projectUuid, router]
  );

  const handleClone = async (id: string) => {
    if (!projectUuid || !looksLikeUuid(projectUuid)) {
      setActionError("Invalid project UUID");
      return;
    }
    if (!looksLikeUuid(id)) {
      setActionError("Cannot clone a module row");
      return;
    }
    setCloningId(id);
    setActionError("");
    try {
      const fd = new FormData();
      fd.set("projectId", projectUuid);
      fd.set("artifactId", id);
      const res = await cloneArtifactAction(fd);
      if (!res?.ok) throw new Error(res?.error ?? "Clone failed");
      if (res.newArtifactId) router.push(`/projects/${projectRef}/artifacts/${res.newArtifactId}`);
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setCloningId("");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    if (!projectUuid || !looksLikeUuid(projectUuid)) return;
    if (!looksLikeUuid(id)) return;
    setDeletingId(id);
    setActionError("");
    try {
      const res = await deleteDraftArtifactAction({ projectId: projectUuid, artifactId: id });
      if (!res?.ok) throw new Error(res?.error ?? "Delete failed");
      router.refresh();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setDeletingId("");
    }
  };

  const handleMakeCurrent = async (id: string) => {
    if (!projectUuid || !looksLikeUuid(projectUuid)) return;
    if (!looksLikeUuid(id)) return;
    setMakingCurrentId(id);
    setActionError("");
    try {
      await setArtifactCurrentAction({ projectId: projectUuid, artifactId: id });
      router.refresh();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setMakingCurrentId("");
    }
  };

  return (
    <>
      <style jsx global>{`
        ${portfolioGlobalCss()}

        .notion-board,
        .notion-board * {
          font-family: var(--font);
        }

        .artifact-mono {
          font-family: var(--mono) !important;
        }

        .notion-board {
          background: linear-gradient(to bottom, #ffffff 0%, #ffffff 280px, #fcfcfc 100%);
          color: var(--ink);
          -webkit-font-smoothing: antialiased;
        }

        .artifact-row:hover {
          background: #fcfcfc !important;
        }

        .toolbar-artifacts {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px 0 16px;
          border-bottom: 1px solid var(--rule);
          margin-bottom: 14px;
        }

        .toolbar-search-wrap {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .toolbar-search {
          display: flex;
          align-items: center;
          gap: 10px;
          flex: 1;
          min-width: 0;
          border: 1px solid var(--rule);
          background: var(--white);
          border-radius: 12px;
          padding: 0 14px;
          min-height: 44px;
        }

        .toolbar-search-input {
          border: none;
          outline: none;
          background: transparent;
          font-family: var(--font);
          font-size: 13px;
          font-weight: 400;
          color: var(--ink);
          width: 100%;
          padding: 12px 0;
        }

        .toolbar-search-input::placeholder {
          color: var(--ink-4);
        }

        .shortcut-kbd {
          border: 1px solid var(--rule);
          border-radius: 8px;
          padding: 3px 7px;
          background: var(--white);
          color: var(--ink-4);
          font-size: 10px;
          letter-spacing: 0.04em;
        }

        .icon-mini-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          border-radius: 6px;
          color: var(--ink-3);
          transition: background 0.12s, color 0.12s;
        }

        .icon-mini-btn:hover {
          background: var(--off);
          color: var(--ink);
        }

        .toolbar-filter-btn {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          padding: 0 14px;
          min-height: 44px;
          border-radius: 12px;
          border: 1px solid var(--rule);
          font-size: 12px;
          font-weight: 600;
          background: var(--white);
          transition: border-color 0.12s, background 0.12s, color 0.12s;
        }

        .toolbar-filter-count {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          border-radius: 999px;
          background: #2563eb;
          color: #fff;
          font-size: 10px;
          font-weight: 600;
        }

        .toolbar-filter-panel {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 12px;
          padding-top: 2px;
        }

        .toolbar-chip-group {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .toolbar-chip-label {
          font-size: 9px;
          font-weight: 500;
          color: var(--ink-4);
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }

        .toolbar-chip-btn {
          padding: 6px 10px;
          border-radius: 999px;
          font-size: 9px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          border: 1px solid var(--rule);
          background: transparent;
          transition: all 0.12s;
        }

        .toolbar-divider {
          width: 1px;
          height: 18px;
          background: var(--rule);
        }

        .toolbar-clear-btn {
          font-size: 9px;
          font-weight: 500;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-4);
        }

        .toolbar-clear-btn:hover {
          color: var(--ink-2);
        }

        .artifact-stats-row {
          display: flex;
          align-items: center;
          gap: 18px;
          font-size: 10px;
          font-weight: 400;
          color: var(--ink-4);
          letter-spacing: 0.03em;
          text-transform: lowercase;
          white-space: nowrap;
        }

        .notion-board ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        .notion-board ::-webkit-scrollbar-track {
          background: transparent;
        }

        .notion-board ::-webkit-scrollbar-thumb {
          background: #dedede;
          border-radius: 3px;
        }

        .notion-board ::-webkit-scrollbar-thumb:hover {
          background: #cccccc;
        }

        @media (max-width: 1100px) {
          .artifact-stats-row {
            display: none;
          }
        }

        @media (max-width: 900px) {
          .toolbar-search-wrap {
            flex-direction: column;
            align-items: stretch;
          }
        }
      `}</style>

      <div className="notion-board min-h-screen" style={{ WebkitFontSmoothing: "antialiased" }}>
        <header
          className="sticky top-0 z-40"
          style={{
            background: "rgba(255,255,255,0.92)",
            backdropFilter: "blur(8px)",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <div className="max-w-[1320px] mx-auto px-6">
            <div className="flex items-center justify-between py-5 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "var(--off)" }}
                >
                  <Layers className="h-4 w-4" style={{ color: "var(--ink-3)" }} />
                </div>

                <div className="min-w-0">
                  <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ink)", letterSpacing: "-0.035em", lineHeight: 1 }}>
                    Artifacts
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <span style={{ fontSize: 13, color: "var(--ink-3)" }}>{projectName || "Project"}</span>
                    {projectCode && (
                      <span
                        className="artifact-mono"
                        style={{
                          fontSize: 10,
                          color: "var(--ink-4)",
                          background: "var(--off-2)",
                          border: "1px solid var(--rule)",
                          padding: "4px 8px",
                          borderRadius: 999,
                          letterSpacing: "0.04em",
                        }}
                      >
                        {projectCode}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <StatsRow rows={filteredRows} />
                <button
                  onClick={() => setAiOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-[10px] rounded-xl text-[12px] font-semibold transition-colors"
                  style={{
                    background: "#f5f3ff",
                    color: "#7c3aed",
                    border: "1px solid #ede9fe",
                  }}
                  title={looksLikeUuid(projectUuid) ? "AI due scan (project or portfolio)" : "AI due scan (portfolio available)"}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI
                </button>
              </div>
            </div>
          </div>
        </header>

        {actionError && (
          <div className="max-w-[1320px] mx-auto px-6 pt-4 relative z-10">
            <div
              className="flex items-center gap-2 px-4 py-3 rounded-xl"
              style={{
                fontSize: 13,
                background: "var(--red-bg)",
                color: "var(--red)",
                border: "1px solid #fecaca",
              }}
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {actionError}
              <button onClick={() => setActionError("")} className="ml-auto icon-mini-btn">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <main className="max-w-[1320px] mx-auto px-6 py-4 relative z-10">
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

          {sortedRows.length === 0 ? (
            <div
              className="text-center"
              style={{
                padding: "88px 24px",
                border: "1px solid var(--rule)",
                background: "var(--white)",
                borderRadius: 16,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 2,
                  background: "var(--ink-4)",
                  margin: "0 auto 20px",
                }}
              />
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 600,
                  color: "var(--ink)",
                  letterSpacing: "-0.02em",
                  marginBottom: 10,
                }}
              >
                No artifacts found.
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-3)", fontWeight: 400 }}>
                {activeFiltersCount > 0 ? "Try adjusting your filters." : "Create your first artifact to get started."}
              </p>
            </div>
          ) : (
            <div
              className="overflow-hidden overflow-x-auto"
              style={{
                background: "var(--white)",
                border: "1px solid var(--rule)",
                borderRadius: 16,
                boxShadow: "var(--shadow-soft)",
              }}
            >
              <div
                className="grid items-center sticky top-0 z-10"
                style={{
                  gridTemplateColumns: COL_TEMPLATE,
                  minHeight: 42,
                  background: "var(--off)",
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <span className="artifact-mono px-4 text-[9px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ink-4)" }}>
                  Name
                </span>
                <span className="artifact-mono px-4 text-[9px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ink-4)" }}>
                  Owner
                </span>
                <span className="artifact-mono px-4 text-[9px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ink-4)" }}>
                  Phase
                </span>
                <span className="artifact-mono px-4 text-[9px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ink-4)" }}>
                  Status
                </span>
                <span className="artifact-mono px-4 text-[9px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ink-4)" }}>
                  Progress
                </span>
                <span className="artifact-mono px-4 text-[9px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ink-4)" }} />
              </div>

              {sortedRows.map((row) => (
                <ArtifactTableRow
                  key={`${row.id}:${rowTypeKey(row)}`}
                  row={row}
                  projectRef={projectRef}
                  projectUuid={projectUuid}
                  onOpen={openRow}
                  onMakeCurrent={handleMakeCurrent}
                  makingCurrentId={makingCurrentId}
                  onClone={handleClone}
                  cloningId={cloningId}
                  onDelete={handleDelete}
                  deletingId={deletingId}
                />
              ))}

              <div
                className="px-4 py-3"
                style={{ background: "var(--white)", borderTop: "1px solid var(--rule)" }}
              >
                <span className="artifact-mono" style={{ fontSize: 10, color: "var(--ink-4)", letterSpacing: "0.08em" }}>
                  {sortedRows.length} artifact{sortedRows.length !== 1 ? "s" : ""}
                  {activeFiltersCount > 0 && ` (filtered from ${baseRows.length})`}
                </span>
              </div>
            </div>
          )}
        </main>

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