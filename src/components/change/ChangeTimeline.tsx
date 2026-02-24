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

/* ── utils (all original logic preserved) ── */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function shortId(x?: string, n = 6) {
  return safeStr(x).trim().slice(0, n);
}
function isUuidFallbackProjectDisplay(display: string, projectId: string) {
  const d = safeStr(display).trim().toLowerCase();
  const short = shortId(projectId, 6).toLowerCase();
  return Boolean(d && short && d === `prj-${short}`);
}
function timeOnly(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  } catch {
    return iso;
  }
}
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
  return Math.max(1, Math.ceil(total / 2));
}
function findSlaStartIso(events: UiEvent[], fallbackCreatedAt?: string) {
  const startFromEvents = [...events]
    .filter((e) => Boolean(e?.payload?.sla_start) && safeStr(e?.payload?.sla_started_at).trim())
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  const iso = startFromEvents.length
    ? safeStr(startFromEvents[startFromEvents.length - 1].payload?.sla_started_at).trim()
    : "";
  return iso || safeStr(fallbackCreatedAt).trim() || "";
}
function initials(name: string) {
  const s = safeStr(name).trim();
  if (!s) return "A";
  const parts = s.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "A") + (parts.length > 1 ? parts[parts.length - 1]?.[0] : "")).toUpperCase();
}

/* ── status/event coloring ── */

type RAGTone = "green" | "amber" | "red" | "blue" | "indigo" | "violet" | "neutral";

function statusRAG(s: string | null): RAGTone {
  const v = safeStr(s).toLowerCase();
  if (v === "approved" || v === "implemented" || v === "new") return "green";
  if (v === "rejected") return "red";
  if (v === "review" || v === "submitted" || v === "intake") return "amber";
  if (v === "analysis" || v === "rework") return "indigo";
  if (v === "in_progress") return "violet";
  if (v === "closed") return "blue";
  return "neutral";
}

const RAG_PILL: Record<RAGTone, string> = {
  green: "ct-pill-green",
  amber: "ct-pill-amber",
  red: "ct-pill-red",
  blue: "ct-pill-blue",
  indigo: "ct-pill-indigo",
  violet: "ct-pill-violet",
  neutral: "ct-pill-neutral",
};

function approvalBadgeFromDecision(decision: string) {
  const d = decision.trim().toLowerCase();
  if (d === "approved") return { label: "Approved", rag: "green" as RAGTone };
  if (d === "rejected") return { label: "Rejected", rag: "red" as RAGTone };
  if (d === "rework") return { label: "Rework", rag: "indigo" as RAGTone };
  if (d === "submitted" || d === "proposed") return { label: "Submitted", rag: "amber" as RAGTone };
  return null;
}

function approvalBadgeFromEvent(ev: UiEvent) {
  const to = safeStr(ev.to_status).toLowerCase();
  const pd = safeStr(ev.payload?.decision_status).toLowerCase();
  const d = to || pd;
  if (d === "approved") return { label: "Approved", rag: "green" as RAGTone };
  if (d === "rejected") return { label: "Rejected", rag: "red" as RAGTone };
  if (d === "rework") return { label: "Rework", rag: "indigo" as RAGTone };
  if (d === "submitted" || ev.payload?.sla_start) return { label: "Submitted", rag: "amber" as RAGTone };
  return null;
}

/* =========================================================
   approval_events → UiEvent mapping (NEW)
========================================================= */

function mapApprovalActionToLane(actionType: string): { from: string | null; to: string | null; decision?: string | null } {
  const a = safeStr(actionType).trim().toLowerCase();

  if (a === "submitted") return { from: "analysis", to: "review", decision: "submitted" };
  if (a === "approved_step") return { from: "review", to: "review", decision: "submitted" };
  if (a === "approved_final") return { from: "review", to: "in_progress", decision: "approved" };
  if (a === "rejected_step") return { from: "review", to: "review", decision: "submitted" };
  if (a === "rejected_final") return { from: "review", to: "analysis", decision: "rejected" };
  if (a === "request_changes") return { from: "review", to: "analysis", decision: "rework" };

  return { from: null, to: null, decision: null };
}

function approvalEventToUiEvent(ev: any): UiEvent {
  const action = safeStr(ev?.action_type).trim();
  const mapped = mapApprovalActionToLane(action);

  const actorRole =
    safeStr(ev?.actor_role).trim() ||
    (action.toLowerCase().includes("approved") || action.toLowerCase().includes("rejected") ? "approver" : "editor");

  return {
    id: safeStr(ev?.id) || `approval_${Math.random().toString(16).slice(2)}`,
    actor_user_id: ev?.actor_user_id ? String(ev.actor_user_id) : null,
    actor_role: actorRole || null,
    event_type: "status_changed",
    from_status: mapped.from,
    to_status: mapped.to,
    comment: safeStr(ev?.comment) || null,
    payload: {
      ...(ev?.meta && typeof ev.meta === "object" ? ev.meta : {}),
      source: "approval_events",
      action_type: action,
      decision_status: mapped.decision,
      step_id: ev?.step_id ? String(ev.step_id) : null,
      chain_id: safeStr(ev?.meta?.approval_chain_id) || safeStr(ev?.meta?.chain_id) || null,
      actor_name: safeStr(ev?.actor_name) || null,
    },
    created_at: safeStr(ev?.created_at) || new Date().toISOString(),
  };
}

/* ── compact consecutive events (original logic) ── */

type CompactEvent = UiEvent & {
  __count?: number;
  __first_at?: string;
  __last_at?: string;
  __is_compact?: boolean;
};

function compactConsecutiveApprovals(items: UiEvent[]): CompactEvent[] {
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
      prev.__count = (prev.__count ?? 1) + 1;
      prev.__is_compact = true;
      prev.__first_at = prev.__first_at ?? prev.created_at;
      prev.__last_at = ev.created_at;
      prev.created_at = ev.created_at;
    } else {
      out.push({ ...ev });
    }
  }
  return out;
}

/* ── event display helpers ── */

function iconFor(ev: UiEvent) {
  const t = safeStr(ev.event_type).toLowerCase();
  if (t === "created") return "✨";
  if (t === "edited") return "✏️";
  if (t === "comment") return "💬";
  if (t === "status_changed") {
    const to = safeStr(ev.to_status).toLowerCase();
    const pd = safeStr(ev.payload?.decision_status).toLowerCase();
    const d = to || pd;
    if (d === "approved") return "✅";
    if (d === "rejected") return "❌";
    if (d === "submitted" || ev.payload?.sla_start) return "📨";
    return "🔁";
  }
  return "•";
}

function eventLabel(ev: UiEvent) {
  const t = safeStr(ev.event_type).toLowerCase();
  if (t === "status_changed") return "Status change";
  if (t === "comment") return "Comment";
  if (t === "created") return "Created";
  if (t === "edited") return "Edited";
  return t ? t.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Event";
}

/* ── Avatar ── */

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const url = safeStr(avatarUrl).trim();
  if (url) return <img src={url} alt={name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />;
  return (
    <div className="w-full h-full flex items-center justify-center text-[10px] font-bold" style={{ color: "#6366f1" }}>
      {initials(name)}
    </div>
  );
}

/* ════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════ */

export default function ChangeTimeline({ open, onClose, projectId, projectCode, changeId, changeCode }: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [events, setEvents] = useState<UiEvent[]>([]);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaSeq, setMetaSeq] = useState<number | null>(null);
  const [metaPublicId, setMetaPublicId] = useState("");
  const [metaCreatedAt, setMetaCreatedAt] = useState("");
  const [projectDisplayId, setProjectDisplayId] = useState("");
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const [decision, setDecision] = useState<DecisionInfo | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [mounted, setMounted] = useState(false);
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
      // 1) change_events
      const evRes = await fetch(
        `/api/change-events?projectId=${encodeURIComponent(projectId)}&changeId=${encodeURIComponent(changeId)}`,
        { cache: "no-store" }
      );
      const evJson = await evRes.json().catch(() => ({}));
      if (!evRes.ok || evJson.ok === false) throw new Error(evJson.error || "Failed to load timeline");
      const baseEvents: UiEvent[] = Array.isArray(evJson.items) ? evJson.items : [];

      // 2) change row -> includes artifact_id (used to fetch approval_events)
      let artifactId = "";
      const crRes = await fetch(`/api/change/${encodeURIComponent(changeId)}`, { cache: "no-store" });
      const crJson = await crRes.json().catch(() => ({}));
      if (crRes.ok && crJson.ok !== false) {
        const row = crJson.item ?? crJson.data ?? crJson;
        const seqNum = Number(row?.seq);
        setMetaSeq(Number.isFinite(seqNum) ? seqNum : null);
        setMetaPublicId(safeStr(row?.public_id) || "");
        setMetaTitle(safeStr(row?.title) || "");
        setMetaCreatedAt(safeStr(row?.created_at) || "");
        artifactId = safeStr(row?.artifact_id).trim();
      }

      // 3) approvers panel
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

      // 4) approval_events (NEW) -> merge into timeline
      let approvalUi: UiEvent[] = [];
      if (artifactId) {
        const aeRes = await fetch(
          `/api/approval-events?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(
            artifactId
          )}&changeId=${encodeURIComponent(changeId)}`,
          { cache: "no-store" }
        );
        const aeJson = await aeRes.json().catch(() => ({}));
        if (aeRes.ok && aeJson.ok !== false) {
          const raw = Array.isArray(aeJson.items) ? aeJson.items : [];
          approvalUi = raw.map(approvalEventToUiEvent);
        }
      }

      // merge + sort + dedupe
      const merged = [...baseEvents, ...approvalUi]
        .filter(Boolean)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      const seen = new Set<string>();
      const deduped = merged.filter((e) => {
        const k = safeStr(e?.id);
        if (!k) return true;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      setEvents(deduped);
    } catch (e: any) {
      setErr(e?.message || "Failed to load timeline");
    } finally {
      setLoading(false);
    }
  }, [canLoad, projectId, changeId]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      load().then(() => setTimeout(jumpToLatest, 60));
    } else {
      setMounted(false);
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
    const dRaw = decision?.decision_status?.toLowerCase() ?? "proposed";
    const badge = approvalBadgeFromDecision(dRaw);
    const approved = approvers.filter((a) => a.state === "approved");
    const rejected = approvers.filter((a) => a.state === "rejected");
    const rework = approvers.filter((a) => a.state === "rework");
    const pending = approvers.filter((a) => a.state === "pending");
    const total = approvers.length;
    const rule = decision?.quorum_rule ?? "unanimous";
    const required = computeQuorumRequired(total, rule, decision?.quorum_required ?? null);
    const approvedCount = approved.length;
    const rejectedCount = rejected.length;
    const quorumProgress = total > 0 ? clamp(approvedCount / Math.max(1, required), 0, 1) : 0;

    let dueAtIso = safeStr(decision?.sla_due_at).trim();
    const slaStartIso = findSlaStartIso(events, metaCreatedAt);
    if (!dueAtIso) {
      const baseMs = new Date(slaStartIso).getTime();
      if (!Number.isNaN(baseMs)) dueAtIso = new Date(baseMs + 48 * 3600 * 1000).toISOString();
    }
    const dueMs = dueAtIso ? new Date(dueAtIso).getTime() : NaN;
    const hasDue = Number.isFinite(dueMs);
    const msLeft = hasDue ? dueMs - nowTick : NaN;
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
      setTimeout(jumpToLatest, 60);
    } catch (e: any) {
      setErr(e?.message || "Failed to post comment");
    } finally {
      setPosting(false);
    }
  }, [commentDraft, projectId, changeId, load, jumpToLatest]);

  if (!open) return null;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');

        .ct-root * { box-sizing: border-box; }

        .ct-root {
          --bg:           #f8f9fc;
          --surface:      #ffffff;
          --panel:        #ffffff;
          --glass:        rgba(255,255,255,0.82);
          --glass-heavy:  rgba(255,255,255,0.95);
          --border:       rgba(0,0,0,0.07);
          --border-hi:    rgba(99,102,241,0.25);
          --border-shine: rgba(255,255,255,0.9);
          --text:         #0f1117;
          --text-mid:     #4b5563;
          --text-dim:     #9ca3af;
          --accent:       #6366f1;
          --accent-alt:   #8b5cf6;
          --accent-soft:  rgba(99,102,241,0.08);
          --green:        #059669;
          --amber:        #d97706;
          --red:          #dc2626;
          --sky:          #0284c7;
          --shadow-sm:    0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
          --shadow-md:    0 4px 16px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04);
          --shadow-lg:    0 20px 60px rgba(0,0,0,0.12), 0 4px 16px rgba(0,0,0,0.06);
          --shine:        linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0.1) 100%);
          font-family: 'DM Sans', system-ui, sans-serif;
          color: var(--text);
        }

        /* ── Animations ── */
        @keyframes ct-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes ct-fade-up {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ct-shimmer {
          0%   { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        @keyframes ct-pulse-dot {
          0%,100% { opacity: 1; transform: scale(1); box-shadow: 0 0 0 0 rgba(16,185,129,0.4); }
          50%      { opacity: .7; transform: scale(.85); box-shadow: 0 0 0 4px rgba(16,185,129,0); }
        }

        .ct-panel { animation: ct-slide-in .32s cubic-bezier(.22,.68,0,1.1); }
        .ct-event-row { animation: ct-fade-up .2s ease both; }
        .ct-live-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: #10b981;
          animation: ct-pulse-dot 2.5s ease infinite;
          flex-shrink: 0;
        }

        /* ── Scrollbar ── */
        .ct-scroll::-webkit-scrollbar { width: 4px; }
        .ct-scroll::-webkit-scrollbar-track { background: transparent; }
        .ct-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 2px; }
        .ct-scroll::-webkit-scrollbar-thumb:hover { background: rgba(99,102,241,0.3); }

        /* ── Glossy card base ── */
        .ct-glass-card {
          background: var(--glass-heavy);
          border: 1px solid var(--border);
          border-radius: 16px;
          box-shadow: var(--shadow-md),
                      inset 0 1px 0 rgba(255,255,255,0.9),
                      inset 0 -1px 0 rgba(0,0,0,0.03);
          position: relative;
          overflow: hidden;
        }
        .ct-glass-card::before {
          content: '';
          position: absolute;
          inset: 0;
          background: linear-gradient(160deg, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0) 60%);
          pointer-events: none;
          border-radius: inherit;
        }

        /* ── Pills ── */
        .ct-pill {
          display: inline-flex; align-items: center;
          padding: 3px 11px; border-radius: 999px;
          font-size: 11px; font-weight: 600; letter-spacing: .02em;
          border: 1px solid transparent;
          font-family: 'DM Sans', sans-serif;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.7);
        }
        .ct-pill-green  { background: linear-gradient(135deg,#dcfce7,#bbf7d0); color: #065f46; border-color: rgba(16,185,129,0.2); }
        .ct-pill-amber  { background: linear-gradient(135deg,#fef3c7,#fde68a); color: #78350f; border-color: rgba(245,158,11,0.2); }
        .ct-pill-red    { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #7f1d1d; border-color: rgba(239,68,68,0.2); }
        .ct-pill-blue   { background: linear-gradient(135deg,#dbeafe,#bfdbfe); color: #1e3a5f; border-color: rgba(59,130,246,0.2); }
        .ct-pill-indigo { background: linear-gradient(135deg,#e0e7ff,#c7d2fe); color: #312e81; border-color: rgba(99,102,241,0.2); }
        .ct-pill-violet { background: linear-gradient(135deg,#ede9fe,#ddd6fe); color: #3b0764; border-color: rgba(139,92,246,0.2); }
        .ct-pill-neutral{ background: linear-gradient(135deg,#f3f4f6,#e5e7eb); color: #374151; border-color: rgba(0,0,0,0.08); }

        .ct-sla-ok    { background: linear-gradient(135deg,#fef3c7,#fde68a); color: #78350f; border-color: rgba(245,158,11,0.2); }
        .ct-sla-over  { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #7f1d1d; border-color: rgba(239,68,68,0.2); }
        .ct-sla-done  { background: linear-gradient(135deg,#f3f4f6,#e5e7eb); color: #6b7280; border-color: rgba(0,0,0,0.08); }

        .ct-quorum-met   { background: linear-gradient(135deg,#dcfce7,#bbf7d0); color: #065f46; border-color: rgba(16,185,129,0.2); }
        .ct-quorum-pend  { background: linear-gradient(135deg,#f3f4f6,#e5e7eb); color: #6b7280; border-color: rgba(0,0,0,0.08); }
        .ct-quorum-broke { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #7f1d1d; border-color: rgba(239,68,68,0.2); }

        .ct-tag {
          display: inline-flex; align-items: center;
          padding: 3px 9px; border-radius: 6px;
          font-size: 10.5px; font-weight: 500;
          font-family: 'DM Mono', monospace;
          background: rgba(99,102,241,0.07);
          border: 1px solid rgba(99,102,241,0.15);
          color: var(--accent);
          letter-spacing: .03em;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.8);
        }

        .ct-textarea {
          width: 100%;
          background: rgba(248,249,252,0.8);
          border: 1.5px solid rgba(0,0,0,0.09);
          border-radius: 12px;
          color: var(--text);
          font-family: 'DM Sans', sans-serif;
          font-size: 13px;
          padding: 12px 14px;
          resize: vertical;
          min-height: 88px;
          outline: none;
          transition: border-color .15s, box-shadow .15s, background .15s;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);
        }
        .ct-textarea::placeholder { color: rgba(0,0,0,.3); }
        .ct-textarea:focus {
          border-color: rgba(99,102,241,0.5);
          background: #fff;
          box-shadow: 0 0 0 3px rgba(99,102,241,0.1), inset 0 1px 3px rgba(0,0,0,0.02);
        }

        .ct-chip {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 5px 12px 5px 6px;
          border-radius: 999px;
          border: 1px solid var(--border);
          background: var(--glass-heavy);
          font-size: 12.5px; font-weight: 500; color: var(--text);
          box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.9);
          transition: box-shadow .15s, transform .1s;
        }
        .ct-chip:hover { box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,0.9); transform: translateY(-1px); }

        .ct-avatar {
          width: 26px; height: 26px;
          border-radius: 50%; overflow: hidden;
          background: linear-gradient(135deg, #e0e7ff, #ede9fe);
          flex-shrink: 0;
          box-shadow: 0 0 0 1.5px rgba(99,102,241,0.2), inset 0 1px 0 rgba(255,255,255,0.9);
        }

        .ct-timeline-line {
          position: absolute; left: 19px; top: 32px; bottom: 0;
          width: 1.5px;
          background: linear-gradient(to bottom, rgba(99,102,241,0.15), rgba(99,102,241,0.03));
        }

        .ct-event {
          background: var(--glass-heavy);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 14px 16px;
          box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,1);
          transition: box-shadow .18s, transform .12s, border-color .15s;
          position: relative;
          overflow: hidden;
        }
        .ct-event::before {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 50%;
          background: linear-gradient(180deg, rgba(255,255,255,0.5), transparent);
          pointer-events: none;
        }
        .ct-event:hover {
          box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,1);
          transform: translateY(-1px);
          border-color: rgba(99,102,241,0.18);
        }

        .ct-progress-track {
          height: 4px;
          border-radius: 999px;
          background: rgba(0,0,0,0.06);
          overflow: hidden;
          box-shadow: inset 0 1px 2px rgba(0,0,0,0.08);
        }
        .ct-progress-fill {
          height: 100%;
          border-radius: 999px;
          transition: width .6s cubic-bezier(.22,.68,0,1);
          position: relative;
          overflow: hidden;
        }
        .ct-progress-fill::after {
          content: '';
          position: absolute;
          top: 0; left: -100%;
          width: 60%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
          animation: ct-shimmer 2s linear infinite;
        }

        .ct-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          padding: 8px 16px;
          border-radius: 10px;
          font-size: 12.5px; font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          border: none; cursor: pointer;
          transition: all .15s;
          position: relative;
          overflow: hidden;
        }
        .ct-btn::after {
          content: '';
          position: absolute;
          top: 0; left: 0; right: 0;
          height: 50%;
          background: linear-gradient(180deg, rgba(255,255,255,0.2), transparent);
          pointer-events: none;
        }
        .ct-btn:active { transform: scale(.97); }
        .ct-btn:disabled { opacity: .45; cursor: not-allowed; }

        .ct-btn-ghost {
          background: rgba(255,255,255,0.9);
          color: var(--text-mid);
          border: 1px solid var(--border);
          box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,1);
        }
        .ct-btn-ghost:hover:not(:disabled) {
          background: #fff;
          color: var(--text);
          box-shadow: var(--shadow-md), inset 0 1px 0 rgba(255,255,255,1);
          border-color: rgba(99,102,241,0.2);
        }
        .ct-btn-primary {
          background: linear-gradient(145deg, #6366f1 0%, #8b5cf6 100%);
          color: #fff;
          box-shadow: 0 2px 8px rgba(99,102,241,0.35), 0 1px 2px rgba(99,102,241,0.2), inset 0 1px 0 rgba(255,255,255,0.2);
        }
        .ct-btn-primary:hover:not(:disabled) {
          box-shadow: 0 4px 16px rgba(99,102,241,0.45), 0 1px 2px rgba(99,102,241,0.2), inset 0 1px 0 rgba(255,255,255,0.2);
          transform: translateY(-1px);
        }

        .ct-day-sep {
          display: flex; align-items: center; gap: 10px;
          position: sticky; top: 0; z-index: 10;
        }
        .ct-day-sep::before, .ct-day-sep::after {
          content: ''; flex: 1; height: 1px;
          background: linear-gradient(90deg, transparent, rgba(0,0,0,0.07), transparent);
        }

        .ct-status-arrow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }

        .ct-section-label {
          font-size: 10px; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase;
          color: var(--text-dim);
          font-family: 'DM Mono', monospace;
          margin-bottom: 10px;
        }

        .ct-icon-bubble {
          position: absolute; left: 8px; top: 14px;
          width: 24px; height: 24px; border-radius: 8px;
          background: #fff;
          border: 1px solid var(--border);
          box-shadow: var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,1);
          display: flex; align-items: center; justify-content: center;
          font-size: 13px; line-height: 1;
        }
      `}</style>

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 ct-root"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
        style={{ background: "rgba(15,17,23,0.35)", backdropFilter: "blur(8px) saturate(1.4)" }}
      >
        {/* Panel */}
        <aside
          className="ct-panel ct-scroll absolute right-0 top-0 h-full flex flex-col overflow-hidden"
          style={{
            width: "100%",
            maxWidth: 520,
            background: "var(--bg)",
            borderLeft: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "-24px 0 80px rgba(0,0,0,0.18), -2px 0 0 rgba(255,255,255,0.6)",
          }}
        >
          {/* ── Subtle background texture ── */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              zIndex: 0,
              background: `
                radial-gradient(ellipse 60% 40% at 80% -10%, rgba(99,102,241,0.06) 0%, transparent 70%),
                radial-gradient(ellipse 50% 30% at 20% 100%, rgba(139,92,246,0.04) 0%, transparent 70%),
                linear-gradient(180deg, rgba(255,255,255,0.5) 0%, transparent 30%)
              `,
            }}
          />

          {/* ── Header ── */}
          <div
            style={{
              padding: "20px 24px 16px",
              borderBottom: "1px solid rgba(0,0,0,0.07)",
              background: "rgba(255,255,255,0.9)",
              backdropFilter: "blur(12px)",
              flexShrink: 0,
              position: "relative",
              zIndex: 1,
              boxShadow: "0 1px 0 rgba(255,255,255,0.8), 0 4px 12px rgba(0,0,0,0.03)",
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div className="ct-live-dot" />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: ".12em",
                      textTransform: "uppercase",
                      color: "var(--text-dim)",
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    TIMELINE · CHANGE REVIEW
                  </span>
                </div>

                <h2
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: "var(--text)",
                    margin: 0,
                    lineHeight: 1.2,
                    marginBottom: 8,
                  }}
                >
                  {metaTitle || "Change Request"}
                </h2>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="ct-tag">{headerProject}</span>
                  <span className="ct-tag">{changeDisplay}</span>
                  {events.length > 0 && (
                    <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'DM Mono', monospace" }}>
                      {events.length} event{events.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <button className="ct-btn ct-btn-ghost" onClick={jumpToLatest} style={{ padding: "6px 12px" }}>
                  Latest ↓
                </button>
                <button className="ct-btn ct-btn-ghost" onClick={load} disabled={loading} style={{ padding: "6px 12px" }}>
                  {loading ? "…" : "↻"}
                </button>
                <button
                  onClick={onClose}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "rgba(255,255,255,0.9)",
                    boxShadow: "var(--shadow-sm), inset 0 1px 0 white",
                    cursor: "pointer",
                    color: "var(--text-mid)",
                    fontSize: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "all .15s",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(239,68,68,0.25)";
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(254,242,242,0.9)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.color = "var(--text-mid)";
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
                    (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.9)";
                  }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
          </div>

          {/* ── Scrollable body ── */}
          <div
            className="ct-scroll"
            style={{
              flex: 1,
              overflowY: "auto",
              padding: "20px 24px",
              display: "flex",
              flexDirection: "column",
              gap: 20,
              position: "relative",
              zIndex: 1,
            }}
          >
            {err && (
              <div
                style={{
                  padding: "12px 14px",
                  background: "linear-gradient(135deg, #fff5f5, #fee2e2)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  borderRadius: 12,
                  fontSize: 13,
                  color: "#b91c1c",
                  boxShadow: "var(--shadow-sm), inset 0 1px 0 rgba(255,255,255,0.7)",
                }}
              >
                {err}
              </div>
            )}

            {loading && !events.length && (
              <div style={{ color: "var(--text-dim)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
                Loading timeline…
              </div>
            )}

            {/* ── APPROVALS PANEL ── */}
            <div className="ct-glass-card" style={{ padding: "18px 18px 16px", display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Approvals</span>

                  {approvalSummary.badge ? (
                    <span className={`ct-pill ${RAG_PILL[approvalSummary.badge.rag]}`}>{approvalSummary.badge.label}</span>
                  ) : (
                    <span className="ct-pill ct-pill-neutral">Pending</span>
                  )}

                  {decision?.decision_at && (
                    <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'DM Mono', monospace" }}>
                      {dayLabel(decision.decision_at)} {timeOnly(decision.decision_at)}
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {approvalSummary.dueAtIso && (
                    <span
                      className={`ct-pill ${approvalSummary.done ? "ct-sla-done" : approvalSummary.overdue ? "ct-sla-over" : "ct-sla-ok"}`}
                      title={`SLA due: ${dayLabel(approvalSummary.dueAtIso)} ${timeOnly(
                        approvalSummary.dueAtIso
                      )} · Started: ${
                        approvalSummary.slaStartIso ? `${dayLabel(approvalSummary.slaStartIso)} ${timeOnly(approvalSummary.slaStartIso)}` : "—"
                      }`}
                    >
                      {approvalSummary.done ? "SLA closed" : fmtCountdown(approvalSummary.msLeft)}
                    </span>
                  )}
                  {approvalSummary.total > 0 && (
                    <span
                      className={`ct-pill ${
                        approvalSummary.unanimousBroken ? "ct-quorum-broke" : approvalSummary.quorumMet ? "ct-quorum-met" : "ct-quorum-pend"
                      }`}
                    >
                      {approvalSummary.rule === "unanimous" ? "Unanimous" : "Quorum"} {approvalSummary.approvedCount}/{approvalSummary.required}
                    </span>
                  )}
                </div>
              </div>

              {approvalSummary.total > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="ct-progress-track">
                    <div
                      className="ct-progress-fill"
                      style={{
                        width: `${Math.round(clamp(approvalSummary.quorumProgress, 0, 1) * 100)}%`,
                        background: approvalSummary.unanimousBroken
                          ? "linear-gradient(90deg, #ef4444, #f87171)"
                          : "linear-gradient(90deg, #10b981, #34d399)",
                        boxShadow: approvalSummary.unanimousBroken ? "0 0 8px rgba(239,68,68,0.4)" : "0 0 8px rgba(16,185,129,0.4)",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontSize: 11,
                      fontFamily: "'DM Mono', monospace",
                      color: "var(--text-dim)",
                    }}
                  >
                    <span>
                      ✓ {approvalSummary.approvedCount} approved
                      {approvalSummary.rejectedCount > 0 && <span style={{ marginLeft: 10, color: "#dc2626" }}>✕ {approvalSummary.rejectedCount} rejected</span>}
                      <span style={{ marginLeft: 10 }}>{approvalSummary.total} total</span>
                    </span>
                    <span>Rule: {approvalSummary.rule || "unanimous"}</span>
                  </div>
                </div>
              )}

              {[
                { list: approvalSummary.approved, label: "Approved by", bg: "linear-gradient(135deg,#dcfce7,#bbf7d0)", dot: "#10b981" },
                { list: approvalSummary.rejected, label: "Rejected by", bg: "linear-gradient(135deg,#fee2e2,#fecaca)", dot: "#ef4444" },
                { list: approvalSummary.rework, label: "Sent back for rework", bg: "linear-gradient(135deg,#e0e7ff,#c7d2fe)", dot: "#6366f1" },
                { list: approvalSummary.pending, label: "Pending approval", bg: "linear-gradient(135deg,#fef3c7,#fde68a)", dot: "#f59e0b" },
              ]
                .filter((g) => g.list.length > 0)
                .map((g) => (
                  <div key={g.label}>
                    <div className="ct-section-label" style={{ marginBottom: 8 }}>
                      {g.label}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {g.list.map((a) => (
                        <div key={a.user_id} className="ct-chip">
                          <div className="ct-avatar" style={{ background: g.bg }}>
                            <Avatar name={a.name} avatarUrl={a.avatar_url} />
                          </div>
                          <span style={{ fontWeight: 600, fontSize: 12.5 }}>{a.name}</span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{a.role}</span>
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: g.dot,
                              flexShrink: 0,
                              boxShadow: `0 0 4px ${g.dot}`,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

              {approvers.length === 0 && <div style={{ fontSize: 13, color: "var(--text-dim)" }}>No approver list found for this project.</div>}

              {decision?.decision_rationale && (
                <div
                  style={{
                    padding: "12px 14px",
                    background: "rgba(99,102,241,0.04)",
                    border: "1px solid rgba(99,102,241,0.12)",
                    borderRadius: 10,
                    fontSize: 13,
                    color: "var(--text-mid)",
                    lineHeight: 1.55,
                    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.8)",
                  }}
                >
                  <span style={{ fontWeight: 600, color: "var(--text)" }}>Decision note: </span>
                  {decision.decision_rationale}
                </div>
              )}
            </div>

            {/* ── TIMELINE EVENTS ── */}
            {!loading && !err && events.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--text-dim)", textAlign: "center", padding: "32px 0" }}>No events yet</div>
            )}

            {!loading &&
              !err &&
              grouped.map((g, gi) => (
                <div key={g.day} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="ct-day-sep" style={{ paddingTop: gi === 0 ? 0 : 4 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: ".06em",
                        color: "var(--text-dim)",
                        fontFamily: "'DM Mono', monospace",
                        whiteSpace: "nowrap",
                        padding: "2px 10px",
                        background: "rgba(255,255,255,0.85)",
                        border: "1px solid rgba(0,0,0,0.07)",
                        borderRadius: 999,
                        boxShadow: "var(--shadow-sm), inset 0 1px 0 white",
                      }}
                    >
                      {g.day}
                    </span>
                  </div>

                  <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
                    <div className="ct-timeline-line" />

                    {g.items.map((ev, ei) => {
                      const badge = approvalBadgeFromEvent(ev);
                      const isStatus = safeStr(ev.event_type).toLowerCase() === "status_changed";
                      const count = (ev as CompactEvent).__count ?? 1;
                      const compacted = Boolean((ev as CompactEvent).__is_compact);
                      const timeLabel = compacted
                        ? `${timeOnly((ev as CompactEvent).__first_at || ev.created_at)}–${timeOnly((ev as CompactEvent).__last_at || ev.created_at)}`
                        : timeOnly(ev.created_at);

                      return (
                        <div key={ev.id} className="ct-event-row" style={{ animationDelay: `${ei * 0.04}s`, paddingLeft: 40 }}>
                          <div className="ct-icon-bubble">{iconFor(ev)}</div>

                          <div className="ct-event">
                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: 8,
                                marginBottom: ev.comment || isStatus || badge ? 8 : 0,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{eventLabel(ev)}</span>
                                {badge && (
                                  <span className={`ct-pill ${RAG_PILL[badge.rag]}`}>
                                    {badge.label}
                                    {count > 1 ? ` ×${count}` : ""}
                                  </span>
                                )}
                              </div>
                              <span
                                style={{
                                  fontSize: 11,
                                  color: "var(--text-dim)",
                                  fontFamily: "'DM Mono', monospace",
                                  whiteSpace: "nowrap",
                                  flexShrink: 0,
                                }}
                              >
                                {timeLabel}
                              </span>
                            </div>

                            {isStatus && (ev.from_status || ev.to_status) && (
                              <div className="ct-status-arrow" style={{ marginBottom: ev.comment ? 8 : 0 }}>
                                {ev.from_status && <span className={`ct-pill ${RAG_PILL[statusRAG(ev.from_status)]}`}>{niceStatus(ev.from_status)}</span>}
                                {ev.from_status && ev.to_status && <span style={{ fontSize: 11, color: "var(--text-dim)" }}>→</span>}
                                {ev.to_status && <span className={`ct-pill ${RAG_PILL[statusRAG(ev.to_status)]}`}>{niceStatus(ev.to_status)}</span>}
                              </div>
                            )}

                            {ev.actor_role && (
                              <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: ev.comment ? 6 : 0, fontFamily: "'DM Mono', monospace" }}>
                                by {ev.actor_role}
                              </div>
                            )}

                            {ev.comment && (
                              <div
                                style={{
                                  padding: "10px 12px",
                                  background: "rgba(248,249,252,0.8)",
                                  border: "1px solid rgba(0,0,0,0.06)",
                                  borderRadius: 10,
                                  fontSize: 13,
                                  color: "var(--text-mid)",
                                  lineHeight: 1.55,
                                  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.03)",
                                }}
                              >
                                {ev.comment}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

            {/* ── COMMENT COMPOSER ── */}
            <div style={{ paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="ct-section-label" style={{ margin: 0 }}>
                  Add a comment
                </span>
                <button className="ct-btn ct-btn-primary" onClick={postComment} disabled={posting || !commentDraft.trim()} style={{ padding: "8px 18px" }}>
                  {posting ? "Posting…" : "Post comment"}
                </button>
              </div>
              <textarea
                className="ct-textarea"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Type a comment…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    postComment();
                  }
                }}
              />
              <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "'DM Mono', monospace" }}>⌘ + Enter to post</div>
            </div>

            <div ref={endRef} style={{ height: 4 }} />
          </div>

          {/* ── Footer ── */}
          <div
            style={{
              padding: "10px 24px",
              borderTop: "1px solid rgba(0,0,0,0.07)",
              background: "rgba(255,255,255,0.9)",
              backdropFilter: "blur(12px)",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              boxShadow: "0 -1px 0 rgba(255,255,255,0.8)",
              position: "relative",
              zIndex: 1,
            }}
          >
            <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: "var(--text-dim)", letterSpacing: ".04em" }}>
              {changeDisplay} · {events.length} event{events.length !== 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", color: "var(--text-dim)", letterSpacing: ".04em" }}>
              {metaCreatedAt ? `created ${dayLabel(metaCreatedAt)}` : ""}
            </span>
          </div>
        </aside>
      </div>
    </>
  );
}