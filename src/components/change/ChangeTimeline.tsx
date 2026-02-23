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
  } catch { return iso; }
}
function dayLabel(iso: string) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
    return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
  } catch { return iso.slice(0, 10); }
}
function niceStatus(x: string | null) {
  const v = safeStr(x).trim();
  if (!v) return "—";
  return v.replaceAll("_", " ");
}
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }
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
  green:   "bg-emerald-500/10 text-emerald-300 border-emerald-500/25",
  amber:   "bg-amber-500/10  text-amber-300  border-amber-500/25",
  red:     "bg-rose-500/10   text-rose-300   border-rose-500/25",
  blue:    "bg-sky-500/10    text-sky-300    border-sky-500/25",
  indigo:  "bg-indigo-500/10 text-indigo-300 border-indigo-500/25",
  violet:  "bg-violet-500/10 text-violet-300 border-violet-500/25",
  neutral: "bg-white/5       text-white/50   border-white/10",
};

function approvalBadgeFromDecision(decision: string) {
  const d = decision.trim().toLowerCase();
  if (d === "approved")  return { label: "Approved",  rag: "green"  as RAGTone };
  if (d === "rejected")  return { label: "Rejected",  rag: "red"    as RAGTone };
  if (d === "rework")    return { label: "Rework",    rag: "indigo" as RAGTone };
  if (d === "submitted" || d === "proposed") return { label: "Submitted", rag: "amber" as RAGTone };
  return null;
}

function approvalBadgeFromEvent(ev: UiEvent) {
  const to = safeStr(ev.to_status).toLowerCase();
  const pd = safeStr(ev.payload?.decision_status).toLowerCase();
  const d  = to || pd;
  if (d === "approved")  return { label: "Approved",  rag: "green"  as RAGTone };
  if (d === "rejected")  return { label: "Rejected",  rag: "red"    as RAGTone };
  if (d === "rework")    return { label: "Rework",    rag: "indigo" as RAGTone };
  if (d === "submitted" || ev.payload?.sla_start) return { label: "Submitted", rag: "amber" as RAGTone };
  return null;
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
    const evB  = approvalBadgeFromEvent(ev);
    const prevB = prev ? approvalBadgeFromEvent(prev) : null;
    const canCompact =
      prev &&
      safeStr(ev.event_type).toLowerCase() === "status_changed" &&
      safeStr(prev.event_type).toLowerCase() === "status_changed" &&
      evB && prevB && evB.label === prevB.label &&
      safeStr(ev.actor_role) === safeStr(prev.actor_role);
    if (canCompact) {
      prev.__count = (prev.__count ?? 1) + 1;
      prev.__is_compact = true;
      prev.__first_at = prev.__first_at ?? prev.created_at;
      prev.__last_at  = ev.created_at;
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
  if (t === "edited")  return "✏️";
  if (t === "comment") return "💬";
  if (t === "status_changed") {
    const to = safeStr(ev.to_status).toLowerCase();
    const pd = safeStr(ev.payload?.decision_status).toLowerCase();
    const d  = to || pd;
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
  if (t === "edited")  return "Edited";
  return t ? t.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase()) : "Event";
}

/* ── Avatar ── */

function Avatar({ name, avatarUrl }: { name: string; avatarUrl?: string | null }) {
  const url = safeStr(avatarUrl).trim();
  if (url) return <img src={url} alt={name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />;
  return (
    <div className="w-full h-full flex items-center justify-center text-[10px] font-bold text-white/70">
      {initials(name)}
    </div>
  );
}

/* ════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════ */

export default function ChangeTimeline({ open, onClose, projectId, projectCode, changeId, changeCode }: Props) {
  const [loading,        setLoading]        = useState(false);
  const [err,            setErr]            = useState("");
  const [events,         setEvents]         = useState<UiEvent[]>([]);
  const [metaTitle,      setMetaTitle]      = useState("");
  const [metaSeq,        setMetaSeq]        = useState<number | null>(null);
  const [metaPublicId,   setMetaPublicId]   = useState("");
  const [metaCreatedAt,  setMetaCreatedAt]  = useState("");
  const [projectDisplayId, setProjectDisplayId] = useState("");
  const [approvers,      setApprovers]      = useState<Approver[]>([]);
  const [decision,       setDecision]       = useState<DecisionInfo | null>(null);
  const [commentDraft,   setCommentDraft]   = useState("");
  const [posting,        setPosting]        = useState(false);
  const [nowTick,        setNowTick]        = useState(() => Date.now());
  const [mounted,        setMounted]        = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  const canLoad = Boolean(projectId && changeId);

  /* ── display ids (original logic) ── */
  const changeDisplay = useMemo(() => {
    if (changeCode) return changeCode;
    if (typeof metaSeq === "number") return `CR-${metaSeq}`;
    if (metaPublicId) return metaPublicId;
    return changeId ? `CR-${shortId(changeId)}` : "—";
  }, [changeCode, metaSeq, metaPublicId, changeId]);

  const headerProject = useMemo(() => {
    const apiId = safeStr(projectDisplayId).trim();
    const pc    = safeStr(projectCode).trim();
    const apiIsFallback = apiId ? isUuidFallbackProjectDisplay(apiId, projectId) : true;
    const raw = (!apiIsFallback && apiId) ? apiId : pc;
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

  /* ── data loading (original logic) ── */
  const load = useCallback(async () => {
    if (!canLoad) return;
    setLoading(true);
    setErr("");
    try {
      const evRes  = await fetch(`/api/change-events?projectId=${encodeURIComponent(projectId)}&changeId=${encodeURIComponent(changeId)}`, { cache: "no-store" });
      const evJson = await evRes.json().catch(() => ({}));
      if (!evRes.ok || evJson.ok === false) throw new Error(evJson.error || "Failed to load timeline");
      setEvents(Array.isArray(evJson.items) ? evJson.items : []);

      const crRes  = await fetch(`/api/change/${encodeURIComponent(changeId)}`, { cache: "no-store" });
      const crJson = await crRes.json().catch(() => ({}));
      if (crRes.ok && crJson.ok !== false) {
        const row = crJson.item ?? crJson.data ?? crJson;
        const seqNum = Number(row?.seq);
        setMetaSeq(Number.isFinite(seqNum) ? seqNum : null);
        setMetaPublicId(safeStr(row?.public_id) || "");
        setMetaTitle(safeStr(row?.title) || "");
        setMetaCreatedAt(safeStr(row?.created_at) || "");
      }

      const apRes  = await fetch(`/api/change-approvers?projectId=${encodeURIComponent(projectId)}&changeId=${encodeURIComponent(changeId)}`, { cache: "no-store" });
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

  /* ── grouped timeline (original logic) ── */
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

  /* ── approval summary (original logic) ── */
  const approvalSummary = useMemo(() => {
    const dRaw      = decision?.decision_status?.toLowerCase() ?? "proposed";
    const badge     = approvalBadgeFromDecision(dRaw);
    const approved  = approvers.filter((a) => a.state === "approved");
    const rejected  = approvers.filter((a) => a.state === "rejected");
    const rework    = approvers.filter((a) => a.state === "rework");
    const pending   = approvers.filter((a) => a.state === "pending");
    const total     = approvers.length;
    const rule      = decision?.quorum_rule ?? "unanimous";
    const required  = computeQuorumRequired(total, rule, decision?.quorum_required ?? null);
    const approvedCount  = approved.length;
    const rejectedCount  = rejected.length;
    const quorumProgress = total > 0 ? clamp(approvedCount / Math.max(1, required), 0, 1) : 0;

    let dueAtIso = safeStr(decision?.sla_due_at).trim();
    const slaStartIso = findSlaStartIso(events, metaCreatedAt);
    if (!dueAtIso) {
      const baseMs = new Date(slaStartIso).getTime();
      if (!Number.isNaN(baseMs)) dueAtIso = new Date(baseMs + 48 * 3600 * 1000).toISOString();
    }
    const dueMs  = dueAtIso ? new Date(dueAtIso).getTime() : NaN;
    const hasDue = Number.isFinite(dueMs);
    const msLeft = hasDue ? dueMs - nowTick : NaN;
    const overdue = hasDue ? msLeft < 0 : false;
    const done = dRaw === "approved" || dRaw === "rejected" || dRaw === "rework";
    const unanimousBroken = rule === "unanimous" && rejectedCount > 0;
    const quorumMet = total > 0 && approvedCount >= required && !unanimousBroken;

    return { badge, approved, rejected, rework, pending, total, required, approvedCount, rejectedCount,
      quorumProgress, dueAtIso: hasDue ? dueAtIso : "", msLeft: hasDue ? msLeft : NaN,
      overdue, done, slaStartIso, quorumMet, unanimousBroken, decisionStatusRaw: dRaw, rule };
  }, [approvers, decision, metaCreatedAt, nowTick, events]);

  /* ── comment posting (original logic) ── */
  const postComment = useCallback(async () => {
    const text = commentDraft.trim();
    if (!text) return;
    setPosting(true);
    setErr("");
    try {
      const res  = await fetch(`/api/change-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, changeId, comment: text, payload: { source: "timeline_inline", at: new Date().toISOString() } }),
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

  /* ════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════ */
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        .ct-root * { box-sizing: border-box; }

        .ct-root {
          --bg:        #080c14;
          --surface:   #0f1420;
          --panel:     #141926;
          --border:    rgba(255,255,255,0.07);
          --border-hi: rgba(255,255,255,0.12);
          --text:      #e2e8f0;
          --text-dim:  #64748b;
          --text-muted:#374151;
          --accent:    #6366f1;
          --accent-alt:#8b5cf6;
          --green:     #10b981;
          --amber:     #f59e0b;
          --red:       #ef4444;
          --sky:       #38bdf8;
          font-family: 'Sora', system-ui, sans-serif;
        }

        /* Slide-in animation */
        @keyframes ct-slide-in {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes ct-fade-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ct-pulse-dot {
          0%,100% { opacity: 1; transform: scale(1); }
          50%      { opacity: .5; transform: scale(.75); }
        }

        .ct-panel {
          animation: ct-slide-in .28s cubic-bezier(.22,.68,0,1.2);
        }

        .ct-event-row {
          animation: ct-fade-in .22s ease both;
        }

        .ct-live-dot {
          width: 7px; height: 7px;
          border-radius: 50%;
          background: var(--green);
          animation: ct-pulse-dot 2s ease infinite;
        }

        /* Scrollbar */
        .ct-scroll::-webkit-scrollbar { width: 4px; }
        .ct-scroll::-webkit-scrollbar-track { background: transparent; }
        .ct-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.08); border-radius: 2px; }

        /* Pill */
        .ct-pill {
          display: inline-flex; align-items: center;
          padding: 2px 10px; border-radius: 999px;
          font-size: 11px; font-weight: 600; letter-spacing: .03em;
          border: 1px solid transparent;
          font-family: 'Sora', sans-serif;
        }

        /* Tag mono */
        .ct-tag {
          display: inline-flex; align-items: center;
          padding: 2px 8px; border-radius: 4px;
          font-size: 10.5px; font-weight: 500;
          font-family: 'JetBrains Mono', monospace;
          background: rgba(255,255,255,.04);
          border: 1px solid rgba(255,255,255,.08);
          color: rgba(255,255,255,.5);
          letter-spacing: .04em;
        }

        /* Comment textarea */
        .ct-textarea {
          width: 100%;
          background: rgba(255,255,255,.03);
          border: 1px solid rgba(255,255,255,.08);
          border-radius: 10px;
          color: var(--text);
          font-family: 'Sora', sans-serif;
          font-size: 13px;
          padding: 12px 14px;
          resize: vertical;
          min-height: 88px;
          outline: none;
          transition: border-color .15s;
        }
        .ct-textarea::placeholder { color: rgba(255,255,255,.2); }
        .ct-textarea:focus { border-color: rgba(99,102,241,.5); }

        /* Approver chip */
        .ct-chip {
          display: inline-flex; align-items: center; gap: 8px;
          padding: 5px 12px 5px 6px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.08);
          background: rgba(255,255,255,.03);
          font-size: 12.5px; font-weight: 500; color: var(--text);
          transition: border-color .15s, background .15s;
        }
        .ct-chip:hover { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.14); }

        .ct-avatar {
          width: 26px; height: 26px;
          border-radius: 50%; overflow: hidden;
          background: rgba(99,102,241,.2);
          flex-shrink: 0;
        }

        /* Timeline line */
        .ct-timeline-line {
          position: absolute; left: 19px; top: 32px; bottom: 0;
          width: 1px;
          background: linear-gradient(to bottom, rgba(255,255,255,.08), transparent);
        }

        /* Event card */
        .ct-event {
          background: var(--panel);
          border: 1px solid var(--border);
          border-radius: 12px;
          padding: 14px 16px;
          transition: border-color .15s, background .15s;
          position: relative;
        }
        .ct-event:hover {
          border-color: var(--border-hi);
          background: rgba(255,255,255,.025);
        }

        /* Progress bar */
        .ct-progress-track {
          height: 3px;
          border-radius: 999px;
          background: rgba(255,255,255,.06);
          overflow: hidden;
        }
        .ct-progress-fill {
          height: 100%;
          border-radius: 999px;
          transition: width .6s cubic-bezier(.22,.68,0,1);
        }

        /* Buttons */
        .ct-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          padding: 8px 16px;
          border-radius: 8px;
          font-size: 12.5px; font-weight: 600;
          font-family: 'Sora', sans-serif;
          border: none; cursor: pointer;
          transition: background .15s, opacity .15s, transform .1s;
        }
        .ct-btn:active { transform: scale(.97); }
        .ct-btn:disabled { opacity: .4; cursor: not-allowed; }

        .ct-btn-ghost {
          background: rgba(255,255,255,.05);
          color: rgba(255,255,255,.6);
          border: 1px solid rgba(255,255,255,.08);
        }
        .ct-btn-ghost:hover:not(:disabled) { background: rgba(255,255,255,.08); color: rgba(255,255,255,.85); }

        .ct-btn-primary {
          background: linear-gradient(135deg, #6366f1, #8b5cf6);
          color: #fff;
        }
        .ct-btn-primary:hover:not(:disabled) { opacity: .88; }

        /* Day separator */
        .ct-day-sep {
          display: flex; align-items: center; gap: 10px;
          position: sticky; top: 0; z-index: 10;
        }
        .ct-day-sep::before, .ct-day-sep::after {
          content: ''; flex: 1; height: 1px;
          background: rgba(255,255,255,.06);
        }

        /* Status arrow */
        .ct-status-arrow {
          display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
        }

        /* SLA badge variants */
        .ct-sla-ok    { background: rgba(245,158,11,.08); color: #fbbf24; border-color: rgba(245,158,11,.2); }
        .ct-sla-over  { background: rgba(239,68,68,.08);  color: #fca5a5; border-color: rgba(239,68,68,.2);  }
        .ct-sla-done  { background: rgba(255,255,255,.04); color: rgba(255,255,255,.35); border-color: rgba(255,255,255,.08); }

        /* Section heading */
        .ct-section-label {
          font-size: 10px; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase;
          color: rgba(255,255,255,.25);
          font-family: 'JetBrains Mono', monospace;
          margin-bottom: 10px;
        }

        /* Quorum badge */
        .ct-quorum-met   { background: rgba(16,185,129,.08); color: #6ee7b7; border-color: rgba(16,185,129,.2); }
        .ct-quorum-pend  { background: rgba(255,255,255,.04); color: rgba(255,255,255,.35); border-color: rgba(255,255,255,.1); }
        .ct-quorum-broke { background: rgba(239,68,68,.08); color: #fca5a5; border-color: rgba(239,68,68,.2); }
      `}</style>

      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 ct-root"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)" }}
      >
        {/* Panel */}
        <aside
          className="ct-panel ct-scroll absolute right-0 top-0 h-full flex flex-col overflow-hidden"
          style={{
            width: "100%", maxWidth: 520,
            background: "var(--bg)",
            borderLeft: "1px solid var(--border)",
            boxShadow: "-40px 0 120px rgba(0,0,0,.6)",
          }}
        >

          {/* ── Header ── */}
          <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                {/* Top line */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <div className="ct-live-dot" />
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".12em", textTransform: "uppercase", color: "rgba(255,255,255,.25)", fontFamily: "'JetBrains Mono', monospace" }}>
                    TIMELINE · CHANGE REVIEW
                  </span>
                </div>

                <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0, lineHeight: 1.2, marginBottom: 8 }}>
                  {metaTitle || "Change Request"}
                </h2>

                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span className="ct-tag">{headerProject}</span>
                  <span className="ct-tag">{changeDisplay}</span>
                  {events.length > 0 && (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,.25)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {events.length} event{events.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                <button className="ct-btn ct-btn-ghost" onClick={jumpToLatest} style={{ padding: "6px 12px" }}>
                  Latest ↓
                </button>
                <button className="ct-btn ct-btn-ghost" onClick={load} disabled={loading} style={{ padding: "6px 12px" }}>
                  {loading ? "…" : "↻"}
                </button>
                <button
                  onClick={onClose}
                  style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid rgba(255,255,255,.1)", background: "rgba(255,255,255,.04)", cursor: "pointer", color: "rgba(255,255,255,.5)", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .15s" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#fff"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,.08)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(255,255,255,.5)"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,.04)"; }}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
          </div>

          {/* ── Scrollable body ── */}
          <div className="ct-scroll" style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Error */}
            {err && (
              <div style={{ padding: "12px 14px", background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10, fontSize: 13, color: "#fca5a5" }}>
                {err}
              </div>
            )}

            {/* Loading */}
            {loading && !events.length && (
              <div style={{ color: "rgba(255,255,255,.3)", fontSize: 13, textAlign: "center", padding: "40px 0" }}>
                Loading timeline…
              </div>
            )}

            {/* ── APPROVALS PANEL ── */}
            <div style={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: "18px 18px 16px", display: "flex", flexDirection: "column", gap: 16 }}>

              {/* Panel header */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>Approvals</span>

                  {approvalSummary.badge ? (
                    <span className={`ct-pill ${RAG_PILL[approvalSummary.badge.rag]}`}>
                      {approvalSummary.badge.label}
                    </span>
                  ) : (
                    <span className="ct-pill" style={{ background: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.35)", borderColor: "rgba(255,255,255,.08)" }}>
                      Pending
                    </span>
                  )}

                  {decision?.decision_at && (
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,.25)", fontFamily: "'JetBrains Mono', monospace" }}>
                      {dayLabel(decision.decision_at)} {timeOnly(decision.decision_at)}
                    </span>
                  )}
                </div>

                {/* SLA + Quorum badges */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {approvalSummary.dueAtIso && (
                    <span
                      className={`ct-pill ${approvalSummary.done ? "ct-sla-done" : approvalSummary.overdue ? "ct-sla-over" : "ct-sla-ok"}`}
                      title={`SLA due: ${dayLabel(approvalSummary.dueAtIso)} ${timeOnly(approvalSummary.dueAtIso)} · Started: ${approvalSummary.slaStartIso ? `${dayLabel(approvalSummary.slaStartIso)} ${timeOnly(approvalSummary.slaStartIso)}` : "—"}`}
                    >
                      {approvalSummary.done ? "SLA closed" : fmtCountdown(approvalSummary.msLeft)}
                    </span>
                  )}

                  {approvalSummary.total > 0 && (
                    <span className={`ct-pill ${approvalSummary.unanimousBroken ? "ct-quorum-broke" : approvalSummary.quorumMet ? "ct-quorum-met" : "ct-quorum-pend"}`}>
                      {approvalSummary.rule === "unanimous" ? "Unanimous" : "Quorum"} {approvalSummary.approvedCount}/{approvalSummary.required}
                    </span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
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
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: "rgba(255,255,255,.25)" }}>
                    <span>
                      ✓ {approvalSummary.approvedCount} approved
                      {approvalSummary.rejectedCount > 0 && <span style={{ marginLeft: 10, color: "#fca5a5" }}>✕ {approvalSummary.rejectedCount} rejected</span>}
                      <span style={{ marginLeft: 10 }}>{approvalSummary.total} total</span>
                    </span>
                    <span>Rule: {approvalSummary.rule || "unanimous"}</span>
                  </div>
                </div>
              )}

              {/* Approver groups */}
              {[
                { list: approvalSummary.approved, label: "Approved by",             color: "rgba(16,185,129,.15)",  dot: "#10b981" },
                { list: approvalSummary.rejected, label: "Rejected by",             color: "rgba(239,68,68,.15)",   dot: "#ef4444" },
                { list: approvalSummary.rework,   label: "Sent back for rework",    color: "rgba(99,102,241,.15)",  dot: "#818cf8" },
                { list: approvalSummary.pending,  label: "Pending approval",        color: "rgba(245,158,11,.1)",   dot: "#f59e0b" },
              ].filter((g) => g.list.length > 0).map((g) => (
                <div key={g.label}>
                  <div className="ct-section-label" style={{ marginBottom: 8 }}>{g.label}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {g.list.map((a) => (
                      <div key={a.user_id} className="ct-chip">
                        <div className="ct-avatar" style={{ background: g.color }}>
                          <Avatar name={a.name} avatarUrl={a.avatar_url} />
                        </div>
                        <span style={{ fontWeight: 600, fontSize: 12.5 }}>{a.name}</span>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,.3)" }}>{a.role}</span>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: g.dot, flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {approvers.length === 0 && (
                <div style={{ fontSize: 13, color: "rgba(255,255,255,.25)" }}>No approver list found for this project.</div>
              )}

              {/* Decision rationale */}
              {decision?.decision_rationale && (
                <div style={{ padding: "12px 14px", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 10, fontSize: 13, color: "rgba(255,255,255,.6)", lineHeight: 1.55 }}>
                  <span style={{ fontWeight: 600, color: "rgba(255,255,255,.75)" }}>Decision note: </span>
                  {decision.decision_rationale}
                </div>
              )}
            </div>

            {/* ── TIMELINE EVENTS ── */}
            {!loading && !err && events.length === 0 && (
              <div style={{ fontSize: 13, color: "rgba(255,255,255,.25)", textAlign: "center", padding: "32px 0" }}>
                No events yet
              </div>
            )}

            {!loading && !err && grouped.map((g, gi) => (
              <div key={g.day} style={{ display: "flex", flexDirection: "column", gap: 8 }}>

                {/* Day separator */}
                <div className="ct-day-sep" style={{ paddingTop: gi === 0 ? 0 : 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", color: "rgba(255,255,255,.3)", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", padding: "0 2px" }}>
                    {g.day}
                  </span>
                </div>

                {/* Events */}
                <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div className="ct-timeline-line" />

                  {g.items.map((ev, ei) => {
                    const badge   = approvalBadgeFromEvent(ev);
                    const isStatus = safeStr(ev.event_type).toLowerCase() === "status_changed";
                    const count   = (ev as CompactEvent).__count ?? 1;
                    const compacted = Boolean((ev as CompactEvent).__is_compact);
                    const timeLabel = compacted
                      ? `${timeOnly((ev as CompactEvent).__first_at || ev.created_at)}–${timeOnly((ev as CompactEvent).__last_at || ev.created_at)}`
                      : timeOnly(ev.created_at);

                    return (
                      <div
                        key={ev.id}
                        className="ct-event-row"
                        style={{ animationDelay: `${ei * 0.04}s`, paddingLeft: 40 }}
                      >
                        {/* Icon bubble */}
                        <div style={{
                          position: "absolute", left: 8, top: 14,
                          width: 24, height: 24, borderRadius: 8,
                          background: "var(--surface)", border: "1px solid var(--border)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 13, lineHeight: 1,
                        }}>
                          {iconFor(ev)}
                        </div>

                        <div className="ct-event">
                          {/* Row header */}
                          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: (ev.comment || isStatus || badge) ? 8 : 0 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{eventLabel(ev)}</span>

                              {badge && (
                                <span className={`ct-pill ${RAG_PILL[badge.rag]}`}>
                                  {badge.label}{count > 1 ? ` ×${count}` : ""}
                                </span>
                              )}
                            </div>

                            <span style={{ fontSize: 11, color: "rgba(255,255,255,.25)", fontFamily: "'JetBrains Mono', monospace", whiteSpace: "nowrap", flexShrink: 0 }}>
                              {timeLabel}
                            </span>
                          </div>

                          {/* Status arrow */}
                          {isStatus && (ev.from_status || ev.to_status) && (
                            <div className="ct-status-arrow" style={{ marginBottom: ev.comment ? 8 : 0 }}>
                              {ev.from_status && (
                                <span className={`ct-pill ${RAG_PILL[statusRAG(ev.from_status)]}`}>
                                  {niceStatus(ev.from_status)}
                                </span>
                              )}
                              {ev.from_status && ev.to_status && (
                                <span style={{ fontSize: 11, color: "rgba(255,255,255,.2)" }}>→</span>
                              )}
                              {ev.to_status && (
                                <span className={`ct-pill ${RAG_PILL[statusRAG(ev.to_status)]}`}>
                                  {niceStatus(ev.to_status)}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Actor */}
                          {ev.actor_role && (
                            <div style={{ fontSize: 11, color: "rgba(255,255,255,.28)", marginBottom: ev.comment ? 6 : 0, fontFamily: "'JetBrains Mono', monospace" }}>
                              by {ev.actor_role}
                            </div>
                          )}

                          {/* Comment */}
                          {ev.comment && (
                            <div style={{ padding: "10px 12px", background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 8, fontSize: 13, color: "rgba(255,255,255,.7)", lineHeight: 1.55 }}>
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
            <div style={{ paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span className="ct-section-label" style={{ margin: 0 }}>Add a comment</span>
                <button
                  className="ct-btn ct-btn-primary"
                  onClick={postComment}
                  disabled={posting || !commentDraft.trim()}
                  style={{ padding: "8px 18px" }}
                >
                  {posting ? "Posting…" : "Post comment"}
                </button>
              </div>
              <textarea
                className="ct-textarea"
                value={commentDraft}
                onChange={(e) => setCommentDraft(e.target.value)}
                placeholder="Type a comment…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); postComment(); }
                }}
              />
              <div style={{ fontSize: 11, color: "rgba(255,255,255,.2)", fontFamily: "'JetBrains Mono', monospace" }}>
                ⌘ + Enter to post
              </div>
            </div>

            <div ref={endRef} style={{ height: 4 }} />
          </div>

          {/* ── Footer ── */}
          <div style={{ padding: "10px 24px", borderTop: "1px solid var(--border)", background: "var(--surface)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "rgba(255,255,255,.2)", letterSpacing: ".04em" }}>
              {changeDisplay} · {events.length} event{events.length !== 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono', monospace", color: "rgba(255,255,255,.2)", letterSpacing: ".04em" }}>
              {metaCreatedAt ? `created ${dayLabel(metaCreatedAt)}` : ""}
            </span>
          </div>

        </aside>
      </div>
    </>
  );
}