"use client";

// src/components/artifacts/ArtifactBoardClient.tsx

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Target,
  GitBranch,
  Zap,
  BarChart3,
  Flag,
  CheckCircle2,
  Shield,
  Search,
  X,
  ChevronDown,
  Filter,
  Sparkles,
  AlertCircle,
  Loader2,
  Copy,
  Trash2,
  ArrowUpRight,
  Layers,
  Calendar,
  FileCheck,
  Clock,
  Plus,
} from "lucide-react";
import { portfolioGlobalCss } from "@/lib/ui/portfolioTheme";

/* =========================================================
   Types
========================================================= */

type UiStatus = "Draft" | "In review" | "Approved" | "Blocked";

type Phase =
  | "Initiating"
  | "Planning"
  | "Executing"
  | "Monitoring & Controlling"
  | "Closing";

type ArtifactBoardRow = {
  id: string;
  artifactType: string;
  title: string;
  ownerEmail: string;
  ownerName: string;
  progress: number;
  status: UiStatus;
  phase: Phase;
  isBaseline?: boolean;
  isCurrent?: boolean;
  isLocked?: boolean;
  typeKey?: string;
  href?: string;
  canDeleteDraft?: boolean;
  deletedAt?: string | null;
  __idx?: number;
};

/* =========================================================
   Constants
   Only charter and closure can be created / cloned / deleted
   from this board. All other artifact types are read-only rows.
========================================================= */

const CREATABLE_TYPES = new Set(["PROJECT_CHARTER", "PROJECT_CLOSURE_REPORT"]);

const BOARD_MANAGEABLE_TYPES = new Set([
  "WEEKLY_REPORT",
  "PROJECT_CHARTER",
  "STAKEHOLDER_REGISTER",
  "WBS",
  "SCHEDULE",
  "FINANCIAL_PLAN",
  "CHANGE_REQUESTS",
  "CHANGE_REQUEST",
  "CHANGE",
  "RAID",
  "RAID_LOG",
  "LESSONS_LEARNED",
  "PROJECT_CLOSURE_REPORT",
  "GOVERNANCE",
  "GOVERNANCE_HUB",
]);

function phaseForCanonType(typeKey: string): Phase {
  const t = (typeKey || "").toUpperCase();
  if (["PROJECT_CHARTER", "STAKEHOLDER_REGISTER"].includes(t)) return "Initiating";
  if (["WBS", "SCHEDULE", "FINANCIAL_PLAN", "RAID", "RAID_LOG"].includes(t)) return "Planning";
  if (["WEEKLY_REPORT", "CHANGE_REQUESTS", "CHANGE_REQUEST", "CHANGE"].includes(t))
    return "Executing";
  if (["LESSONS_LEARNED", "GOVERNANCE", "GOVERNANCE_HUB"].includes(t))
    return "Monitoring & Controlling";
  if (["PROJECT_CLOSURE_REPORT"].includes(t)) return "Closing";
  return "Executing";
}

/* =========================================================
   Utilities
========================================================= */

function safeStr(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}
function safeLower(value: unknown): string {
  return safeStr(value).trim().toLowerCase();
}
function safeNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function booly(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  return ["true", "t", "yes", "y", "1"].includes(safeLower(value));
}
function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    safeStr(value).trim(),
  );
}
function clampPct(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function fmtUkDateOnly(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    }).format(date);
  } catch { return iso; }
}
function daysUntil(iso: string | null | undefined): number | null {
  const raw = safeStr(iso).trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}
function initialsFromEmail(email: string): string {
  const normalized = safeStr(email).trim().toLowerCase();
  if (!normalized) return "—";
  const local = normalized.split("@")[0] || normalized;
  const parts = local.split(/[.\-_+]/g).filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const last = parts[parts.length - 1]?.[0] ?? "";
    return (first + last).toUpperCase() || local.slice(0, 2).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}
function extractProjectRefFromHref(href: string): string | null {
  const match = safeStr(href).trim().match(/\/projects\/([^\/?#]+)/i);
  return match?.[1] ? String(match[1]) : null;
}
function normalizeArtifactLink(href: string): string {
  const raw = safeStr(href).trim();
  if (!raw) return "";
  const hashIndex = raw.indexOf("#");
  const queryIndex = raw.indexOf("?");
  const cutIndex =
    queryIndex >= 0 && hashIndex >= 0
      ? Math.min(queryIndex, hashIndex)
      : queryIndex >= 0 ? queryIndex : hashIndex >= 0 ? hashIndex : -1;
  const path = cutIndex >= 0 ? raw.slice(0, cutIndex) : raw;
  const suffix = cutIndex >= 0 ? raw.slice(cutIndex) : "";
  const normalizedPath = path
    .replace(/\/raid(\/|$)/gi, "/raid$1")
    .replace(/\/wbs(\/|$)/gi, "/wbs$1")
    .replace(/\/schedule(\/|$)/gi, "/schedule$1")
    .replace(/\/change(\/|$)/gi, "/change$1")
    .replace(/\/changes(\/|$)/gi, "/change$1")
    .replace(/\/change_requests(\/|$)/gi, "/change$1")
    .replace(/\/artifacts(\/|$)/gi, "/artifacts$1");
  return `${normalizedPath}${suffix}`;
}

interface AiItemMeta {
  project_id?: string;
  project_code?: string;
  project_name?: string;
  project_human_id?: string;
  sourceArtifactId?: string;
  artifactId?: string;
}
interface AiItem {
  href?: string;
  link?: string;
  meta?: AiItemMeta;
  project_id?: string;
  itemType?: string;
  kind?: string;
  type?: string;
  artifact_id?: string;
  artifactId?: string;
}
function aiItemHref(args: { item: AiItem | unknown; fallbackProjectRef: string }): string {
  const { item, fallbackProjectRef } = args;
  const it = item as AiItem;
  const rawLink = safeStr(it?.href || it?.link || "").trim();
  const normalizedLink = rawLink ? normalizeArtifactLink(rawLink) : "";
  if (normalizedLink.startsWith("/")) return normalizedLink;
  const meta = it?.meta ?? {};
  const projectUuid = safeStr(meta?.project_id).trim() || safeStr(it?.project_id).trim() || "";
  const projectHumanRef =
    safeStr(meta?.project_human_id).trim() ||
    safeStr(meta?.project_code).trim() ||
    extractProjectRefFromHref(normalizedLink) || "";
  const projectRef = projectUuid || projectHumanRef || fallbackProjectRef;
  if (!projectRef) return "/projects";
  const kind = safeLower(it?.itemType || it?.kind || it?.type || "");
  const artifactId = safeStr(
    meta?.sourceArtifactId || meta?.artifactId || it?.artifact_id || it?.artifactId || "",
  ).trim();
  if (artifactId && looksLikeUuid(artifactId)) {
    const params = new URLSearchParams();
    params.set("artifactId", artifactId);
    if (kind.includes("milestone") || kind.includes("schedule")) params.set("panel", "schedule");
    else if (kind.includes("work_item") || kind.includes("wbs")) params.set("panel", "wbs");
    else if (kind.includes("change")) params.set("panel", "change");
    return `/projects/${projectRef}/artifacts?${params.toString()}`;
  }
  if (kind.includes("milestone") || kind.includes("schedule")) return `/projects/${projectRef}/artifacts?panel=schedule`;
  if (kind.includes("work_item") || kind.includes("wbs")) return `/projects/${projectRef}/artifacts?panel=wbs`;
  if (kind.includes("raid") || kind.includes("risk") || kind.includes("issue") || kind.includes("dependency")) return `/projects/${projectRef}/raid`;
  if (kind.includes("change")) return `/projects/${projectRef}/change`;
  return `/projects/${projectRef}`;
}

/* =========================================================
   Type Mapping
========================================================= */

function canonType(value: unknown): string {
  const raw = safeLower(value);
  if (!raw) return "";
  const normalized = raw.replace(/\s+/g, " ").replace(/[\/]+/g, " / ").replace(/[_-]+/g, "_").trim();
  if (["governance", "delivery_governance", "delivery governance", "governance_hub", "governance hub"].includes(normalized)) return "GOVERNANCE";
  if (["weekly_report","weekly report","weekly_status","weekly status","weekly_update","weekly update","delivery_report","delivery report","status_report","status report"].includes(normalized)) return "WEEKLY_REPORT";
  if (normalized === "status_dashboard" || normalized === "status dashboard") return "PROJECT_CLOSURE_REPORT";
  if (normalized.includes("charter") || normalized === "pid") return "PROJECT_CHARTER";
  if (normalized.includes("stakeholder")) return "STAKEHOLDER_REGISTER";
  if (normalized === "wbs" || normalized.includes("work breakdown")) return "WBS";
  if (normalized.includes("schedule") || normalized.includes("roadmap") || normalized.includes("gantt")) return "SCHEDULE";
  if (["financial_plan","financial plan","financial","budget_plan","budget plan","financials"].includes(normalized)) return "FINANCIAL_PLAN";
  if (normalized.includes("change")) return "CHANGE_REQUESTS";
  if (normalized.includes("raid")) return "RAID";
  if (normalized.includes("lessons") || normalized.includes("retro")) return "LESSONS_LEARNED";
  if (normalized.includes("closure") || normalized.includes("closeout")) return "PROJECT_CLOSURE_REPORT";
  return normalized.toUpperCase().replace(/\s+/g, "_");
}

interface ArtifactLike { approval_status?: string; is_baseline?: boolean; is_locked?: boolean; }

function statusForArtifactLike(value: ArtifactLike | unknown): UiStatus {
  const artifact = value as ArtifactLike;
  const approval = safeLower(artifact?.approval_status);
  if (approval === "approved" || artifact?.is_baseline) return "Approved";
  if (["submitted", "review", "in_review"].includes(approval)) return "In review";
  if (artifact?.is_locked) return "In review";
  if (approval === "rejected") return "Blocked";
  return "Draft";
}
function progressForArtifactLike(value: ArtifactLike | unknown): number {
  const artifact = value as ArtifactLike;
  const approval = safeLower(artifact?.approval_status);
  if (artifact?.is_baseline) return 100;
  if (approval === "approved") return 95;
  if (["submitted", "review", "in_review"].includes(approval)) return 70;
  if (approval === "changes_requested") return 45;
  if (approval === "rejected") return 0;
  if (artifact?.is_locked) return 70;
  return 20;
}
function applyCurrentFallback(rows: ArtifactBoardRow[]): ArtifactBoardRow[] {
  if (!rows.length) return rows;
  const hasAnyCurrent = rows.some((row) => booly(row.isCurrent));
  if (hasAnyCurrent) return rows.map((row) => ({ ...row, isCurrent: booly(row.isCurrent) }));
  const seenTypes = new Set<string>();
  return rows.map((row) => {
    const typeKey = safeStr(row.typeKey || canonType(row.artifactType)).trim() || safeStr(row.artifactType).trim();
    const key = typeKey || row.id;
    const isCurrent = !seenTypes.has(key);
    if (isCurrent) seenTypes.add(key);
    return { ...row, typeKey, isCurrent };
  });
}

/* =========================================================
   Virtual/module rows
========================================================= */

interface VirtualRow extends ArtifactBoardRow { isVirtual?: boolean; }

function rowTypeKey(row: ArtifactBoardRow): string {
  return safeStr(row.typeKey || canonType(row.artifactType) || row.artifactType).trim().toUpperCase();
}
function isVirtualRow(row: VirtualRow | unknown): boolean {
  const candidate = row as VirtualRow;
  if (booly(candidate?.isVirtual)) return true;
  const id = safeStr(candidate?.id).trim();
  return id.startsWith("__") || !looksLikeUuid(id);
}
function rowHref(projectRef: string, row: VirtualRow | unknown): string {
  const candidate = row as VirtualRow;
  const directHref = safeStr(candidate?.href).trim();
  if (directHref) return normalizeArtifactLink(directHref);
  if (!projectRef) return "/projects";
  const typeKey = rowTypeKey(candidate);
  if (typeKey === "CHANGE_REQUESTS" || typeKey === "CHANGE" || typeKey === "CHANGE_REQUEST") return `/projects/${projectRef}/change`;
  if (typeKey === "RAID" || typeKey === "RAID_LOG") return `/projects/${projectRef}/raid`;
  if (typeKey === "GOVERNANCE") return `/projects/${projectRef}/governance`;
  const id = safeStr(candidate.id).trim();
  if (id === "__financial_plan__") return `/projects/${projectRef}/artifacts/new?type=financial_plan`;
  return `/projects/${projectRef}/artifacts/${id}`;
}
function rowOpensArtifactDetail(row: ArtifactBoardRow): boolean {
  const typeKey = rowTypeKey(row);
  if (typeKey === "CHANGE_REQUESTS" || typeKey === "CHANGE" || typeKey === "CHANGE_REQUEST") return false;
  if (typeKey === "RAID" || typeKey === "RAID_LOG") return false;
  if (typeKey === "GOVERNANCE") return false;
  return true;
}

/* =========================================================
   Phase & Status Config
========================================================= */

const PHASE_CONFIG: Record<Phase, { icon: React.ElementType; color: string; bg: string; label: string; order: number }> = {
  Initiating:               { icon: Target,   color: "var(--ui-warning)",  bg: "var(--ui-warningSoft)",              label: "Initiate", order: 0 },
  Planning:                 { icon: GitBranch,color: "var(--ui-accent)",   bg: "var(--ui-accentSoft)",               label: "Plan",     order: 1 },
  Executing:                { icon: Zap,       color: "#7C3AED",            bg: "#F5F3FF",                            label: "Execute",  order: 2 },
  "Monitoring & Controlling":{ icon: BarChart3,color: "var(--ui-accent)",  bg: "rgba(12,184,182,0.10)",              label: "Monitor",  order: 3 },
  Closing:                  { icon: Flag,      color: "var(--ui-success)",  bg: "var(--ui-successSoft)",              label: "Close",    order: 4 },
};

const STATUS_STYLES: Record<UiStatus, { color: string; bg: string; dot: string }> = {
  Draft:      { color: "var(--ui-muted)",   bg: "var(--ui-panelAlt)",   dot: "var(--ui-faint)"   },
  "In review":{ color: "var(--ui-accent)",  bg: "var(--ui-accentSoft)", dot: "var(--ui-accent)"  },
  Approved:   { color: "var(--ui-success)", bg: "var(--ui-successSoft)",dot: "var(--ui-success)" },
  Blocked:    { color: "var(--ui-danger)",  bg: "var(--ui-dangerSoft)", dot: "var(--ui-danger)"  },
};

/* =========================================================
   Spreadsheet Components
========================================================= */

function ProgressBar({ value, color }: { value: number; color: string }) {
  const pct = clampPct(value);
  return (
    <div className="flex w-full items-center gap-2.5">
      <div className="h-[4px] flex-1 overflow-hidden rounded-full" style={{ background: "var(--ui-border)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color, transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)" }} />
      </div>
      <span className="artifact-mono text-[11px] font-medium" style={{ color: "var(--ui-faint)", minWidth: 30, textAlign: "right" }}>{pct}%</span>
    </div>
  );
}

function StatusBadge({ status }: { status: UiStatus }) {
  const style = STATUS_STYLES[status];
  return (
    <span className="artifact-mono inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[9px] font-medium uppercase tracking-[0.08em]" style={{ color: style.color, background: style.bg }}>
      <span className="h-[6px] w-[6px] rounded-full" style={{ background: style.dot }} />
      {status}
    </span>
  );
}
function PhaseBadge({ phase }: { phase: Phase }) {
  const config = PHASE_CONFIG[phase];
  const Icon = config.icon;
  return (
    <span className="artifact-mono inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[9px] font-medium uppercase tracking-[0.08em]" style={{ color: config.color, background: config.bg }}>
      <Icon className="h-3 w-3" />{config.label}
    </span>
  );
}
function AvatarChip({ email, name }: { email: string; name?: string }) {
  const initials = initialsFromEmail(email);
  const displayName = name || email.split("@")[0] || "Unassigned";
  const hue = email ? email.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360 : 220;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold" style={{ background: `hsl(${hue},55%,92%)`, color: `hsl(${hue},60%,35%)` }}>{initials}</div>
      <span className="truncate text-[13px]" style={{ color: "var(--ui-text-soft)" }}>{displayName}</span>
    </div>
  );
}
function TagPill({ children, color, bg }: { children: ReactNode; color: string; bg: string }) {
  return (
    <span className="artifact-mono inline-flex items-center gap-1 rounded-full px-1.5 py-[2px] text-[9px] font-medium uppercase tracking-[0.08em]" style={{ color, background: bg }}>
      {children}
    </span>
  );
}

/* =========================================================
   Table Row
========================================================= */

const COL_TEMPLATE = "minmax(320px, 2fr) 220px 170px 150px 150px 110px";

function ArtifactTableRow({
  row, projectRef, projectUuid, onOpen,
  onMakeCurrent, makingCurrentId,
  onClone, cloningId,
  onDelete, deletingId,
}: {
  row: ArtifactBoardRow; projectRef: string; projectUuid: string;
  onOpen: (row: ArtifactBoardRow) => void;
  onMakeCurrent: (id: string) => void; makingCurrentId: string;
  onClone: (id: string) => void; cloningId: string;
  onDelete: (id: string) => void; deletingId: string;
}) {
  const isCurrent = booly(row.isCurrent);
  const isMaking  = makingCurrentId === row.id;
  const isCloning = cloningId === row.id;
  const isDeleting = deletingId === row.id;
  const virtual    = isVirtualRow(row);
  const opensArtifact = rowOpensArtifactDetail(row);
  const typeKey    = rowTypeKey(row);

  // ── Restricted actions: only charter and closure ──────────────────────────
  const isCreatableType = CREATABLE_TYPES.has(typeKey);
  const canDelete = !virtual && isCreatableType && row.canDeleteDraft !== false &&
    row.status === "Draft" && !row.isBaseline && !row.isLocked && !row.deletedAt;
  const canClone  = !virtual && isCreatableType;
  const canMakeCurrent = !virtual && opensArtifact && BOARD_MANAGEABLE_TYPES.has(typeKey);

  const phaseConfig = PHASE_CONFIG[row.phase];
  const openHref    = rowHref(projectRef, row);

  return (
    <div
      onClick={() => onOpen(row)}
      className="artifact-row group relative grid cursor-pointer items-center"
      style={{ gridTemplateColumns: COL_TEMPLATE, borderBottom: "1px solid var(--ui-border)", minHeight: 68, background: "var(--ui-panel)" }}
    >
      <div className="flex h-full min-w-0 items-center gap-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="truncate" style={{ fontSize: 15, fontWeight: 650, color: "var(--ui-text)", letterSpacing: "-0.01em" }}>
              {row.title || row.artifactType}
            </span>
            {isCurrent && (
              <TagPill color="var(--ui-success)" bg="var(--ui-successSoft)">
                <CheckCircle2 className="h-2.5 w-2.5" />live
              </TagPill>
            )}
            {row.isBaseline && (
              <TagPill color="var(--ui-muted)" bg="var(--ui-panelAlt)">
                <Shield className="h-2.5 w-2.5" />baseline
              </TagPill>
            )}
            {virtual && <TagPill color="var(--ui-muted)" bg="var(--ui-panelAlt)">module</TagPill>}
          </div>
          <span className="artifact-mono block truncate" style={{ fontSize: 10, fontWeight: 400, color: "var(--ui-faint)", letterSpacing: "0.04em", marginTop: 4 }}>
            {row.artifactType}
          </span>
        </div>
      </div>

      <div className="flex h-full items-center px-4 py-3" style={{ borderLeft: "1px solid var(--ui-border)" }}>
        <AvatarChip email={row.ownerEmail} name={row.ownerName} />
      </div>
      <div className="flex h-full items-center px-4 py-3" style={{ borderLeft: "1px solid var(--ui-border)" }}>
        <PhaseBadge phase={row.phase} />
      </div>
      <div className="flex h-full items-center px-4 py-3" style={{ borderLeft: "1px solid var(--ui-border)" }}>
        <StatusBadge status={row.status} />
      </div>
      <div className="flex h-full items-center px-4 py-3" style={{ borderLeft: "1px solid var(--ui-border)" }}>
        <ProgressBar value={row.progress} color={phaseConfig.color} />
      </div>

      <div className="flex h-full items-center justify-end gap-1 px-3 py-3" style={{ borderLeft: "1px solid var(--ui-border)" }}>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {!isCurrent && canMakeCurrent && (
            <button
              onClick={(e) => { e.stopPropagation(); onMakeCurrent(row.id); }}
              disabled={isMaking || !projectUuid || !looksLikeUuid(projectUuid)}
              className="rounded p-1.5 transition-colors disabled:opacity-30"
              style={{ color: "var(--ui-success)" }}
              title="Set as current"
            >
              {isMaking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            </button>
          )}
          {canClone && (
            <button
              onClick={(e) => { e.stopPropagation(); onClone(row.id); }}
              disabled={isCloning || !projectUuid || !looksLikeUuid(projectUuid)}
              className="rounded p-1.5 transition-colors disabled:opacity-30"
              style={{ color: "var(--ui-accent)" }}
              title="Clone"
            >
              {isCloning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          )}
          {canDelete && (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(row.id); }}
              disabled={isDeleting || !projectUuid || !looksLikeUuid(projectUuid)}
              className="rounded p-1.5 transition-colors disabled:opacity-30"
              style={{ color: "var(--ui-danger)" }}
              title="Delete draft"
            >
              {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            </button>
          )}
          <Link
            href={openHref}
            onClick={(e) => e.stopPropagation()}
            className="rounded p-1.5 transition-colors"
            style={{ color: "var(--ui-muted)" }}
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
   New Artifact Button (charter / closure only)
========================================================= */

function NewArtifactButton({ projectRef, projectUuid, hasCharter, hasClosure, onCreateArtifact }: {
  projectRef: string;
  projectUuid: string;
  hasCharter: boolean;
  hasClosure: boolean;
  onCreateArtifact: (type: string) => Promise<void>;
}) {
  const [open, setOpen]         = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const items = [
    {
      type: "PROJECT_CHARTER",
      label: "Project Charter",
      desc: "Initiating phase",
      disabled: hasCharter,
      disabledMsg: "A current charter already exists",
    },
    {
      type: "PROJECT_CLOSURE_REPORT",
      label: "Project Closure Report",
      desc: "Closing phase",
      disabled: hasClosure,
      disabledMsg: "A current closure report already exists",
    },
  ];

  async function handleCreate(type: string) {
    setCreating(type);
    setCreateErr("");
    setOpen(false);
    try {
      await onCreateArtifact(type);
    } catch (e: any) {
      setCreateErr(e?.message || "Failed to create artifact");
    } finally {
      setCreating(null);
    }
  }

  return (
    <div ref={ref} style={{ position: "relative" }}>
      {createErr && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 8px)", right: 0,
          background: "var(--ui-dangerSoft)", border: "1px solid var(--ui-border)",
          color: "var(--ui-danger)", fontSize: 12, padding: "8px 12px",
          borderRadius: 8, whiteSpace: "nowrap", zIndex: 400,
        }}>
          {createErr}
          <button onClick={() => setCreateErr("")} style={{ marginLeft: 8, fontWeight: 700, background: "none", border: "none", cursor: "pointer", color: "inherit" }}>×</button>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        disabled={!!creating}
        className="inline-flex items-center gap-1.5 px-4 py-[10px] rounded-xl text-[12px] font-semibold transition-colors disabled:opacity-50"
        style={{ background: "var(--ui-text)", color: "#ffffff", border: "1px solid transparent" }}
      >
        {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        {creating ? "Creating..." : "New artifact"}
        {!creating && <ChevronDown className={`h-3 w-3 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", right: 0,
          width: 260, background: "var(--ui-panel)", border: "1px solid var(--ui-border)",
          borderRadius: 12, boxShadow: "0 10px 40px rgba(0,0,0,0.12)", zIndex: 300,
          overflow: "hidden",
        }}>
          <div style={{ padding: "8px 12px 6px", borderBottom: "1px solid var(--ui-border)" }}>
            <span className="artifact-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ui-faint)" }}>
              Create artifact
            </span>
          </div>
          {items.map((item) => (
            <div key={item.type} style={{ padding: "2px 6px" }}>
              {item.disabled ? (
                <div style={{ display: "flex", flexDirection: "column", padding: "10px 8px", borderRadius: 8, opacity: 0.45, cursor: "not-allowed" }} title={item.disabledMsg}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ui-text)" }}>{item.label}</span>
                  <span className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)", marginTop: 2 }}>{item.disabledMsg}</span>
                </div>
              ) : (
                <button
                  onClick={() => handleCreate(item.type)}
                  disabled={!!creating}
                  style={{
                    display: "flex", flexDirection: "column", padding: "10px 8px", width: "100%",
                    borderRadius: 8, textAlign: "left", background: "transparent", border: "none",
                    cursor: "pointer", transition: "background 0.1s", fontFamily: "inherit",
                    opacity: creating ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--ui-panelAlt)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ui-text)" }}>{item.label}</span>
                  <span className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)", marginTop: 2 }}>{item.desc}</span>
                </button>
              )}
            </div>
          ))}
          <div style={{ padding: "6px 12px 8px", borderTop: "1px solid var(--ui-border)", marginTop: 2 }}>
            <span className="artifact-mono" style={{ fontSize: 9, color: "var(--ui-faint)" }}>
              Only charter & closure can be created here
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   Search / Filter Bar
========================================================= */

function InlineFilterBar({
  search, setSearch, statusSet, toggleStatus,
  phaseSet, togglePhase, clearAll, activeCount,
}: {
  search: string; setSearch: (value: string) => void;
  statusSet: Set<UiStatus>; toggleStatus: (status: UiStatus) => void;
  phaseSet: Set<Phase>; togglePhase: (phase: Phase) => void;
  clearAll: () => void; activeCount: number;
}) {
  const [showFilters, setShowFilters] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="toolbar-artifacts">
      <div className="toolbar-search-wrap">
        <div className="toolbar-search">
          <Search className="h-4 w-4 shrink-0" style={{ color: "var(--ui-faint)" }} />
          <input
            ref={inputRef} type="text" value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { if (search) setSearch(""); else (e.target as HTMLInputElement).blur(); } }}
            placeholder="Filter artifacts..."
            className="toolbar-search-input"
          />
          {search && (
            <button onClick={() => setSearch("")} className="icon-mini-btn" type="button">
              <X className="h-3 w-3" />
            </button>
          )}
          <kbd className="artifact-mono shortcut-kbd">⌘K</kbd>
        </div>
        <button
          onClick={() => setShowFilters((v) => !v)}
          className="toolbar-filter-btn" type="button"
          style={{ borderColor: activeCount > 0 ? "var(--ui-accentSoft)" : "var(--ui-border)", background: activeCount > 0 ? "var(--ui-accentSoft)" : "var(--ui-panel)", color: activeCount > 0 ? "var(--ui-accent)" : "var(--ui-muted)" }}
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
              const style = STATUS_STYLES[status];
              return (
                <button key={status} onClick={() => toggleStatus(status)} type="button" className="toolbar-chip-btn artifact-mono"
                  style={{ background: active ? style.bg : "transparent", color: active ? style.color : "var(--ui-faint)", borderColor: active ? style.bg : "var(--ui-border)" }}>
                  {status}
                </button>
              );
            })}
          </div>
          <div className="toolbar-divider" />
          <div className="toolbar-chip-group">
            <span className="artifact-mono toolbar-chip-label">Phase</span>
            {(["Initiating","Planning","Executing","Monitoring & Controlling","Closing"] as Phase[]).map((phase) => {
              const active = phaseSet.has(phase);
              const config = PHASE_CONFIG[phase];
              return (
                <button key={phase} onClick={() => togglePhase(phase)} type="button" className="toolbar-chip-btn artifact-mono"
                  style={{ background: active ? config.bg : "transparent", color: active ? config.color : "var(--ui-faint)", borderColor: active ? config.bg : "var(--ui-border)" }}>
                  {config.label}
                </button>
              );
            })}
          </div>
          {activeCount > 0 && (
            <>
              <div className="toolbar-divider" />
              <button onClick={clearAll} type="button" className="toolbar-clear-btn artifact-mono">Clear all</button>
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
    const blocked  = rows.filter((r) => r.status === "Blocked").length;
    const avgProgress = total ? Math.round(rows.reduce((sum, r) => sum + r.progress, 0) / total) : 0;
    return { total, approved, inReview, blocked, avgProgress };
  }, [rows]);
  return (
    <div className="artifact-stats-row artifact-mono">
      <span><b style={{ color: "var(--ui-text)", fontWeight: 500 }}>{stats.total}</b> total</span>
      <span><b style={{ color: "var(--ui-success)", fontWeight: 500 }}>{stats.approved}</b> approved</span>
      <span><b style={{ color: "var(--ui-accent)", fontWeight: 500 }}>{stats.inReview}</b> in review</span>
      {stats.blocked > 0 && <span><b style={{ color: "var(--ui-danger)", fontWeight: 500 }}>{stats.blocked}</b> blocked</span>}
      <span><b style={{ color: "#7C3AED", fontWeight: 500 }}>{stats.avgProgress}%</b> avg progress</span>
    </div>
  );
}

/* =========================================================
   AI Panel
========================================================= */

type AiScope = "project" | "org";

function AiScopeButton({ active, disabled, onClick, children, title }: { active: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; title?: string; }) {
  return (
    <button onClick={onClick} disabled={disabled} title={title} className="artifact-mono px-2.5 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed"
      style={{ background: active ? "var(--ui-accentSoft)" : "transparent", color: active ? "var(--ui-accent)" : "var(--ui-muted)", opacity: disabled ? 0.45 : 1 }}>
      {children}
    </button>
  );
}
function AiMetricPill({ label, value }: { label: string; value: number }) {
  return (
    <span className="artifact-mono" style={{ fontSize: 10, fontWeight: 500, color: "var(--ui-text-soft)", background: "var(--ui-panel)", border: "1px solid var(--ui-border)", borderRadius: 999, padding: "4px 8px" }}>
      {label}: {value}
    </span>
  );
}
function AiItemCard({ item, href }: { item: any; href: string }) {
  const days = daysUntil(item?.dueDate || item?.due_date);
  const isOverdue = days !== null && days < 0;
  const label = safeStr(item?.itemType || item?.type || "item").replace(/_/g, " ");
  const dueRaw = safeStr(item?.dueDate || item?.due_date).trim();
  return (
    <div className="p-3 rounded-xl border transition-colors" style={{ borderColor: "var(--ui-border)", background: "var(--ui-panel)" }}>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <span className="artifact-mono" style={{ fontSize: 9, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ui-faint)", background: "var(--ui-panelAlt)", padding: "4px 6px", borderRadius: 999 }}>{label}</span>
        {days !== null && <span className="artifact-mono" style={{ fontSize: 10, fontWeight: 500, color: isOverdue ? "var(--ui-danger)" : "var(--ui-warning)" }}>{isOverdue ? `${Math.abs(days)}d overdue` : `${days}d`}</span>}
      </div>
      <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--ui-text)", marginBottom: 4 }}>{safeStr(item?.title) || "Untitled"}</h4>
      <div className="flex items-center gap-1.5 artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)", marginBottom: 10 }}>
        <Calendar className="h-3 w-3" />{dueRaw ? fmtUkDateOnly(dueRaw) : "No due date"}
      </div>
      <div className="flex gap-2">
        <Link href={href} className="flex-1 px-3 py-1.5 rounded-md text-center text-[11px] font-medium border transition-colors" style={{ background: "var(--ui-panelAlt)", borderColor: "var(--ui-border)", color: "var(--ui-text-soft)" }}>Open</Link>
        <button onClick={() => navigator.clipboard.writeText(`Reminder: ${safeStr(item?.title)} due ${dueRaw ? fmtUkDateOnly(dueRaw) : "TBC"}`)} className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors" style={{ background: "var(--ui-accent)", color: "white" }}>Copy</button>
      </div>
    </div>
  );
}
function AiPanel({ open, onClose, projectUuid, projectCode, projectName, projectHumanId }: {
  open: boolean; onClose: () => void; projectUuid: string; projectCode: string; projectName: string; projectHumanId: string;
}) {
  const canProject = !!projectUuid && looksLikeUuid(projectUuid);
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<any>(null);
  const [error, setError]     = useState("");
  const [scope, setScope]     = useState<AiScope>(canProject ? "project" : "org");

  useEffect(() => { if (!open) return; setLoading(false); setResult(null); setError(""); setScope(canProject ? "project" : "org"); }, [open, canProject]);
  useEffect(() => { function onKey(e: KeyboardEvent) { if (e.key === "Escape" && open) onClose(); } window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [open, onClose]);

  function extractDueSoon(data: any): any[] {
    const a = data?.dueDigest?.ai ?? data?.ai ?? data ?? {};
    const cand = a?.dueSoon ?? a?.due_soon ?? a?.items ?? a?.events ?? [];
    return Array.isArray(cand) ? cand : [];
  }
  function extractCounts(data: any): any {
    return data?.dueDigest?.ai?.counts ?? data?.counts ?? data?.ai?.counts ?? null;
  }

  async function runCheck() {
    if (scope === "project" && !canProject) { setError("Invalid project UUID"); return; }
    setLoading(true); setError("");
    try {
      const qs = new URLSearchParams({ days: "14", dueWindowDays: "14" });
      if (scope === "project" && projectUuid) qs.set("projectId", projectUuid);
      const res = await fetch(`/api/portfolio/dashboard?${qs.toString()}`, { method: "GET", credentials: "include", headers: { accept: "application/json" }, cache: "no-store" });
      const text = await res.text();
      let data: any = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      if (!res.ok) throw new Error(data?.error || data?.message || `Request failed (${res.status})`);
      setResult(data);
    } catch (e: any) {
      setError(e?.message || "AI request failed");
      setResult((prev: any) => prev ?? { ai: { dueSoon: [] } });
    } finally { setLoading(false); }
  }

  const items  = extractDueSoon(result);
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
      const pid  = safeStr(meta?.project_id).trim();
      const key  = code || human || pid || "Project";
      const label = code && name ? `${code} — ${name}` : code || name || human || pid || "Project";
      const existing = map.get(key);
      if (!existing) map.set(key, { label, items: [it], sortKey: code || human || name || pid || key });
      else existing.items.push(it);
    }
    return Array.from(map.entries()).map(([key, value]) => ({ key, ...value })).sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  }, [items, scope]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md max-h-[70vh] rounded-2xl overflow-hidden flex flex-col" style={{ background: "var(--ui-panel)", border: "1px solid var(--ui-border)", boxShadow: "0 25px 50px -12px rgba(0,0,0,0.15)" }}>
        <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--ui-border)" }}>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md flex items-center justify-center" style={{ background: "var(--ui-accentSoft)" }}><Sparkles className="h-3.5 w-3.5" style={{ color: "var(--ui-accent)" }} /></div>
            <div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ui-text)" }}>AI Assistant</span>
              <span className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)", marginLeft: 8 }}>{scope === "org" ? "Portfolio" : projectCode || projectHumanId || projectName || "—"}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center rounded-lg border overflow-hidden" style={{ borderColor: "var(--ui-border)", background: "var(--ui-panelAlt)", height: 28 }}>
              <AiScopeButton active={scope === "project"} disabled={!canProject} onClick={() => { if (!canProject) return; setScope("project"); setResult(null); setError(""); }} title={canProject ? "Due items for this project" : "Project scope unavailable"}>Project</AiScopeButton>
              <AiScopeButton active={scope === "org"} onClick={() => { setScope("org"); setResult(null); setError(""); }} title="Due items across all my projects">All</AiScopeButton>
            </div>
            <button onClick={onClose} className="icon-mini-btn" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {scope === "org" && counts && (
            <div className="mb-3 p-3 rounded-xl border" style={{ background: "var(--ui-accentSoft)", borderColor: "var(--ui-border)" }}>
              <div className="flex items-center justify-between gap-3">
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ui-text)" }}>{scopeLabel}</div>
                <div className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-muted)" }}>Due soon: <span style={{ fontWeight: 500, color: "var(--ui-text)" }}>{safeNum(counts?.dueSoon ?? counts?.due_soon ?? items.length)}</span></div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[["Milestones", counts?.schedule_milestones ?? counts?.milestones], ["Work items", counts?.work_items ?? counts?.workItems], ["RAID", counts?.raid_items ?? counts?.raidItems], ["Change", counts?.change_requests ?? counts?.changeRequests]].map(([label, val]) => {
                  const n = safeNum(val, 0);
                  if (!n) return null;
                  return <AiMetricPill key={String(label)} label={String(label)} value={n} />;
                })}
              </div>
            </div>
          )}
          {error ? (
            <div className="p-3 rounded-xl text-[13px] flex items-start gap-2" style={{ background: "var(--ui-dangerSoft)", color: "var(--ui-danger)" }}>
              <AlertCircle className="h-4 w-4 mt-[1px] shrink-0" />
              <div>
                <div style={{ fontWeight: 600 }}>Scan failed</div>
                <div style={{ fontSize: 12, opacity: 0.8 }}>{error}</div>
                <button onClick={runCheck} disabled={loading} className="mt-2 px-3 py-1 rounded-md text-[12px] font-medium disabled:opacity-50" style={{ background: "var(--ui-accent)", color: "white" }}>{loading ? "Retrying..." : "Retry"}</button>
              </div>
            </div>
          ) : !result ? (
            <div className="text-center py-10">
              <Clock className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--ui-accent)" }} />
              <p style={{ fontSize: 13, color: "var(--ui-text-soft)", marginBottom: 4 }}>Check what&apos;s due in the next 14 days</p>
              <p className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)", marginBottom: 16 }}>{scopeLabel}</p>
              <button onClick={runCheck} disabled={loading} className="px-4 py-2 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50" style={{ background: "var(--ui-accent)", color: "white" }}>
                {loading ? <span className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />Scanning...</span> : "Scan Due Dates"}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-10">
              <FileCheck className="h-8 w-8 mx-auto mb-3" style={{ color: "var(--ui-success)" }} />
              <p style={{ fontSize: 13, color: "var(--ui-text-soft)" }}>Nothing due in the next 14 days</p>
              <p className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)", marginTop: 4 }}>{scopeLabel}</p>
            </div>
          ) : scope === "org" && grouped ? (
            <div className="space-y-3">
              {grouped.map((g) => (
                <div key={g.key} className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--ui-border)" }}>
                  <div className="px-3 py-2 border-b flex items-center justify-between" style={{ background: "var(--ui-panelAlt)", borderColor: "var(--ui-border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ui-text)" }}>{g.label}</div>
                    <div className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)" }}>{g.items.length} due</div>
                  </div>
                  <div className="p-3 space-y-2">{g.items.slice(0, 25).map((item: any, idx: number) => <AiItemCard key={`${g.key}:${idx}`} item={item} href={aiItemHref({ item, fallbackProjectRef: projectRef })} />)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-2">{items.map((item: any, idx: number) => <AiItemCard key={idx} item={item} href={aiItemHref({ item, fallbackProjectRef: projectRef })} />)}</div>
          )}
        </div>
        <div className="px-4 py-2.5 border-t" style={{ borderColor: "var(--ui-border)" }}>
          <button onClick={runCheck} disabled={loading} className="w-full py-1.5 rounded-lg text-[12px] font-medium border transition-colors disabled:opacity-50" style={{ color: "var(--ui-text-soft)", background: "var(--ui-panelAlt)", borderColor: "var(--ui-border)" }}>
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
  cloneArtifactAction?: (fd: FormData) => Promise<{ ok: boolean; newArtifactId?: string; error?: string }>;
  deleteDraftArtifactAction?: (args: { artifactId: string; projectId: string }) => Promise<{ ok: boolean; error?: string }>;
  setArtifactCurrentAction?: (args: { projectId: string; artifactId: string }) => Promise<{ ok: boolean; error?: string }>;
  createArtifactAction?: (fd: FormData) => Promise<string | { id?: string; newArtifactId?: string } | null>;
  projectHumanId: string;
  projectUuid?: string;
  projectCode?: string | null;
  projectName?: string | null;
  rows?: ArtifactBoardRow[];
  projectId?: string;
  artifacts?: any[];
}) {
  const cloneArtifactAction        = props.cloneArtifactAction        ?? (async () => ({ ok: false as const, error: "not provided" }));
  const deleteDraftArtifactAction  = props.deleteDraftArtifactAction  ?? (async () => ({ ok: false as const, error: "not provided" }));
  const setArtifactCurrentAction   = props.setArtifactCurrentAction   ?? (async () => ({ ok: false as const, error: "not provided" }));
  const router = useRouter();

  const projectHumanId = safeStr(props.projectHumanId).trim();
  const projectUuid    = safeStr(props.projectUuid || props.projectId).trim();
  const projectName    = safeStr(props.projectName).trim();
  const projectCode = useMemo(() => { const c = safeStr(props.projectCode).trim(); if (!c || c === "NaN" || c.includes("NaN") || looksLikeUuid(c)) return ""; return c; }, [props.projectCode]);

  const baseRows = useMemo(() => {
    const incoming = Array.isArray(props.rows) ? props.rows : [];
    const arts     = Array.isArray(props.artifacts) ? props.artifacts : [];
    if (incoming.length) return applyCurrentFallback(incoming.map((r, i) => ({ ...r, __idx: i })));
    if (!arts.length) return [];
    return applyCurrentFallback(
      arts.map((a, i) => ({
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
      }) as ArtifactBoardRow).filter((r) => r.id),
    );
  }, [props.rows, props.artifacts]);

  // Detect if charter / closure already exists (for New Artifact button state)
  const hasCharter = useMemo(() => baseRows.some((r) => rowTypeKey(r) === "PROJECT_CHARTER" && booly(r.isCurrent)), [baseRows]);
  const hasClosure = useMemo(() => baseRows.some((r) => rowTypeKey(r) === "PROJECT_CLOSURE_REPORT" && booly(r.isCurrent)), [baseRows]);

  const [aiOpen, setAiOpen]         = useState(false);
  const [search, setSearch]         = useState("");
  const [statusSet, setStatusSet]   = useState<Set<UiStatus>>(new Set());
  const [phaseSet, setPhaseSet]     = useState<Set<Phase>>(new Set());

  const toggleStatus = (s: UiStatus) => { setStatusSet((prev) => { const next = new Set(prev); next.has(s) ? next.delete(s) : next.add(s); return next; }); };
  const togglePhase  = useCallback((p: Phase) => { setPhaseSet((prev) => { const next = new Set(prev); next.has(p) ? next.delete(p) : next.add(p); return next; }); }, []);
  const clearAll     = () => { setSearch(""); setStatusSet(new Set()); setPhaseSet(new Set()); };

  const filteredRows = useMemo(() => {
    const q = safeLower(search);
    return baseRows.filter((r) => {
      if (statusSet.size && !statusSet.has(r.status)) return false;
      if (phaseSet.size && !phaseSet.has(r.phase)) return false;
      if (q) { const text = [r.artifactType, r.title, r.ownerEmail, r.ownerName].join(" ").toLowerCase(); if (!text.includes(q)) return false; }
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

  const [cloningId, setCloningId]             = useState("");
  const [deletingId, setDeletingId]           = useState("");
  const [makingCurrentId, setMakingCurrentId] = useState("");
  const [actionError, setActionError]         = useState("");

  const projectRef = useMemo(() => safeStr(projectHumanId || projectCode || projectUuid).trim(), [projectHumanId, projectCode, projectUuid]);

  const openRow = useCallback((row: ArtifactBoardRow) => router.push(rowHref(projectRef, row)), [projectRef, router]);

  const handleClone = async (id: string) => {
    if (!projectUuid || !looksLikeUuid(projectUuid)) { setActionError("Invalid project UUID"); return; }
    if (!looksLikeUuid(id)) { setActionError("Cannot clone a module row"); return; }
    setCloningId(id); setActionError("");
    try {
      const fd = new FormData(); fd.set("projectId", projectUuid); fd.set("artifactId", id);
      const res = await cloneArtifactAction(fd);
      if (!res?.ok) throw new Error(res?.error ?? "Clone failed");
      if (res.newArtifactId) router.push(`/projects/${projectRef}/artifacts/${res.newArtifactId}`);
    } catch (e: any) { setActionError(e?.message || "Clone failed"); }
    finally { setCloningId(""); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this draft charter or closure report?")) return;
    if (!projectUuid || !looksLikeUuid(projectUuid)) return;
    if (!looksLikeUuid(id)) return;
    setDeletingId(id); setActionError("");
    try {
      const res = await deleteDraftArtifactAction({ projectId: projectUuid, artifactId: id });
      if (!res?.ok) throw new Error(res?.error ?? "Delete failed");
      router.refresh();
    } catch (e: any) { setActionError(e?.message || "Delete failed"); }
    finally { setDeletingId(""); }
  };

  const handleCreate = async (type: string) => {
    if (!projectUuid || !looksLikeUuid(projectUuid)) { setActionError("Invalid project UUID"); return; }
    if (!props.createArtifactAction) { setActionError("Create action not available"); return; }
    setActionError("");
    try {
      const fd = new FormData();
      fd.set("project_id", projectUuid);
      fd.set("type", type);
      const result = await props.createArtifactAction(fd);
      // Result may be a string ID or an object with id/newArtifactId
      const newId = typeof result === "string"
        ? result
        : (result as any)?.newArtifactId ?? (result as any)?.id ?? null;
      if (newId && looksLikeUuid(newId)) {
        router.push(`/projects/${projectRef}/artifacts/${newId}`);
      } else {
        router.refresh();
      }
    } catch (e: any) {
      setActionError(e?.message || "Failed to create artifact");
    }
  };

  const handleMakeCurrent = async (id: string) => {
    if (!projectUuid || !looksLikeUuid(projectUuid)) return;
    if (!looksLikeUuid(id)) return;
    setMakingCurrentId(id); setActionError("");
    try {
      await setArtifactCurrentAction({ projectId: projectUuid, artifactId: id });
      router.refresh();
    } catch (e: any) { setActionError(e?.message || "Set current failed"); }
    finally { setMakingCurrentId(""); }
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        ${portfolioGlobalCss()}
        .notion-board, .notion-board * { font-family: var(--ui-font-sans); }
        .artifact-mono { font-family: var(--ui-font-mono) !important; }
        .notion-board { background: linear-gradient(to bottom, var(--ui-bg) 0%, var(--ui-bg) 280px, var(--ui-panelAlt) 100%); color: var(--ui-text); -webkit-font-smoothing: antialiased; }
        .artifact-row:hover { background: var(--ui-panelAlt) !important; }
        .toolbar-artifacts { display: flex; flex-direction: column; gap: 10px; padding: 14px 0 16px; border-bottom: 1px solid var(--ui-border); margin-bottom: 14px; }
        .toolbar-search-wrap { display: flex; align-items: center; gap: 10px; }
        .toolbar-search { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; border: 1px solid var(--ui-border); background: var(--ui-panel); border-radius: 12px; padding: 0 14px; min-height: 44px; }
        .toolbar-search-input { border: none; outline: none; background: transparent; font-family: var(--ui-font-sans); font-size: 13px; color: var(--ui-text); width: 100%; padding: 12px 0; }
        .toolbar-search-input::placeholder { color: var(--ui-faint); }
        .shortcut-kbd { border: 1px solid var(--ui-border); border-radius: 8px; padding: 3px 7px; background: var(--ui-panel); color: var(--ui-faint); font-size: 10px; letter-spacing: 0.04em; }
        .icon-mini-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; color: var(--ui-muted); transition: background 0.12s, color 0.12s; }
        .icon-mini-btn:hover { background: var(--ui-panelAlt); color: var(--ui-text); }
        .toolbar-filter-btn { display: inline-flex; align-items: center; gap: 7px; padding: 0 14px; min-height: 44px; border-radius: 12px; border: 1px solid var(--ui-border); font-size: 12px; font-weight: 600; background: var(--ui-panel); transition: border-color 0.12s, background 0.12s, color 0.12s; }
        .toolbar-filter-count { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--ui-accent); color: #fff; font-size: 10px; font-weight: 600; }
        .toolbar-filter-panel { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-top: 2px; }
        .toolbar-chip-group { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .toolbar-chip-label { font-size: 9px; font-weight: 500; color: var(--ui-faint); letter-spacing: 0.14em; text-transform: uppercase; }
        .toolbar-chip-btn { padding: 6px 10px; border-radius: 999px; font-size: 9px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; border: 1px solid var(--ui-border); background: transparent; transition: all 0.12s; }
        .toolbar-divider { width: 1px; height: 18px; background: var(--ui-border); }
        .toolbar-clear-btn { font-size: 9px; font-weight: 500; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ui-faint); }
        .toolbar-clear-btn:hover { color: var(--ui-text-soft); }
        .artifact-stats-row { display: flex; align-items: center; gap: 18px; font-size: 10px; font-weight: 400; color: var(--ui-faint); letter-spacing: 0.03em; text-transform: lowercase; white-space: nowrap; }
        .notion-board ::-webkit-scrollbar { width: 6px; height: 6px; }
        .notion-board ::-webkit-scrollbar-track { background: transparent; }
        .notion-board ::-webkit-scrollbar-thumb { background: #dedede; border-radius: 3px; }
        .notion-board ::-webkit-scrollbar-thumb:hover { background: #cccccc; }
        @media (max-width: 1100px) { .artifact-stats-row { display: none; } }
        @media (max-width: 900px) { .toolbar-search-wrap { flex-direction: column; align-items: stretch; } }
      ` }} />

      <div className="notion-board min-h-screen" style={{ WebkitFontSmoothing: "antialiased" }}>
        <header className="sticky top-0 z-40" style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(8px)", borderBottom: "1px solid var(--ui-border)" }}>
          <div className="max-w-[1320px] mx-auto px-6">
            <div className="flex items-center justify-between py-5 gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "var(--ui-panelAlt)" }}>
                  <Layers className="h-4 w-4" style={{ color: "var(--ui-muted)" }} />
                </div>
                <div className="min-w-0">
                  <div style={{ fontSize: 28, fontWeight: 700, color: "var(--ui-text)", letterSpacing: "-0.035em", lineHeight: 1 }}>Artifacts</div>
                  <div className="flex items-center gap-2 flex-wrap mt-1">
                    <span style={{ fontSize: 13, color: "var(--ui-text-soft)" }}>{projectName || "Project"}</span>
                    {projectCode && (
                      <span className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)", background: "var(--ui-panelAlt)", border: "1px solid var(--ui-border)", padding: "4px 8px", borderRadius: 999, letterSpacing: "0.04em" }}>
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
                  style={{ background: "var(--ui-accentSoft)", color: "var(--ui-accent)", border: "1px solid var(--ui-border)" }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  AI
                </button>
                <NewArtifactButton
                  projectRef={projectRef}
                  projectUuid={projectUuid}
                  hasCharter={hasCharter}
                  hasClosure={hasClosure}
                  onCreateArtifact={handleCreate}
                />
              </div>
            </div>
          </div>
        </header>

        {actionError && (
          <div className="max-w-[1320px] mx-auto px-6 pt-4 relative z-10">
            <div className="flex items-center gap-2 px-4 py-3 rounded-xl" style={{ fontSize: 13, background: "var(--ui-dangerSoft)", color: "var(--ui-danger)", border: "1px solid var(--ui-border)" }}>
              <AlertCircle className="h-4 w-4 shrink-0" />
              {actionError}
              <button onClick={() => setActionError("")} className="ml-auto icon-mini-btn"><X className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        )}

        <main className="max-w-[1320px] mx-auto px-6 py-4 relative z-10">
          <InlineFilterBar
            search={search} setSearch={setSearch}
            statusSet={statusSet} toggleStatus={toggleStatus}
            phaseSet={phaseSet} togglePhase={togglePhase}
            clearAll={clearAll} activeCount={activeFiltersCount}
          />

          {sortedRows.length === 0 ? (
            <div className="text-center" style={{ padding: "88px 24px", border: "1px solid var(--ui-border)", background: "var(--ui-panel)", borderRadius: 16 }}>
              <div style={{ width: 32, height: 2, background: "var(--ui-faint)", margin: "0 auto 20px" }} />
              <div style={{ fontSize: 28, fontWeight: 600, color: "var(--ui-text)", letterSpacing: "-0.02em", marginBottom: 10 }}>No artifacts found.</div>
              <p style={{ fontSize: 13, color: "var(--ui-text-soft)", fontWeight: 400 }}>
                {activeFiltersCount > 0 ? "Try adjusting your filters." : "Use the New artifact button to create a Project Charter."}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden overflow-x-auto" style={{ background: "var(--ui-panel)", border: "1px solid var(--ui-border)", borderRadius: 16, boxShadow: "var(--ui-shadow-soft)" }}>
              <div className="grid items-center sticky top-0 z-10" style={{ gridTemplateColumns: COL_TEMPLATE, minHeight: 42, background: "var(--ui-panelAlt)", borderBottom: "1px solid var(--ui-border)" }}>
                {["Name", "Owner", "Phase", "Status", "Progress", ""].map((label) => (
                  <span key={label} className="artifact-mono px-4 text-[9px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ui-faint)" }}>{label}</span>
                ))}
              </div>
              {sortedRows.map((row) => (
                <ArtifactTableRow
                  key={`${row.id}:${rowTypeKey(row)}`}
                  row={row} projectRef={projectRef} projectUuid={projectUuid}
                  onOpen={openRow}
                  onMakeCurrent={handleMakeCurrent} makingCurrentId={makingCurrentId}
                  onClone={handleClone} cloningId={cloningId}
                  onDelete={handleDelete} deletingId={deletingId}
                />
              ))}
              <div className="px-4 py-3" style={{ background: "var(--ui-panel)", borderTop: "1px solid var(--ui-border)" }}>
                <span className="artifact-mono" style={{ fontSize: 10, color: "var(--ui-faint)", letterSpacing: "0.08em" }}>
                  {sortedRows.length} artifact{sortedRows.length !== 1 ? "s" : ""}{activeFiltersCount > 0 && ` (filtered from ${baseRows.length})`}
                </span>
              </div>
            </div>
          )}
        </main>

        <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} projectUuid={projectUuid} projectCode={projectCode || projectHumanId} projectName={projectName} projectHumanId={projectHumanId} />
      </div>
    </>
  );
}



