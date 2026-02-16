"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  CheckCircle2, 
  Loader2, 
  Trash2, 
  Filter, 
  Sparkles, 
  Calendar,
  AlertCircle,
  X
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
  __idx?: number;
};

/* =========================================================
   Design Tokens
========================================================= */

const STATUS_CONFIG: Record<UiStatus, { 
  bg: string; 
  text: string; 
  border: string;
  dot: string;
}> = {
  Draft: { 
    bg: "bg-slate-100", 
    text: "text-slate-700", 
    border: "border-slate-200",
    dot: "bg-slate-400"
  },
  "In review": { 
    bg: "bg-blue-50", 
    text: "text-blue-700", 
    border: "border-blue-200",
    dot: "bg-blue-500"
  },
  Approved: { 
    bg: "bg-emerald-50", 
    text: "text-emerald-700", 
    border: "border-emerald-200",
    dot: "bg-emerald-500"
  },
  Blocked: { 
    bg: "bg-rose-50", 
    text: "text-rose-700", 
    border: "border-rose-200",
    dot: "bg-rose-500"
  },
};

const PHASE_COLORS: Record<Phase, { accent: string; bar: string }> = {
  "Initiating": { accent: "text-amber-600", bar: "bg-amber-500" },
  "Planning": { accent: "text-blue-600", bar: "bg-blue-500" },
  "Executing": { accent: "text-violet-600", bar: "bg-violet-500" },
  "Monitoring & Controlling": { accent: "text-cyan-600", bar: "bg-cyan-500" },
  "Closing": { accent: "text-emerald-600", bar: "bg-emerald-500" },
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || "").trim());
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
  return raw.replace(/\/RAID(\/|$)/g, "/raid$1")
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
  const t = raw.replace(/\s+/g, " ").replace(/[\/]+/g, " / ").replace(/[_-]+/g, "_").trim();

  if (["weekly_report", "weekly report", "weekly_status", "weekly status", "weekly_update", "weekly update", "delivery_report", "delivery report", "status_report", "status report"].includes(t)) {
    return "WEEKLY_REPORT";
  }
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
    case "STAKEHOLDER_REGISTER":
    case "WBS":
    case "SCHEDULE": return "Planning";
    case "WEEKLY_REPORT": return "Executing";
    case "RAID":
    case "CHANGE_REQUESTS": return "Monitoring & Controlling";
    case "LESSONS_LEARNED":
    case "PROJECT_CLOSURE_REPORT": return "Closing";
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
   UI Components - Crisp Rendering
========================================================= */

function ProgressBar({ value }: { value: number }) {
  const v = clampPct(value, 0);
  return (
    <div className="w-28">
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div 
          className="h-full rounded-full bg-blue-500" 
          style={{ width: `${v}%` }} 
        />
      </div>
      <div className="mt-1 text-[11px] font-medium text-slate-500">{v}%</div>
    </div>
  );
}

function StatusBadge({ status }: { status: UiStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-semibold ${cfg.bg} ${cfg.text} border ${cfg.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {status}
    </span>
  );
}

function OwnerAvatar({ email, name }: { email: string; name?: string }) {
  const initials = initialsFromEmail(email);
  const displayName = name || email.split("@")[0] || "Unknown";
  
  return (
    <div className="flex items-center gap-2">
      <div className="h-7 w-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
        <span className="text-[10px] font-bold text-slate-600">{initials}</span>
      </div>
      <div className="min-w-0">
        <div className="text-sm font-medium text-slate-700 truncate">{displayName}</div>
      </div>
    </div>
  );
}

function CurrentBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase tracking-wide border border-emerald-200">
      <CheckCircle2 className="h-3 w-3" />
      Current
    </span>
  );
}

function BaselineBadge() {
  return (
    <span className="px-1.5 py-0.5 rounded bg-slate-800 text-white text-[10px] font-bold uppercase tracking-wide">
      Baseline
    </span>
  );
}

function PhaseSection({ 
  phase, 
  rows, 
  projectUuid,
  onMakeCurrent,
  makingCurrentId,
  onClone,
  cloningId,
  onDelete,
  deletingId,
  onOpenRow,
}: {
  phase: Phase;
  rows: ArtifactBoardRow[];
  projectUuid: string;
  onMakeCurrent: (id: string) => void;
  makingCurrentId: string;
  onClone: (id: string) => void;
  cloningId: string;
  onDelete: (id: string) => void;
  deletingId: string;
  onOpenRow: (id: string) => void;
}) {
  const colors = PHASE_COLORS[phase];
  
  const sortedRows = useMemo(() => {
    return [...rows].sort((a, b) => {
      const aCurrent = booly(a.isCurrent) ? 1 : 0;
      const bCurrent = booly(b.isCurrent) ? 1 : 0;
      if (aCurrent !== bCurrent) return bCurrent - aCurrent;
      const aBase = a.isBaseline ? 1 : 0;
      const bBase = b.isBaseline ? 1 : 0;
      if (aBase !== bBase) return bBase - aBase;
      return (a.__idx ?? 0) - (b.__idx ?? 0);
    });
  }, [rows]);

  if (!sortedRows.length) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-3 mb-3 px-1">
        <div className={`w-1 h-6 rounded-full ${colors.bar}`} />
        <h3 className={`text-base font-bold ${colors.accent}`}>{phase}</h3>
        <span className="px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-semibold">
          {sortedRows.length}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        {sortedRows.map((row, idx) => {
          const isCurrent = booly(row.isCurrent);
          const isMakingCurrent = makingCurrentId === row.id;
          const isCloning = cloningId === row.id;
          const isDeleting = deletingId === row.id;
          const canDelete = row.canDeleteDraft !== false && row.status === "Draft" && !row.isBaseline && !row.isLocked && !row.deletedAt;
          const canSwitchCurrent = !isCurrent;

          return (
            <div 
              key={row.id}
              onClick={() => onOpenRow(row.id)}
              className={`group flex items-center justify-between p-4 cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50 ${
                isCurrent ? "bg-emerald-50/30" : ""
              }`}
              style={{ 
                // Force crisp rendering
                WebkitFontSmoothing: "antialiased",
                MozOsxFontSmoothing: "grayscale",
                transform: "translateZ(0)",
                backfaceVisibility: "hidden"
              }}
            >
              <div className="flex items-center gap-6 flex-1 min-w-0">
                <div className="w-48 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {row.artifactType}
                    </span>
                    {isCurrent && <CurrentBadge />}
                    {row.isBaseline && <BaselineBadge />}
                  </div>
                  <p className="text-xs text-slate-500 truncate">{row.title}</p>
                </div>

                <div className="w-40">
                  <OwnerAvatar email={row.ownerEmail} name={row.ownerName} />
                </div>

                <div className="w-28">
                  <ProgressBar value={row.progress} />
                </div>

                <StatusBadge status={row.status} />
              </div>

              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {canSwitchCurrent && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onMakeCurrent(row.id);
                    }}
                    disabled={isMakingCurrent || !projectUuid || !looksLikeUuid(projectUuid)}
                    className="p-2 rounded-lg hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors disabled:opacity-50"
                    title="Set as current"
                  >
                    {isMakingCurrent ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  </button>
                )}
                
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onClone(row.id);
                  }}
                  disabled={isCloning || !projectUuid || !looksLikeUuid(projectUuid)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors disabled:opacity-50"
                >
                  {isCloning ? "..." : "Clone"}
                </button>

                {canDelete && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(row.id);
                    }}
                    disabled={isDeleting || !projectUuid || !looksLikeUuid(projectUuid)}
                    className="p-2 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-600 transition-colors disabled:opacity-50"
                    title="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =========================================================
   Filters Panel - Static Positioning
========================================================= */

function FiltersPanel({
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
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      
      <div 
        className="absolute right-6 top-20 w-80 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"
        style={{
          // Prevent blur from transforms
          transform: "none",
          WebkitFontSmoothing: "antialiased"
        }}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-500" />
            <span className="font-semibold text-slate-900 text-sm">Filters</span>
            {activeCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold">
                {activeCount}
              </span>
            )}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Search
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Artifact, title, owner..."
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-blue-500"
              style={{ WebkitFontSmoothing: "antialiased" }}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {(["Draft", "In review", "Approved", "Blocked"] as UiStatus[]).map((status) => {
                const active = statusSet.has(status);
                const cfg = STATUS_CONFIG[status];
                return (
                  <button
                    key={status}
                    onClick={() => toggleStatus(status)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      active 
                        ? `${cfg.bg} ${cfg.text} ${cfg.border}` 
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {status}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">
              Phase
            </label>
            <div className="flex flex-wrap gap-2">
              {(["Initiating", "Planning", "Executing", "Monitoring & Controlling", "Closing"] as Phase[]).map((phase) => {
                const active = phaseSet.has(phase);
                const colors = PHASE_COLORS[phase];
                return (
                  <button
                    key={phase}
                    onClick={() => togglePhase(phase)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${
                      active 
                        ? `bg-slate-900 text-white border-slate-900` 
                        : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                    }`}
                  >
                    {phase}
                  </button>
                );
              })}
            </div>
          </div>

          {activeCount > 0 && (
            <button
              onClick={clearAll}
              className="w-full py-2 text-xs font-semibold text-slate-500 hover:text-slate-700 hover:bg-slate-50 rounded-lg border border-slate-200"
            >
              Clear all filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   AI Panel
========================================================= */

function daysUntil(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function AiAutomationPanel({
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
  const [error, setError] = useState<string>("");

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
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />
      
      <div 
        className="absolute right-6 top-20 w-96 max-h-[80vh] bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden flex flex-col"
        style={{ WebkitFontSmoothing: "antialiased" }}
      >
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-600" />
            <span className="font-semibold text-slate-900 text-sm">AI Assistant</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-slate-200 rounded">
            <X className="h-4 w-4 text-slate-400" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {!result ? (
            <div className="text-center py-8">
              <button
                onClick={runCheck}
                disabled={loading}
                className="px-4 py-2 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800 disabled:opacity-50"
              >
                {loading ? "Checking..." : "Check Due Dates"}
              </button>
            </div>
          ) : error ? (
            <div className="p-3 rounded-lg bg-rose-50 text-sm text-rose-700">{error}</div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-slate-500 text-sm">No items due in next 14 days</div>
          ) : (
            <div className="space-y-3">
              {items.map((item: any, idx: number) => {
                const days = daysUntil(item.dueDate);
                const isOverdue = days !== null && days < 0;
                
                return (
                  <div key={idx} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-white border border-slate-200 uppercase">
                        {item.itemType || "Item"}
                      </span>
                      {days !== null && (
                        <span className={`text-[10px] font-bold ${isOverdue ? "text-rose-600" : "text-amber-600"}`}>
                          {isOverdue ? `${Math.abs(days)}d overdue` : `${days}d left`}
                        </span>
                      )}
                    </div>
                    <h4 className="text-sm font-medium text-slate-900 mb-1">{item.title}</h4>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
                      <Calendar className="h-3 w-3" />
                      {fmtUkDateOnly(item.dueDate)}
                    </div>
                    <div className="flex gap-2">
                      {item.link && (
                        <Link 
                          href={normalizeArtifactLink(item.link)}
                          className="flex-1 px-2 py-1 rounded bg-white border border-slate-200 text-xs text-center hover:border-slate-300"
                        >
                          Open
                        </Link>
                      )}
                      <button
                        onClick={() => navigator.clipboard.writeText(`Reminder: ${item.title} due ${fmtUkDateOnly(item.dueDate)}`)}
                        className="px-2 py-1 rounded bg-slate-900 text-white text-xs hover:bg-slate-800"
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
   Main
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
    
    return applyCurrentFallback(arts.map((a, i) => ({
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
    } as ArtifactBoardRow)).filter(r => r.id));
  }, [props.rows, props.artifacts]);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusSet, setStatusSet] = useState<Set<UiStatus>>(new Set());
  const [phaseSet, setPhaseSet] = useState<Set<Phase>>(new Set());

  const toggleStatus = (s: UiStatus) => {
    const next = new Set(statusSet);
    next.has(s) ? next.delete(s) : next.add(s);
    setStatusSet(next);
  };

  const togglePhase = (p: Phase) => {
    const next = new Set(phaseSet);
    next.has(p) ? next.delete(p) : next.add(p);
    setPhaseSet(next);
  };

  const clearAll = () => {
    setSearch("");
    setStatusSet(new Set());
    setPhaseSet(new Set());
  };

  const filteredRows = useMemo(() => {
    const q = safeLower(search);
    return baseRows.filter(r => {
      if (statusSet.size && !statusSet.has(r.status)) return false;
      if (phaseSet.size && !phaseSet.has(r.phase)) return false;
      if (q) {
        const text = [r.artifactType, r.title, r.ownerEmail, r.ownerName].join(" ").toLowerCase();
        if (!text.includes(q)) return false;
      }
      return true;
    });
  }, [baseRows, search, statusSet, phaseSet]);

  const grouped = useMemo(() => {
    const phases: Phase[] = ["Initiating", "Planning", "Executing", "Monitoring & Controlling", "Closing"];
    return phases.map(phase => ({
      phase,
      rows: filteredRows.filter(r => r.phase === phase)
    })).filter(g => g.rows.length > 0);
  }, [filteredRows]);

  const activeFiltersCount = (search ? 1 : 0) + statusSet.size + phaseSet.size;

  const [cloningId, setCloningId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [makingCurrentId, setMakingCurrentId] = useState("");
  const [actionError, setActionError] = useState<string>("");

  const openArtifact = (id: string) => {
    const ref = projectHumanId || projectCode || projectUuid;
    router.push(`/projects/${ref}/artifacts/${id}`);
  };

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
      await setArtifactCurrentAction({ projectId: projectUuid, artifactId: id });
      router.refresh();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setMakingCurrentId("");
    }
  };

  return (
    <div 
      className="min-h-screen bg-slate-50"
      style={{ WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}
    >
      {/* Header */}
      <div className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Artifact Board</h1>
              <p className="text-sm text-slate-500">
                {projectName || "Project"} 
                {projectCode && <span className="text-slate-400"> · {projectCode}</span>}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setFiltersOpen(true)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium ${
                  activeFiltersCount > 0 
                    ? "bg-slate-900 text-white border-slate-900" 
                    : "bg-white text-slate-700 border-slate-200 hover:border-slate-300"
                }`}
              >
                <Filter className="h-4 w-4" />
                Filter
                {activeFiltersCount > 0 && <span className="ml-1 text-xs">({activeFiltersCount})</span>}
              </button>

              <button
                onClick={() => setAiOpen(true)}
                disabled={!projectUuid || !looksLikeUuid(projectUuid)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50"
              >
                <Sparkles className="h-4 w-4" />
                AI
              </button>
            </div>
          </div>

          {actionError && (
            <div className="mt-3 p-3 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-700 flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              {actionError}
              <button onClick={() => setActionError("")} className="ml-auto">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        {grouped.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-slate-500">No artifacts found</p>
          </div>
        ) : (
          <div>
            {grouped.map(({ phase, rows }) => (
              <PhaseSection
                key={phase}
                phase={phase}
                rows={rows}
                projectUuid={projectUuid}
                onMakeCurrent={handleMakeCurrent}
                makingCurrentId={makingCurrentId}
                onClone={handleClone}
                cloningId={cloningId}
                onDelete={handleDelete}
                deletingId={deletingId}
                onOpenRow={openArtifact}
              />
            ))}
          </div>
        )}
      </div>

      <FiltersPanel
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        search={search}
        setSearch={setSearch}
        statusSet={statusSet}
        toggleStatus={toggleStatus}
        phaseSet={phaseSet}
        togglePhase={togglePhase}
        clearAll={clearAll}
        activeCount={activeFiltersCount}
      />

      <AiAutomationPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        projectUuid={projectUuid}
        projectCode={projectCode || projectHumanId}
      />
    </div>
  );
}