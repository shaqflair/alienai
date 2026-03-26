"use client";
// src/components/home/PortfolioAskDrawer.tsx
// Upgraded Ask Aliena drawer — uses the agent endpoint with live tool-calling,
// conversation history, and draft action confirmation (create_raid, etc.)

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  X, Sparkles, Loader2, AlertCircle, ChevronRight,
  ExternalLink, RefreshCw, AlertTriangle, CheckCircle2,
  Flame, Send, Wrench, ShieldCheck, RotateCcw,
} from "lucide-react";

/* ── Types ────────────────────────────────────────────────────────────── */

type Role = "user" | "assistant";

type ChatMessage = {
  id:         string;
  role:       Role;
  content:    string;
  tool_calls?: string[];
  drafts?:    DraftAction[];
  loading?:   boolean;
  error?:     string;
};

type DraftAction = {
  type:    string;
  payload: Record<string, any>;
  preview: string;
};

type AgentResponse = {
  ok:         boolean;
  answer:     string;
  drafts:     DraftAction[];
  tool_calls: string[];
  iterations: number;
  error?:     string;
};

/* ── Utils ────────────────────────────────────────────────────────────── */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uid() {
  return Math.random().toString(36).slice(2);
}

const TOOL_LABELS: Record<string, string> = {
  get_portfolio_health: "Reading portfolio health",
  get_project_detail:   "Fetching project details",
  list_raid_items:      "Checking RAID register",
  list_milestones_due:  "Scanning milestones",
  get_budget_summary:   "Reviewing budget",
  get_governance_status:"Checking governance gates",
  create_raid_draft:    "Drafting RAID item",
  send_notification:    "Sending notification",
};

/* ── Suggested questions ─────────────────────────────────────────────── */

const SUGGESTIONS = [
  "Which projects need my attention today and why?",
  "What is the biggest delivery risk across the portfolio?",
  "Where are approvals stuck and for how long?",
  "Which projects are trending from Green to Amber or Red?",
  "What is our financial exposure this quarter?",
  "Give me a board-ready portfolio summary for today.",
  "Which high-priority RAID items are overdue?",
  "Are any projects approaching a gate review?",
];

/* ── Tool call badge ─────────────────────────────────────────────────── */

function ToolBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 border border-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-600">
      <Wrench className="h-2.5 w-2.5" />
      {TOOL_LABELS[name] ?? name}
    </span>
  );
}

/* ── Draft confirmation card ─────────────────────────────────────────── */

function DraftCard({
  draft,
  onConfirm,
  onDismiss,
}: {
  draft:      DraftAction;
  onConfirm:  (draft: DraftAction) => Promise<void>;
  onDismiss:  () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed]   = useState(false);

  async function handleConfirm() {
    setConfirming(true);
    try {
      await onConfirm(draft);
      setConfirmed(true);
    } finally {
      setConfirming(false);
    }
  }

  const label: Record<string, string> = { create_raid: "New RAID item" };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mt-3">
      <div className="flex items-center gap-2 mb-2">
        <ShieldCheck className="h-4 w-4 text-amber-600 shrink-0" />
        <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
          {label[draft.type] ?? draft.type} — confirm to save
        </span>
      </div>

      <p className="text-sm text-amber-900 font-medium mb-3">{draft.preview}</p>

      {confirmed ? (
        <div className="flex items-center gap-1.5 text-xs font-semibold text-green-700">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Saved successfully
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700 disabled:opacity-50 transition-colors"
          >
            {confirming ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
            Confirm & save
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={confirming}
            className="text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Chat bubble ─────────────────────────────────────────────────────── */

function ChatBubble({
  msg,
  onConfirmDraft,
  onDismissDraft,
}: {
  msg:            ChatMessage;
  onConfirmDraft: (draft: DraftAction) => Promise<void>;
  onDismissDraft: (msgId: string, draftIdx: number) => void;
}) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`}>
      {!isUser && (
        <div className="h-7 w-7 rounded-full bg-purple-100 flex items-center justify-center shrink-0 mr-2 mt-0.5">
          <Sparkles className="h-3.5 w-3.5 text-purple-600" />
        </div>
      )}

      <div className={`max-w-[88%] ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm bg-purple-600 px-4 py-2.5 text-sm text-white">
            {msg.content}
          </div>
        ) : (
          <div>
            {/* Tool call indicators */}
            {msg.tool_calls && msg.tool_calls.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {msg.tool_calls.map((t, i) => <ToolBadge key={i} name={t} />)}
              </div>
            )}

            {/* Loading */}
            {msg.loading && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-400" />
                Thinking...
              </div>
            )}

            {/* Error */}
            {msg.error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                <span className="text-sm text-red-700">{msg.error}</span>
              </div>
            )}

            {/* Answer */}
            {msg.content && !msg.loading && !msg.error && (
              <div className="rounded-2xl rounded-tl-sm bg-white border border-gray-200 px-4 py-3 text-sm text-gray-900 leading-relaxed whitespace-pre-wrap shadow-sm">
                {msg.content}
              </div>
            )}

            {/* Draft confirmations */}
            {msg.drafts && msg.drafts.map((draft, i) => (
              <DraftCard
                key={i}
                draft={draft}
                onConfirm={onConfirmDraft}
                onDismiss={() => onDismissDraft(msg.id, i)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────────────────── */

export default function PortfolioAskDrawer() {
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const bottomRef             = useRef<HTMLDivElement>(null);
  const textareaRef           = useRef<HTMLTextAreaElement>(null);
  const lastReq               = useRef<number>(0);

  const canSend = input.trim().length >= 2 && !loading;
  const hasMessages = messages.length > 0;

  // Escape to close
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Lock scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Focus on open
  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 150);
  }, [open]);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Build history for API (last 10 turns, user+assistant only)
  function buildHistory(): Array<{ role: "user" | "assistant"; content: string }> {
    return messages
      .filter((m) => !m.loading && !m.error && m.content)
      .slice(-10)
      .map((m) => ({ role: m.role, content: m.content }));
  }

  const send = useCallback(async (text?: string) => {
    const userText = (text ?? input).trim();
    if (!userText || loading) return;

    const reqId = Date.now();
    lastReq.current = reqId;

    const userMsg: ChatMessage = { id: uid(), role: "user", content: userText };
    const asstMsg: ChatMessage = { id: uid(), role: "assistant", content: "", loading: true };

    setMessages((prev) => [...prev, userMsg, asstMsg]);
    setInput("");
    setLoading(true);

    try {
      const history = buildHistory();

      const res = await fetch("/api/agent/ask", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        cache:   "no-store",
        body:    JSON.stringify({ message: userText, history }),
      });

      if (lastReq.current !== reqId) return;

      const json: AgentResponse = await res.json().catch(() => ({ ok: false, error: "Bad response" } as any));

      if (!res.ok || !json?.ok) {
        setMessages((prev) => prev.map((m) =>
          m.id === asstMsg.id
            ? { ...m, loading: false, error: safeStr(json?.error) || `Error ${res.status}` }
            : m
        ));
      } else {
        setMessages((prev) => prev.map((m) =>
          m.id === asstMsg.id
            ? { ...m, loading: false, content: json.answer, tool_calls: json.tool_calls, drafts: json.drafts }
            : m
        ));
      }
    } catch (err: any) {
      if (lastReq.current !== reqId) return;
      setMessages((prev) => prev.map((m) =>
        m.id === asstMsg.id
          ? { ...m, loading: false, error: safeStr(err?.message) || "Request failed" }
          : m
      ));
    } finally {
      if (lastReq.current === reqId) setLoading(false);
    }
  }, [input, loading, messages]);

  async function confirmDraft(draft: DraftAction) {
    await fetch("/api/agent/ask", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ draft_type: draft.type, payload: draft.payload }),
    });
  }

  function dismissDraft(msgId: string, draftIdx: number) {
    setMessages((prev) => prev.map((m) =>
      m.id === msgId
        ? { ...m, drafts: (m.drafts ?? []).filter((_, i) => i !== draftIdx) }
        : m
    ));
  }

  function clearChat() {
    setMessages([]);
    setInput("");
    textareaRef.current?.focus();
  }

  return (
    <>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative flex items-center gap-2 h-9 rounded-xl border border-purple-200 bg-purple-50 px-4 text-sm font-semibold text-purple-700 hover:bg-purple-100 hover:border-purple-300 transition-all"
        title="Ask Aliena — AI portfolio analysis"
      >
        <Sparkles className="h-4 w-4 text-purple-500" />
        Ask Aliena
        <span className="hidden sm:inline text-purple-400 font-normal text-xs">— AI analysis</span>
      </button>

      {/* Overlay */}
      <div
        className={[
          "fixed inset-0 z-[80] transition-opacity duration-200",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
        aria-hidden={!open}
      >
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setOpen(false)} />

        {/* Drawer */}
        <div className="absolute right-0 top-0 h-full w-full max-w-[580px] flex flex-col border-l border-gray-200 bg-white shadow-2xl">

          {/* Header */}
          <div className="shrink-0 border-b border-gray-100 bg-white px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
                  <Sparkles className="h-4 w-4 text-purple-600" />
                </div>
                <div>
                  <div className="text-base font-bold text-gray-900">Ask Aliena</div>
                  <div className="text-xs text-gray-400">Live portfolio analysis · AI agent</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {hasMessages && (
                  <button
                    type="button"
                    onClick={clearChat}
                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    title="New conversation"
                  >
                    <RotateCcw className="h-3 w-3" /> New chat
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="h-8 w-8 rounded-lg border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Chat body */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {!hasMessages ? (
              /* Suggested questions */
              <div>
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Suggested questions
                </div>
                <div className="space-y-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="w-full text-left rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 hover:border-gray-200 transition-all flex items-center justify-between gap-3 group"
                    >
                      <span>{s}</span>
                      <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-gray-500 shrink-0 transition-colors" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              /* Conversation */
              <div>
                {messages.map((msg) => (
                  <ChatBubble
                    key={msg.id}
                    msg={msg}
                    onConfirmDraft={confirmDraft}
                    onDismissDraft={dismissDraft}
                  />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="shrink-0 border-t border-gray-100 bg-white px-4 py-3">
            <div className="flex items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 focus-within:border-purple-300 focus-within:bg-white transition-colors">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && canSend) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                className="flex-1 resize-none bg-transparent text-sm text-gray-900 placeholder:text-gray-400 outline-none py-1"
                placeholder="Ask anything about your portfolio..."
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={!canSend}
                className="shrink-0 h-8 w-8 rounded-lg bg-purple-600 flex items-center justify-center text-white hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors mb-0.5"
                aria-label="Send"
              >
                {loading
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Send className="h-3.5 w-3.5" />
                }
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1.5 px-1">
              Enter to send · Shift+Enter for new line · Answers grounded in live portfolio data
            </p>
          </div>
        </div>
      </div>
    </>
  );
}