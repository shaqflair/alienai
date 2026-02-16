// src/components/change/ChangeTimeline.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type UiEvent = {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  comment: string | null;
  payload?: any;
  created_at: string;
};

type ApproverState = "pending" | "approved" | "rejected" | "rework" | "n/a";

type Approver = {
  user_id: string;
  name: string;
  role: string;
  state: ApproverState;
  email?: string | null;
  avatar_url?: string | null;
};

type DecisionInfo = {
  decision_status: string;
  decision_by: string | null;
  decision_at: string | null;
  decision_role: string | null;
  decision_rationale: string | null;
  delivery_lane: string | null;
  quorum_required?: number | null;
  quorum_rule?: "unanimous" | "majority" | "count" | null;
  sla_due_at?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  projectCode?: string;
  changeId: string;
  changeCode?: string;
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function shortId(x?: string, n = 6) {
  const s = safeStr(x).trim();
  return s ? s.slice(0, n) : "";
}

function isUuidFallbackProjectDisplay(display: string, projectId: string) {
  const d = safeStr(display).trim().toLowerCase();
  const short = shortId(projectId, 6).toLowerCase();
  return Boolean(d && short && d === `prj-${short}`);
}

// ✅ UK-friendly time + 24h
function timeOnly(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return iso;
  }
}

// ✅ UK-friendly date
function dayLabel(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
  } catch {
    return iso.slice(0, 10);
  }
}

function niceStatus(x: string | null) {
  const v = safeStr(x).trim();
  if (!v) return "—";
  return v.replaceAll("_", " ");
}

function statusTone(statusRaw: string | null): string {
  const s = safeStr(statusRaw).trim().toLowerCase();

  // ✅ support delivery lanes too
  if (s === "intake") return "bg-sky-100 text-sky-700 border-sky-200";

  if (s === "new") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (s === "analysis") return "bg-indigo-100 text-indigo-700 border-indigo-200";
  if (s === "review") return "bg-amber-100 text-amber-700 border-amber-200";
  if (s === "in_progress") return "bg-violet-100 text-violet-700 border-violet-200";
  if (s === "implemented") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (s === "closed") return "bg-blue-100 text-blue-700 border-blue-200";

  if (s === "approved") return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (s === "rejected") return "bg-rose-100 text-rose-700 border-rose-200";
  if (s === "submitted") return "bg-amber-100 text-amber-700 border-amber-200";
  if (s === "rework") return "bg-indigo-100 text-indigo-700 border-indigo-200";

  return "bg-gray-100 text-gray-600 border-gray-200";
}

function iconFor(ev: UiEvent) {
  const t = safeStr(ev.event_type).trim().toLowerCase();
  if (t === "created") return "✨";
  if (t === "edited") return "✏️";
  if (t === "comment") return "💬";
  if (t === "status_changed") {
    const to = safeStr(ev.to_status).trim().toLowerCase();
    const payloadDecision = safeStr(ev.payload?.decision_status).trim().toLowerCase();
    const decision = to || payloadDecision;
    if (decision === "approved") return "✅";
    if (decision === "rejected") return "❌";
    if (decision === "submitted" || ev.payload?.sla_start) return "📨";
    return "🔁";
  }
  return "•";
}

function eventLabel(ev: UiEvent) {
  const t = safeStr(ev.event_type).trim().toLowerCase();
  if (t === "status_changed") return "Status change";
  if (t === "comment") return "Comment";
  if (t === "created") return "Created";
  if (t === "edited") return "Edited";
  return t ? t.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Event";
}

type CompactEvent = UiEvent & {
  __count?: number;
  __first_at?: string;
  __last_at?: string;
  __is_compact?: boolean;
};

function approvalBadgeFromDecision(decision: string) {
  const d = decision.trim().toLowerCase();
  if (d === "approved") return { label: "Approved", tone: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (d === "rejected") return { label: "Rejected", tone: "bg-rose-100 text-rose-700 border-rose-200" };
  if (d === "rework") return { label: "Rework", tone: "bg-indigo-100 text-indigo-700 border-indigo-200" };
  if (d === "submitted" || d === "proposed") return { label: "Submitted", tone: "bg-amber-100 text-amber-700 border-amber-200" };
  return null;
}

function approvalBadgeFromEvent(ev: UiEvent) {
  const to = safeStr(ev.to_status).trim().toLowerCase();
  const payloadDecision = safeStr(ev.payload?.decision_status).trim().toLowerCase();
  const decision = to || payloadDecision;
  if (decision === "approved") return { label: "Approved", tone: "bg-emerald-100 text-emerald-700 border-emerald-200" };
  if (decision === "rejected") return { label: "Rejected", tone: "bg-rose-100 text-rose-700 border-rose-200" };
  if (decision === "rework") return { label: "Rework", tone: "bg-indigo-100 text-indigo-700 border-indigo-200" };
  if (decision === "submitted" || ev.payload?.sla_start) return { label: "Submitted", tone: "bg-amber-100 text-amber-700 border-amber-200" };
  return null;
}

function compactConsecutiveApprovals(items: UiEvent[]) {
  const out: CompactEvent[] = [];
  for (const ev of items) {
    const prev = out[out.length - 1];
    const evB = approvalBadgeFromEvent(ev);
    const prevB = prev ? approvalBadgeFromEvent(prev) : null;
    const canCompact =
      prev &&
      safeStr(ev.event_type).toLowerCase() === "status_changed" &&
      safeStr(prev.event_type).toLowerCase() === "status_changed" &&
      evB &&
      prevB &&
      evB.label === prevB.label &&
      safeStr(ev.actor_role) === safeStr(prev.actor_role);

    if (canCompact) {
      const c = (prev.__count ?? 1) + 1;
      prev.__count = c;
      prev.__is_compact = true;
      prev.__first_at = prev.__first_at ?? prev.created_at;
      prev.__last_at = ev.created_at;
      prev.created_at = ev.created_at;
      continue;
    }
    out.push({ ...(ev as any) });
  }
  return out;
}

function initials(name: string) {
  const s = safeStr(name).trim();
  if (!s) return "A";
  const parts = s.split(/\s+/).filter(Boolean);
  const a = parts[0]?.[0] || "A";
  const b = parts.length > 1 ? parts[parts.length - 1]?.[0] : "";
  return (a + b).toUpperCase();
}

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const url = safeStr(avatarUrl).trim();
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="w-full h-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center bg-indigo-100 text-indigo-700 text-xs font-bold">
      {initials(name)}
    </div>
  );
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function fmtCountdown(ms: number) {
  const s = Math.floor(ms / 1000);
  const abs = Math.abs(s);
  const days = Math.floor(abs / 86400);
  const hrs = Math.floor((abs % 86400) / 3600);
  const mins = Math.floor((abs % 3600) / 60);
  const core = days > 0 ? `${days}d ${hrs}h` : hrs > 0 ? `${hrs}h ${mins}m` : `${mins}m`;
  return s < 0 ? `Overdue ${core}` : core;
}

function computeQuorumRequired(total: number, rule?: string | null, explicit?: number | null) {
  if (explicit && Number.isFinite(explicit) && explicit > 0) return Math.min(total, Math.floor(explicit));
  const r = safeStr(rule).trim().toLowerCase();
  if (r === "unanimous") return total;
  if (r === "count") return Math.max(1, Math.ceil(total / 2));
  // default "majority"
  return Math.max(1, Math.ceil(total / 2));
}

function findSlaStartIso(events: UiEvent[], fallbackCreatedAt?: string) {
  const startFromEvents = [...events]
    .filter((e) => Boolean(e?.payload?.sla_start) && safeStr(e?.payload?.sla_started_at).trim())
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const iso = startFromEvents.length ? safeStr(startFromEvents[startFromEvents.length - 1].payload?.sla_started_at).trim() : "";
  if (iso) return iso;
  const fb = safeStr(fallbackCreatedAt).trim();
  return fb || "";
}

export default function ChangeTimeline({ open, onClose, projectId, projectCode, changeId, changeCode }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaSeq, setMetaSeq] = useState<number | null>(null);
  const [metaPublicId, setMetaPublicId] = useState("");
  const [metaCreatedAt, setMetaCreatedAt] = useState<string>("");
  const [projectDisplayId, setProjectDisplayId] = useState<string>("");
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [decision, setDecision] = useState<DecisionInfo | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const endRef = useRef<HTMLDivElement | null>(null);

  const canLoad = Boolean(projectId && changeId);

  const changeDisplay = useMemo(() => {
    if (changeCode) return changeCode;
    if (typeof metaSeq === "number") return `CR-${metaSeq}`;
    if (metaPublicId) return metaPublicId;
    return changeId ? `CR-${shortId(changeId)}` : "—";
  }, [changeCode, metaSeq, metaPublicId, changeId]);

  const headerProject = useMemo(() => {
    const apiId = safeStr(projectDisplayId).trim();
    const pc = safeStr(projectCode).trim();
    const apiIsFallback = apiId ? isUuidFallbackProjectDisplay(apiId, projectId) : true;
    const raw = !apiIsFallback && apiId ? apiId : pc;
    if (raw) {
      if (/^prj[-\s]/i.test(raw)) return raw.replace(/\s+/g, "-").replace(/^prj/i, "PRJ");
      if (/^\d+$/.test(raw)) return `PRJ-${raw}`;
      const stripped = raw.replace(/^id\s*:\s*/i, "").trim();
      if (!stripped) return `PRJ-${shortId(projectId)}`;
      return /^prj[-\s]/i.test(stripped)
        ? stripped.replace(/\s+/g, "-").replace(/^prj/i, "PRJ")
        : `PRJ-${stripped}`;
    }
    return `PRJ-${shortId(projectId)}`;
  }, [projectDisplayId, projectCode, projectId]);

  const jumpToLatest = useCallback(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  const load = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setErr("");

    try {
      const evRes = await fetch(
        `/api/change-events?projectId=${encodeURIComponent(projectId)}&changeId=${encodeURIComponent(changeId)}`,
        { cache: "no-store" }
      );
      const evJson = await evRes.json().catch(() => ({}));
      if (!evRes.ok || evJson.ok === false) throw new Error(evJson.error || "Failed to load timeline");
      setEvents(Array.isArray(evJson.items) ? evJson.items : []);

      const crRes = await fetch(`/api/change/${encodeURIComponent(changeId)}`, { cache: "no-store" });
      const crJson = await crRes.json().catch(() => ({}));
      if (crRes.ok && crJson.ok !== false) {
        const row = crJson.item ?? crJson.data ?? crJson;
        const seqNum = Number(row?.seq);
        setMetaSeq(Number.isFinite(seqNum) ? seqNum : null);
        setMetaPublicId(safeStr(row?.public_id) || "");
        setMetaTitle(safeStr(row?.title) || "");
        setMetaCreatedAt(safeStr(row?.created_at) || "");
      }

      const apRes = await fetch(
        `/api/change-approvers?projectId=${encodeURIComponent(projectId)}&changeId=${encodeURIComponent(changeId)}`,
        { cache: "no-store" }
      );
      const apJson = await apRes.json().catch(() => ({}));
      if (apRes.ok && apJson.ok !== false) {
        setProjectDisplayId(safeStr(apJson.projectDisplayId));
        setDecision(apJson.decision ?? null);
        setApprovers(Array.isArray(apJson.approvers) ? apJson.approvers : []);
      }
    } catch (e: any) {
      setErr(e?.message || "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [canLoad, projectId, changeId]);

  useEffect(() => {
    if (open) {
      load().then(() => setTimeout(() => jumpToLatest(), 60));
    }
  }, [open, load, jumpToLatest]);

  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [open]);

  const grouped = useMemo(() => {
    const sorted = [...events].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const map = new Map<string, UiEvent[]>();
    for (const ev of sorted) {
      const k = dayLabel(ev.created_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(ev);
    }
    const days = Array.from(map.keys()).sort((a, b) => {
      const da = new Date(map.get(a)![0].created_at).getTime();
      const db = new Date(map.get(b)![0].created_at).getTime();
      return da - db;
    });
    return days.map((day) => ({ day, items: compactConsecutiveApprovals(map.get(day)!) }));
  }, [events]);

  const approvalSummary = useMemo(() => {
    const dRaw = decision?.decision_status ? decision.decision_status.toLowerCase() : "proposed";
    const badge = approvalBadgeFromDecision(dRaw);
    const approved = approvers.filter((a) => a.state === "approved");
    const rejected = approvers.filter((a) => a.state === "rejected");
    const rework = approvers.filter((a) => a.state === "rework");
    const pending = approvers.filter((a) => a.state === "pending");
    const total = approvers.length;

    // ✅ FIX: use real rule (default unanimous if missing)
    const rule = decision?.quorum_rule ?? "unanimous";
    const required = computeQuorumRequired(total, rule, decision?.quorum_required ?? null);

    const approvedCount = approved.length;
    const rejectedCount = rejected.length;

    const quorumProgress = total > 0 ? clamp(approvedCount / Math.max(1, required), 0, 1) : 0;

    let dueAtIso = safeStr(decision?.sla_due_at).trim();
    const slaStartIso = findSlaStartIso(events, metaCreatedAt);
    if (!dueAtIso) {
      const base = safeStr(slaStartIso).trim();
      if (base) {
        const baseMs = new Date(base).getTime();
        if (!Number.isNaN(baseMs)) {
          const dueMs = baseMs + 48 * 3600 * 1000;
          dueAtIso = new Date(dueMs).toISOString();
        }
      }
    }
    const dueMs = dueAtIso ? new Date(dueAtIso).getTime() : NaN;
    const nowMs = nowTick;
    const hasDue = Number.isFinite(dueMs);
    const msLeft = hasDue ? dueMs - nowMs : NaN;
    const overdue = hasDue ? msLeft < 0 : false;

    const done = dRaw === "approved" || dRaw === "rejected" || dRaw === "rework";

    const unanimousBroken = rule === "unanimous" && rejectedCount > 0;
    const quorumMet = total > 0 && approvedCount >= required && !unanimousBroken;

    return {
      badge,
      approved,
      rejected,
      rework,
      pending,
      total,
      required,
      approvedCount,
      rejectedCount,
      quorumProgress,
      dueAtIso: hasDue ? dueAtIso : "",
      msLeft: hasDue ? msLeft : NaN,
      overdue,
      done,
      slaStartIso,
      quorumMet,
      unanimousBroken,
      decisionStatusRaw: dRaw,
      rule,
    };
  }, [approvers, decision, metaCreatedAt, nowTick, events]);

  const postComment = useCallback(async () => {
    const text = commentDraft.trim();
    if (!text) return;
    setPosting(true);
    setErr("");
    try {
      const res = await fetch(`/api/change-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          changeId,
          comment: text,
          payload: { source: "timeline_inline", at: new Date().toISOString() },
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.ok === false) throw new Error(json.error || "Failed to post comment");
      setCommentDraft("");
      await load();
      setTimeout(() => jumpToLatest(), 60);
    } catch (e: any) {
      setErr(e?.message || "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }, [commentDraft, projectId, changeId, load, jumpToLatest]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <aside className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl border-l border-gray-200 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-gray-900">Timeline</h2>
            <div className="flex items-center gap-2 mt-1 text-sm text-gray-500">
              <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                {headerProject}
              </span>
              <span>•</span>
              <span className="inline-flex items-center px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                {changeDisplay}
              </span>
            </div>
            {metaTitle && <div className="text-sm text-gray-600 mt-1 truncate">{metaTitle}</div>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={jumpToLatest}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Latest
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              aria-label="Close"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && <div className="text-sm text-gray-500">Loading…</div>}
          {err && <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700">{err}</div>}

          {/* Approvals Panel */}
          <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-semibold text-gray-900">Approvals</h3>
                {approvalSummary.badge ? (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${approvalSummary.badge.tone}`}>
                    {approvalSummary.badge.label}
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200">
                    Pending
                  </span>
                )}
                {decision?.decision_at && (
                  <span className="text-xs text-gray-500">
                    {dayLabel(decision.decision_at)} {timeOnly(decision.decision_at)}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {approvalSummary.dueAtIso && (
                  <span
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                      approvalSummary.overdue
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : "bg-amber-50 text-amber-700 border-amber-200"
                    }`}
                    title={`SLA due: ${dayLabel(approvalSummary.dueAtIso)} ${timeOnly(approvalSummary.dueAtIso)} • Started: ${
                      approvalSummary.slaStartIso ? `${dayLabel(approvalSummary.slaStartIso)} ${timeOnly(approvalSummary.slaStartIso)}` : "—"
                    }`}
                  >
                    {approvalSummary.done ? "SLA closed" : fmtCountdown(approvalSummary.msLeft)}
                  </span>
                )}
                {approvalSummary.total > 0 && (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    approvalSummary.unanimousBroken
                      ? "bg-rose-50 text-rose-700 border-rose-200"
                      : approvalSummary.quorumMet
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : "bg-gray-50 text-gray-600 border-gray-200"
                  }`}>
                    {approvalSummary.rule === "unanimous" ? "Unanimous" : "Quorum"} {approvalSummary.approvedCount}/{approvalSummary.required}
                  </span>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            {approvalSummary.total > 0 && (
              <div className="space-y-2">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden border border-gray-200">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      approvalSummary.unanimousBroken ? "bg-rose-400" : "bg-emerald-500"
                    }`}
                    style={{ width: `${Math.round(clamp(approvalSummary.quorumProgress, 0, 1) * 100)}%` }}
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>
                    Approved: <span className="font-semibold text-emerald-600">{approvalSummary.approvedCount}</span>
                    {approvalSummary.rejectedCount > 0 && (
                      <span className="ml-2">Rejected: <span className="font-semibold text-rose-600">{approvalSummary.rejectedCount}</span></span>
                    )}
                    <span className="ml-2">Total: <span className="font-semibold">{approvalSummary.total}</span></span>
                  </span>
                  <span className="font-medium">Rule: {approvalSummary.rule || "unanimous"}</span>
                </div>
              </div>
            )}

            {/* Approver Lists */}
            <div className="space-y-3">
              {approvalSummary.approved.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2">Approved by</div>
                  <div className="flex flex-wrap gap-2">
                    {approvalSummary.approved.map((a) => (
                      <div key={a.user_id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-emerald-200 rounded-full text-sm">
                        <div className="w-6 h-6 rounded-full overflow-hidden bg-emerald-50">
                          <Avatar name={a.name} avatarUrl={a.avatar_url} />
                        </div>
                        <span className="font-medium text-gray-900">{a.name}</span>
                        <span className="text-gray-500 text-xs">({a.role})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {approvalSummary.rejected.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2">Rejected by</div>
                  <div className="flex flex-wrap gap-2">
                    {approvalSummary.rejected.map((a) => (
                      <div key={a.user_id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-rose-200 rounded-full text-sm">
                        <div className="w-6 h-6 rounded-full overflow-hidden bg-rose-50">
                          <Avatar name={a.name} avatarUrl={a.avatar_url} />
                        </div>
                        <span className="font-medium text-gray-900">{a.name}</span>
                        <span className="text-gray-500 text-xs">({a.role})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {approvalSummary.rework.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2">Sent back for rework</div>
                  <div className="flex flex-wrap gap-2">
                    {approvalSummary.rework.map((a) => (
                      <div key={a.user_id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-indigo-200 rounded-full text-sm">
                        <div className="w-6 h-6 rounded-full overflow-hidden bg-indigo-50">
                          <Avatar name={a.name} avatarUrl={a.avatar_url} />
                        </div>
                        <span className="font-medium text-gray-900">{a.name}</span>
                        <span className="text-gray-500 text-xs">({a.role})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {approvalSummary.pending.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-gray-500 mb-2">Pending approval</div>
                  <div className="flex flex-wrap gap-2">
                    {approvalSummary.pending.map((a) => (
                      <div key={a.user_id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-amber-200 rounded-full text-sm">
                        <div className="w-6 h-6 rounded-full overflow-hidden bg-amber-50">
                          <Avatar name={a.name} avatarUrl={a.avatar_url} />
                        </div>
                        <span className="font-medium text-gray-900">{a.name}</span>
                        <span className="text-gray-500 text-xs">({a.role})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {approvers.length === 0 && (
                <div className="text-sm text-gray-500">No approver list found for this project.</div>
              )}
            </div>

            {decision?.decision_rationale && (
              <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">
                <span className="font-semibold">Decision note:</span> {decision.decision_rationale}
              </div>
            )}
          </div>

          {/* Timeline Events */}
          {!loading && !err && events.length === 0 && <div className="text-sm text-gray-500">No events yet</div>}

          {!loading && !err && grouped.map((g) => (
            <div key={g.day}>
              <div className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur border border-gray-200 rounded-lg px-3 py-2 mb-3">
                <span className="text-sm font-semibold text-gray-700">{g.day}</span>
              </div>

              <div className="space-y-3">
                {g.items.map((ev) => {
                  const badge = approvalBadgeFromEvent(ev);
                  const isStatus = safeStr(ev.event_type).toLowerCase() === "status_changed";
                  const fromTone = statusTone(ev.from_status);
                  const toTone = statusTone(ev.to_status);
                  const count = (ev as CompactEvent).__count ?? 1;
                  const compacted = Boolean((ev as CompactEvent).__is_compact);
                  const timeLabel = compacted
                    ? `${timeOnly((ev as CompactEvent).__first_at || ev.created_at)}–${timeOnly((ev as CompactEvent).__last_at || ev.created_at)}`
                    : timeOnly(ev.created_at);

                  return (
                    <div key={ev.id} className="flex gap-3 p-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors">
                      <div className="w-6 h-6 flex items-center justify-center text-lg shrink-0" title={safeStr(ev.event_type)}>
                        {iconFor(ev)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-gray-900">{eventLabel(ev)}</span>

                            {isStatus && (
                              <div className="flex items-center gap-1.5">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${fromTone}`}>
                                  {niceStatus(ev.from_status)}
                                </span>
                                <span className="text-gray-400">→</span>
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${toTone}`}>
                                  {niceStatus(ev.to_status)}
                                </span>
                              </div>
                            )}

                            {badge && (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${badge.tone}`}>
                                {badge.label}
                                {count > 1 && ` ×${count}`}
                              </span>
                            )}
                          </div>

                          <span className="text-xs text-gray-500 shrink-0">{timeLabel}</span>
                        </div>

                        {ev.actor_role && <div className="text-xs text-gray-500 mt-1">by {ev.actor_role}</div>}
                        {ev.comment && <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700">{ev.comment}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Comment Composer */}
          <div className="pt-4 border-t border-gray-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Add a comment</span>
              <button
                className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                onClick={postComment}
                disabled={posting || !commentDraft.trim()}
              >
                {posting ? "Posting…" : "Post"}
              </button>
            </div>
            <textarea
              className="w-full p-3 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y min-h-[80px]"
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="Type a comment…"
            />
          </div>

          <div ref={endRef} className="h-1" />
        </div>
      </aside>
    </div>
  );
}
