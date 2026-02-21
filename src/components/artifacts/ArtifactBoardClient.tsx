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
  ChevronRight,
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
      return "Planning";
    case "WEEKLY_REPORT":
      return "Executing";
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
  if (hasAnyCurrent)
    return rows.map((r) => ({ ...r, isCurrent: booly(r.isCurrent) }));

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
   Phase Icons & Config
========================================================= */

const PHASE_CONFIG: Record<
  Phase,
  {
    icon: React.ElementType;
    gradient: string;
    accent: string;
    glow: string;
    bg: string;
    label: string;
    order: number;
  }
> = {
  Initiating: {
    icon: Target,
    gradient: "from-amber-500 to-orange-600",
    accent: "#f59e0b",
    glow: "shadow-amber-500/20",
    bg: "rgba(245, 158, 11, 0.06)",
    label: "Initiate",
    order: 0,
  },
  Planning: {
    icon: GitBranch,
    gradient: "from-sky-500 to-blue-600",
    accent: "#0ea5e9",
    glow: "shadow-sky-500/20",
    bg: "rgba(14, 165, 233, 0.06)",
    label: "Plan",
    order: 1,
  },
  Executing: {
    icon: Zap,
    gradient: "from-violet-500 to-purple-600",
    accent: "#8b5cf6",
    glow: "shadow-violet-500/20",
    bg: "rgba(139, 92, 246, 0.06)",
    label: "Execute",
    order: 2,
  },
  "Monitoring & Controlling": {
    icon: BarChart3,
    gradient: "from-cyan-500 to-teal-600",
    accent: "#06b6d4",
    glow: "shadow-cyan-500/20",
    bg: "rgba(6, 182, 212, 0.06)",
    label: "Monitor",
    order: 3,
  },
  Closing: {
    icon: Flag,
    gradient: "from-emerald-500 to-green-600",
    accent: "#10b981",
    glow: "shadow-emerald-500/20",
    bg: "rgba(16, 185, 129, 0.06)",
    label: "Close",
    order: 4,
  },
};

const STATUS_CONFIG: Record<
  UiStatus,
  { color: string; bg: string; border: string; dotColor: string }
> = {
  Draft: {
    color: "rgba(148, 163, 184, 1)",
    bg: "rgba(148, 163, 184, 0.08)",
    border: "rgba(148, 163, 184, 0.15)",
    dotColor: "#94a3b8",
  },
  "In review": {
    color: "rgba(96, 165, 250, 1)",
    bg: "rgba(96, 165, 250, 0.08)",
    border: "rgba(96, 165, 250, 0.15)",
    dotColor: "#60a5fa",
  },
  Approved: {
    color: "rgba(52, 211, 153, 1)",
    bg: "rgba(52, 211, 153, 0.08)",
    border: "rgba(52, 211, 153, 0.15)",
    dotColor: "#34d399",
  },
  Blocked: {
    color: "rgba(251, 113, 133, 1)",
    bg: "rgba(251, 113, 133, 0.08)",
    border: "rgba(251, 113, 133, 0.15)",
    dotColor: "#fb7185",
  },
};

/* =========================================================
   Styled Components
========================================================= */

function ArcProgress({
  value,
  size = 36,
  strokeWidth = 3,
  color,
}: {
  value: number;
  size?: number;
  strokeWidth?: number;
  color: string;
}) {
  const v = clampPct(value);
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (v / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4, 0, 0.2, 1)" }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-mono text-[10px] font-bold"
        style={{ color }}
      >
        {v}
      </span>
    </div>
  );
}

function StatusPill({ status }: { status: UiStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide uppercase"
      style={{
        color: cfg.color,
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: cfg.dotColor }}
      />
      {status}
    </span>
  );
}

function OwnerChip({ email, name }: { email: string; name?: string }) {
  const initials = initialsFromEmail(email);
  const displayName = name || email.split("@")[0] || "Unassigned";

  const hue = email
    ? email
        .split("")
        .reduce((a, c) => a + c.charCodeAt(0), 0) % 360
    : 220;

  return (
    <div className="flex items-center gap-2.5">
      <div
        className="h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold tracking-wider"
        style={{
          background: `hsla(${hue}, 60%, 55%, 0.15)`,
          color: `hsla(${hue}, 70%, 70%, 1)`,
          border: `1px solid hsla(${hue}, 60%, 55%, 0.2)`,
        }}
      >
        {initials}
      </div>
      <span className="text-[13px] text-[#c0c8d8] truncate max-w-[120px]">
        {displayName}
      </span>
    </div>
  );
}

function CurrentTag() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest"
      style={{
        background: "rgba(52, 211, 153, 0.1)",
        color: "#34d399",
        border: "1px solid rgba(52, 211, 153, 0.2)",
      }}
    >
      <CheckCircle2 className="h-3 w-3" />
      Live
    </span>
  );
}

function BaselineTag() {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest"
      style={{
        background: "rgba(255, 255, 255, 0.06)",
        color: "#94a3b8",
        border: "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      <Shield className="h-3 w-3" />
      Baseline
    </span>
  );
}

/* =========================================================
   Artifact Row
========================================================= */

function ArtifactRow({
  row,
  idx,
  phaseAccent,
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
  idx: number;
  phaseAccent: string;
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

  return (
    <div
      onClick={() => onOpen(row.id)}
      className="group relative grid items-center gap-4 px-5 py-4 cursor-pointer transition-all duration-200"
      style={{
        gridTemplateColumns: "1fr 160px 48px 110px auto",
        animationDelay: `${idx * 40}ms`,
        borderBottom: "1px solid rgba(255,255,255,0.04)",
        background: isCurrent ? "rgba(52, 211, 153, 0.03)" : "transparent",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.background = isCurrent
          ? "rgba(52, 211, 153, 0.06)"
          : "rgba(255,255,255,0.02)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.background = isCurrent
          ? "rgba(52, 211, 153, 0.03)"
          : "transparent";
      }}
    >
      {/* Left accent line for current */}
      {isCurrent && (
        <div
          className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full"
          style={{ background: "#34d399" }}
        />
      )}

      {/* Name + Tags */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] font-semibold text-white truncate">
            {row.artifactType}
          </span>
          {isCurrent && <CurrentTag />}
          {row.isBaseline && <BaselineTag />}
        </div>
        <p className="text-[12px] text-[#6b7a90] truncate">{row.title}</p>
      </div>

      {/* Owner */}
      <OwnerChip email={row.ownerEmail} name={row.ownerName} />

      {/* Progress */}
      <ArcProgress value={row.progress} color={phaseAccent} />

      {/* Status */}
      <StatusPill status={row.status} />

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 justify-end">
        {!isCurrent && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMakeCurrent(row.id);
            }}
            disabled={isMaking || !projectUuid || !looksLikeUuid(projectUuid)}
            className="p-1.5 rounded-md transition-colors disabled:opacity-30"
            style={{
              color: "#34d399",
              background: "rgba(52, 211, 153, 0.08)",
            }}
            title="Set as current"
          >
            {isMaking ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onClone(row.id);
          }}
          disabled={isCloning || !projectUuid || !looksLikeUuid(projectUuid)}
          className="p-1.5 rounded-md transition-colors disabled:opacity-30"
          style={{ color: "#60a5fa", background: "rgba(96, 165, 250, 0.08)" }}
          title="Clone"
        >
          {isCloning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>

        {canDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(row.id);
            }}
            disabled={isDeleting || !projectUuid || !looksLikeUuid(projectUuid)}
            className="p-1.5 rounded-md transition-colors disabled:opacity-30"
            style={{ color: "#fb7185", background: "rgba(251, 113, 133, 0.08)" }}
            title="Delete draft"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpen(row.id);
          }}
          className="p-1.5 rounded-md transition-colors"
          style={{ color: "#94a3b8", background: "rgba(148, 163, 184, 0.06)" }}
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   Phase Group
========================================================= */

function PhaseGroup({
  phase,
  rows,
  projectUuid,
  onOpen,
  onMakeCurrent,
  makingCurrentId,
  onClone,
  cloningId,
  onDelete,
  deletingId,
  animIndex,
}: {
  phase: Phase;
  rows: ArtifactBoardRow[];
  projectUuid: string;
  onOpen: (id: string) => void;
  onMakeCurrent: (id: string) => void;
  makingCurrentId: string;
  onClone: (id: string) => void;
  cloningId: string;
  onDelete: (id: string) => void;
  deletingId: string;
  animIndex: number;
}) {
  const cfg = PHASE_CONFIG[phase];
  const Icon = cfg.icon;

  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const ac = booly(a.isCurrent) ? 1 : 0;
      const bc = booly(b.isCurrent) ? 1 : 0;
      if (ac !== bc) return bc - ac;
      const ab = a.isBaseline ? 1 : 0;
      const bb = b.isBaseline ? 1 : 0;
      if (ab !== bb) return bb - ab;
      return (a.__idx ?? 0) - (b.__idx ?? 0);
    });
  }, [rows]);

  if (!sortedRows.length) return null;

  return (
    <div
      className="mb-8 animate-[fadeSlideUp_0.5s_ease-out_both]"
      style={{ animationDelay: `${animIndex * 80}ms` }}
    >
      {/* Phase Header */}
      <div className="flex items-center gap-3 mb-3 px-1">
        <div
          className={`h-8 w-8 rounded-lg bg-gradient-to-br ${cfg.gradient} flex items-center justify-center shadow-lg ${cfg.glow}`}
        >
          <Icon className="h-4 w-4 text-white" />
        </div>
        <div>
          <h3 className="text-[13px] font-bold text-white tracking-wide">
            {phase}
          </h3>
          <p className="text-[11px] text-[#5a6577]">
            {sortedRows.length} artifact{sortedRows.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Rows Container */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          background: "rgba(255,255,255,0.02)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* Table Header */}
        <div
          className="grid items-center gap-4 px-5 py-2.5"
          style={{
            gridTemplateColumns: "1fr 160px 48px 110px auto",
            borderBottom: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#4a5568]">
            Artifact
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#4a5568]">
            Owner
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#4a5568]">
            %
          </span>
          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#4a5568]">
            Status
          </span>
          <span />
        </div>

        {sortedRows.map((row, idx) => (
          <ArtifactRow
            key={row.id}
            row={row}
            idx={idx}
            phaseAccent={cfg.accent}
            projectUuid={projectUuid}
            onOpen={onOpen}
            onMakeCurrent={onMakeCurrent}
            makingCurrentId={makingCurrentId}
            onClone={onClone}
            cloningId={cloningId}
            onDelete={onDelete}
            deletingId={deletingId}
          />
        ))}
      </div>
    </div>
  );
}

/* =========================================================
   Stats Bar
========================================================= */

function StatsBar({ rows }: { rows: ArtifactBoardRow[] }) {
  const stats = useMemo(() => {
    const total = rows.length;
    const approved = rows.filter((r) => r.status === "Approved").length;
    const inReview = rows.filter((r) => r.status === "In review").length;
    const blocked = rows.filter((r) => r.status === "Blocked").length;
    const avgProgress = total
      ? Math.round(rows.reduce((s, r) => s + r.progress, 0) / total)
      : 0;
    return { total, approved, inReview, blocked, avgProgress };
  }, [rows]);

  const items = [
    {
      label: "Total",
      value: stats.total,
      color: "#94a3b8",
    },
    {
      label: "Approved",
      value: stats.approved,
      color: "#34d399",
    },
    {
      label: "In Review",
      value: stats.inReview,
      color: "#60a5fa",
    },
    {
      label: "Blocked",
      value: stats.blocked,
      color: "#fb7185",
    },
    {
      label: "Avg Progress",
      value: `${stats.avgProgress}%`,
      color: "#a78bfa",
    },
  ];

  return (
    <div className="flex items-center gap-6">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-2">
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: item.color }}
          />
          <span className="text-[11px] text-[#5a6577]">{item.label}</span>
          <span
            className="text-[12px] font-bold font-mono"
            style={{ color: item.color }}
          >
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/* =========================================================
   Search + Filters Overlay
========================================================= */

function CommandPalette({
  open,
  onClose,
  search,
  setSearch,
  statusSet,
  toggleStatus,
  phaseSet,
  togglePhase,
  clearAll,
  activeCount,
}: {
  open: boolean;
  onClose: () => void;
  search: string;
  setSearch: (v: string) => void;
  statusSet: Set<UiStatus>;
  toggleStatus: (s: UiStatus) => void;
  phaseSet: Set<Phase>;
  togglePhase: (p: Phase) => void;
  clearAll: () => void;
  activeCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      <div
        className="absolute inset-0 animate-[fadeIn_0.15s_ease-out]"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-lg rounded-2xl overflow-hidden animate-[fadeSlideUp_0.2s_ease-out]"
        style={{
          background: "#131821",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.05), 0 24px 80px -12px rgba(0,0,0,0.7)",
        }}
      >
        {/* Search */}
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <Search className="h-5 w-5 text-[#4a5568]" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artifacts, owners, titles..."
            className="flex-1 bg-transparent text-white text-[14px] outline-none placeholder-[#4a5568]"
            style={{
              fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
            }}
          />
          <kbd className="px-2 py-0.5 rounded text-[10px] font-mono text-[#4a5568] border border-[rgba(255,255,255,0.06)]">
            ESC
          </kbd>
        </div>

        {/* Filters */}
        <div className="px-5 py-4 space-y-4">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#4a5568] mb-2 block">
              Status
            </span>
            <div className="flex flex-wrap gap-2">
              {(["Draft", "In review", "Approved", "Blocked"] as UiStatus[]).map(
                (status) => {
                  const active = statusSet.has(status);
                  const cfg = STATUS_CONFIG[status];
                  return (
                    <button
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150"
                      style={{
                        background: active ? cfg.bg : "rgba(255,255,255,0.03)",
                        color: active ? cfg.color : "#5a6577",
                        border: `1px solid ${active ? cfg.border : "rgba(255,255,255,0.06)"}`,
                      }}
                    >
                      {status}
                    </button>
                  );
                }
              )}
            </div>
          </div>

          <div>
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[#4a5568] mb-2 block">
              Phase
            </span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  "Initiating",
                  "Planning",
                  "Executing",
                  "Monitoring & Controlling",
                  "Closing",
                ] as Phase[]
              ).map((phase) => {
                const active = phaseSet.has(phase);
                const cfg = PHASE_CONFIG[phase];
                return (
                  <button
                    key={phase}
                    onClick={() => togglePhase(phase)}
                    className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all duration-150"
                    style={{
                      background: active
                        ? `rgba(${hexToRgb(cfg.accent)}, 0.12)`
                        : "rgba(255,255,255,0.03)",
                      color: active ? cfg.accent : "#5a6577",
                      border: `1px solid ${active ? `rgba(${hexToRgb(cfg.accent)}, 0.2)` : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="w-full py-2 rounded-lg text-[11px] font-semibold text-[#5a6577] transition-colors"
              style={{
                border: "1px solid rgba(255,255,255,0.06)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              Clear all filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function hexToRgb(hex: string): string {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

/* =========================================================
   AI Panel (redesigned)
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
}: {
  open: boolean;
  onClose: () => void;
  projectUuid: string;
  projectCode: string;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");

  async function runCheck() {
    if (!projectUuid || !looksLikeUuid(projectUuid)) {
      setError("Invalid project UUID");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/ai/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventType: "artifact_due",
          windowDays: 14,
          project_id: projectUuid,
          project_human_id: projectCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;
  const items = result?.ai?.dueSoon || [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div
        className="absolute inset-0 animate-[fadeIn_0.15s_ease-out]"
        style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
        onClick={onClose}
      />

      <div
        className="relative w-full max-w-md max-h-[75vh] rounded-2xl overflow-hidden flex flex-col animate-[fadeSlideUp_0.2s_ease-out]"
        style={{
          background: "#131821",
          border: "1px solid rgba(255,255,255,0.08)",
          boxShadow:
            "0 0 0 1px rgba(255,255,255,0.05), 0 24px 80px -12px rgba(0,0,0,0.7)",
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center gap-2.5">
            <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <Sparkles className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-[13px] font-bold text-white">
              AI Assistant
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg"
            style={{ color: "#5a6577", background: "rgba(255,255,255,0.04)" }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {!result ? (
            <div className="text-center py-12">
              <div className="inline-flex items-center justify-center h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/20 to-purple-600/20 mb-4">
                <Clock className="h-7 w-7 text-violet-400" />
              </div>
              <p className="text-[13px] text-[#6b7a90] mb-5">
                Check what&apos;s coming up in the next 14 days
              </p>
              <button
                onClick={runCheck}
                disabled={loading}
                className="px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 transition-all disabled:opacity-50"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Scanning...
                  </span>
                ) : (
                  "Scan Due Dates"
                )}
              </button>
            </div>
          ) : error ? (
            <div
              className="p-4 rounded-xl text-[13px]"
              style={{
                background: "rgba(251,113,133,0.08)",
                color: "#fb7185",
                border: "1px solid rgba(251,113,133,0.15)",
              }}
            >
              {error}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12">
              <FileCheck className="h-8 w-8 text-emerald-400 mx-auto mb-3" />
              <p className="text-[13px] text-[#6b7a90]">
                Nothing due in the next 14 days
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((item: any, idx: number) => {
                const days = daysUntil(item.dueDate);
                const isOverdue = days !== null && days < 0;
                return (
                  <div
                    key={idx}
                    className="p-4 rounded-xl animate-[fadeSlideUp_0.3s_ease-out_both]"
                    style={{
                      background: "rgba(255,255,255,0.02)",
                      border: "1px solid rgba(255,255,255,0.06)",
                      animationDelay: `${idx * 60}ms`,
                    }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span
                        className="text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded"
                        style={{
                          background: "rgba(255,255,255,0.04)",
                          color: "#5a6577",
                        }}
                      >
                        {item.itemType || "Item"}
                      </span>
                      {days !== null && (
                        <span
                          className="text-[11px] font-bold font-mono"
                          style={{
                            color: isOverdue ? "#fb7185" : "#f59e0b",
                          }}
                        >
                          {isOverdue
                            ? `${Math.abs(days)}d overdue`
                            : `${days}d`}
                        </span>
                      )}
                    </div>
                    <h4 className="text-[13px] font-semibold text-white mb-1.5">
                      {item.title}
                    </h4>
                    <div className="flex items-center gap-2 text-[11px] text-[#5a6577] mb-3">
                      <Calendar className="h-3 w-3" />
                      {fmtUkDateOnly(item.dueDate)}
                    </div>
                    <div className="flex gap-2">
                      {item.link && (
                        <Link
                          href={normalizeArtifactLink(item.link)}
                          className="flex-1 px-3 py-1.5 rounded-lg text-center text-[11px] font-semibold text-white transition-colors"
                          style={{
                            background: "rgba(255,255,255,0.06)",
                            border: "1px solid rgba(255,255,255,0.08)",
                          }}
                        >
                          Open
                        </Link>
                      )}
                      <button
                        onClick={() =>
                          navigator.clipboard.writeText(
                            `Reminder: ${item.title} due ${fmtUkDateOnly(item.dueDate)}`
                          )
                        }
                        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white bg-gradient-to-r from-violet-600 to-purple-600"
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
      </div>
    </div>
  );
}

/* =========================================================
   Phase Timeline (top nav)
========================================================= */

function PhaseTimeline({
  phases,
  activePhases,
  togglePhase,
}: {
  phases: { phase: Phase; count: number }[];
  activePhases: Set<Phase>;
  togglePhase: (p: Phase) => void;
}) {
  const allPhases: Phase[] = [
    "Initiating",
    "Planning",
    "Executing",
    "Monitoring & Controlling",
    "Closing",
  ];
  const countMap = new Map(phases.map((p) => [p.phase, p.count]));

  return (
    <div className="flex items-center gap-1">
      {allPhases.map((phase, idx) => {
        const cfg = PHASE_CONFIG[phase];
        const Icon = cfg.icon;
        const count = countMap.get(phase) ?? 0;
        const active = activePhases.has(phase);
        const hasItems = count > 0;

        return (
          <React.Fragment key={phase}>
            {idx > 0 && (
              <div
                className="w-6 h-[1px]"
                style={{
                  background: hasItems
                    ? "rgba(255,255,255,0.1)"
                    : "rgba(255,255,255,0.04)",
                }}
              />
            )}
            <button
              onClick={() => togglePhase(phase)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all duration-200"
              style={{
                background: active
                  ? `rgba(${hexToRgb(cfg.accent)}, 0.12)`
                  : hasItems
                    ? "rgba(255,255,255,0.03)"
                    : "transparent",
                border: `1px solid ${active ? `rgba(${hexToRgb(cfg.accent)}, 0.2)` : "rgba(255,255,255,0.04)"}`,
                opacity: hasItems ? 1 : 0.4,
              }}
            >
              <Icon
                className="h-3.5 w-3.5"
                style={{ color: active ? cfg.accent : "#5a6577" }}
              />
              <span
                className="text-[11px] font-semibold hidden lg:inline"
                style={{ color: active ? cfg.accent : "#5a6577" }}
              >
                {cfg.label}
              </span>
              {count > 0 && (
                <span
                  className="text-[10px] font-bold font-mono"
                  style={{ color: active ? cfg.accent : "#4a5568" }}
                >
                  {count}
                </span>
              )}
            </button>
          </React.Fragment>
        );
      })}
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
              artifactType:
                canonType(a?.type) || safeStr(a?.type) || "Artifact",
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

  const [commandOpen, setCommandOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusSet, setStatusSet] = useState<Set<UiStatus>>(new Set());
  const [phaseSet, setPhaseSet] = useState<Set<Phase>>(new Set());

  // Keyboard shortcut
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
        const text = [r.artifactType, r.title, r.ownerEmail, r.ownerName]
          .join(" ")
          .toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [baseRows, search, statusSet, phaseSet]);

  const grouped = useMemo(() => {
    const phases: Phase[] = [
      "Initiating",
      "Planning",
      "Executing",
      "Monitoring & Controlling",
      "Closing",
    ];
    return phases
      .map((phase) => ({
        phase,
        rows: filteredRows.filter((r) => r.phase === phase),
      }))
      .filter((g) => g.rows.length > 0);
  }, [filteredRows]);

  const phaseCounts = useMemo(() => {
    const allPhases: Phase[] = [
      "Initiating",
      "Planning",
      "Executing",
      "Monitoring & Controlling",
      "Closing",
    ];
    return allPhases.map((phase) => ({
      phase,
      count: baseRows.filter((r) => r.phase === phase).length,
    }));
  }, [baseRows]);

  const activeFiltersCount =
    (search ? 1 : 0) + statusSet.size + phaseSet.size;

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
    if (!projectUuid || !looksLikeUuid(projectUuid)) {
      setActionError("Invalid project UUID");
      return;
    }
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
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setCloningId("");
    }
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
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setDeletingId("");
    }
  };

  const handleMakeCurrent = async (id: string) => {
    if (!projectUuid || !looksLikeUuid(projectUuid)) return;
    setMakingCurrentId(id);
    try {
      await setArtifactCurrentAction({
        projectId: projectUuid,
        artifactId: id,
      });
      router.refresh();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setMakingCurrentId("");
    }
  };

  return (
    <>
      {/* Global Styles & Fonts */}
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Instrument+Sans:wght@400;500;600;700&display=swap");

        @keyframes fadeSlideUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.8; }
        }
        @keyframes shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }

        .artifact-board * {
          font-family: "Instrument Sans", -apple-system, BlinkMacSystemFont,
            "Segoe UI", sans-serif;
        }
        .artifact-board .font-mono {
          font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
        }

        /* Scrollbar */
        .artifact-board ::-webkit-scrollbar {
          width: 6px;
        }
        .artifact-board ::-webkit-scrollbar-track {
          background: transparent;
        }
        .artifact-board ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 3px;
        }
        .artifact-board ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.15);
        }
      `}</style>

      <div
        className="artifact-board min-h-screen"
        style={{
          background: "#0b0f17",
          color: "#e2e8f0",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        }}
      >
        {/* Subtle grain overlay */}
        <div
          className="fixed inset-0 pointer-events-none z-0"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.015'/%3E%3C/svg%3E")`,
            backgroundRepeat: "repeat",
          }}
        />

        {/* Top gradient accent */}
        <div
          className="fixed top-0 left-0 right-0 h-[200px] pointer-events-none z-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% -10%, rgba(99, 102, 241, 0.08) 0%, transparent 70%)",
          }}
        />

        {/* ========== HEADER ========== */}
        <header
          className="sticky top-0 z-40 relative"
          style={{
            background: "rgba(11, 15, 23, 0.85)",
            backdropFilter: "blur(20px) saturate(180%)",
            borderBottom: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <div className="max-w-[1280px] mx-auto px-6">
            {/* Top Row */}
            <div className="flex items-center justify-between py-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3">
                  <div
                    className="h-9 w-9 rounded-xl flex items-center justify-center"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15))",
                      border: "1px solid rgba(99, 102, 241, 0.2)",
                    }}
                  >
                    <Layers className="h-4.5 w-4.5 text-indigo-400" />
                  </div>
                  <div>
                    <h1
                      className="text-[16px] font-bold text-white tracking-tight"
                      style={{
                        fontFamily:
                          "'JetBrains Mono', 'SF Mono', monospace",
                      }}
                    >
                      Artifacts
                    </h1>
                    <p className="text-[11px] text-[#4a5568]">
                      {projectName || "Project"}
                      {projectCode && (
                        <span
                          className="ml-2 font-mono px-1.5 py-0.5 rounded"
                          style={{
                            background: "rgba(255,255,255,0.04)",
                            color: "#5a6577",
                          }}
                        >
                          {projectCode}
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Search Trigger */}
                <button
                  onClick={() => setCommandOpen(true)}
                  className="flex items-center gap-3 px-3.5 py-2 rounded-xl transition-all duration-200"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <Search className="h-4 w-4 text-[#4a5568]" />
                  <span className="text-[12px] text-[#4a5568] hidden sm:inline">
                    Search & filter...
                  </span>
                  <kbd
                    className="hidden sm:inline px-1.5 py-0.5 rounded text-[10px] font-mono text-[#3a4558]"
                    style={{ border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    ⌘K
                  </kbd>
                  {activeFiltersCount > 0 && (
                    <span
                      className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
                      style={{
                        background: "rgba(99, 102, 241, 0.15)",
                        color: "#818cf8",
                      }}
                    >
                      {activeFiltersCount}
                    </span>
                  )}
                </button>

                {/* AI Button */}
                <button
                  onClick={() => setAiOpen(true)}
                  disabled={!projectUuid || !looksLikeUuid(projectUuid)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all disabled:opacity-30"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(139, 92, 246, 0.15), rgba(168, 85, 247, 0.15))",
                    border: "1px solid rgba(139, 92, 246, 0.2)",
                    color: "#a78bfa",
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI
                </button>
              </div>
            </div>

            {/* Phase Timeline */}
            <div
              className="pb-3 -mx-1 flex items-center justify-between"
              style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}
            >
              <div className="pt-3">
                <PhaseTimeline
                  phases={phaseCounts}
                  activePhases={phaseSet}
                  togglePhase={togglePhase}
                />
              </div>
              <div className="pt-3 hidden md:block">
                <StatsBar rows={filteredRows} />
              </div>
            </div>
          </div>
        </header>

        {/* ========== ERROR BAR ========== */}
        {actionError && (
          <div className="max-w-[1280px] mx-auto px-6 pt-4 relative z-10">
            <div
              className="flex items-center gap-3 px-4 py-3 rounded-xl text-[13px] animate-[fadeSlideUp_0.2s_ease-out]"
              style={{
                background: "rgba(251, 113, 133, 0.08)",
                border: "1px solid rgba(251, 113, 133, 0.15)",
                color: "#fb7185",
              }}
            >
              <AlertCircle className="h-4 w-4" />
              {actionError}
              <button
                onClick={() => setActionError("")}
                className="ml-auto p-1"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* ========== CONTENT ========== */}
        <main className="max-w-[1280px] mx-auto px-6 py-8 relative z-10">
          {grouped.length === 0 ? (
            <div className="text-center py-24 animate-[fadeIn_0.5s_ease-out]">
              <div
                className="inline-flex items-center justify-center h-16 w-16 rounded-2xl mb-5"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <Layers className="h-7 w-7 text-[#3a4558]" />
              </div>
              <p className="text-[14px] text-[#4a5568] mb-1">
                No artifacts found
              </p>
              <p className="text-[12px] text-[#3a4558]">
                {activeFiltersCount > 0
                  ? "Try adjusting your filters"
                  : "Create your first artifact to get started"}
              </p>
            </div>
          ) : (
            grouped.map(({ phase, rows }, gIdx) => (
              <PhaseGroup
                key={phase}
                phase={phase}
                rows={rows}
                projectUuid={projectUuid}
                onOpen={openArtifact}
                onMakeCurrent={handleMakeCurrent}
                makingCurrentId={makingCurrentId}
                onClone={handleClone}
                cloningId={cloningId}
                onDelete={handleDelete}
                deletingId={deletingId}
                animIndex={gIdx}
              />
            ))
          )}
        </main>

        {/* ========== OVERLAYS ========== */}
        <CommandPalette
          open={commandOpen}
          onClose={() => setCommandOpen(false)}
          search={search}
          setSearch={setSearch}
          statusSet={statusSet}
          toggleStatus={toggleStatus}
          phaseSet={phaseSet}
          togglePhase={togglePhase}
          clearAll={clearAll}
          activeCount={activeFiltersCount}
        />

        <AiPanel
          open={aiOpen}
          onClose={() => setAiOpen(false)}
          projectUuid={projectUuid}
          projectCode={projectCode || projectHumanId}
        />
      </div>
    </>
  );
}