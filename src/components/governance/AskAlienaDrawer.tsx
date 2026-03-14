"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  X,
  Sparkles,
  Loader2,
  AlertCircle,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

type AdvisorResult = {
  answer: string;
  confidence: number;
  key_drivers: string[];
  blockers: Array<{
    kind: string;
    title: string;
    entity_id: string;
    age_days?: number;
    severity?: number;
    next_action: string;
  }>;
  today_actions: Array<{
    priority: 1 | 2 | 3 | 4 | 5;
    action: string;
    owner_suggestion?: string;
    why: string;
  }>;
  recommended_routes: Array<{ label: string; href: string }>;
  data_requests: string[];
};

type Scope = "global" | "kb";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function clamp(s: string, n: number) {
  const t = safeStr(s);
  return t.length > n ? t.slice(0, n) : t;
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-lg border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-medium text-neutral-700">
      {children}
    </span>
  );
}

export default function AskAlienaDrawer(props: {
  scope?: Scope;
  articleSlug?: string;
  articleTitle?: string;
  defaultQuestion?: string;
  triggerClassName?: string;
  triggerLabel?: string;
  urlKey?: string;
}) {
  const {
    scope = "kb",
    articleSlug = "",
    articleTitle = "",
    defaultQuestion,
    triggerClassName,
    triggerLabel = "Ask Aliena →",
    urlKey = "ask",
  } = props;

  const searchParams = useSearchParams();
  const urlAsk = safeLower(searchParams?.get(urlKey));
  const urlArticle = safeLower(searchParams?.get("article") || "");

  const resolvedArticleSlug = useMemo(
    () => urlArticle || safeLower(articleSlug),
    [urlArticle, articleSlug]
  );

  const effectiveScope: Scope = useMemo(
    () => (resolvedArticleSlug ? "kb" : scope),
    [scope, resolvedArticleSlug]
  );

  const resolvedTitle = useMemo(
    () => safeStr(articleTitle).trim() || (resolvedArticleSlug ? resolvedArticleSlug : "Governance"),
    [articleTitle, resolvedArticleSlug]
  );

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(
    defaultQuestion ||
      (effectiveScope === "kb" && resolvedArticleSlug
        ? `What governance controls and evidence apply to "${resolvedTitle}"?`
        : "What are the biggest governance risks right now, and what should I do today?")
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AdvisorResult | null>(null);

  const canAsk = useMemo(() => q.trim().length >= 4, [q]);
  const lastReq = useRef<number>(0);

  useEffect(() => {
    const wants = urlAsk === "help" || urlAsk === "1" || urlAsk === "true";
    if (wants) setOpen(true);
  }, [urlAsk]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") setOpen(false); }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function ask() {
    if (!canAsk || busy) return;
    const reqId = Date.now();
    lastReq.current = reqId;
    setBusy(true);
    setErr(null);
    try {
      const payload: any =
        effectiveScope === "kb" && resolvedArticleSlug
          ? { scope: "kb", articleSlug: resolvedArticleSlug, question: clamp(q.trim(), 1200), mode: "kb" }
          : { scope: "global", question: clamp(q.trim(), 1200), mode: "advisor" };

      const res = await fetch("/api/ai/governance-advisor", {
        method: "POST", headers: { "Content-Type": "application/json" },
        cache: "no-store", body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => null);
      if (lastReq.current !== reqId) return;
      if (!res.ok || !json?.ok) { setErr(safeStr(json?.error) || `Request failed (${res.status})`); setResult(null); }
      else setResult(json?.result ?? null);
    } catch (e: any) {
      if (lastReq.current !== reqId) return;
      setErr(safeStr(e?.message) || "Request failed"); setResult(null);
    } finally {
      if (lastReq.current === reqId) setBusy(false);
    }
  }

  const confidencePct = useMemo(() => {
    const c = Number(result?.confidence);
    if (!Number.isFinite(c)) return null;
    return Math.round(Math.max(0, Math.min(1, c)) * 100);
  }, [result?.confidence]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          triggerClassName ||
          "inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
        }
        title="Ask Aliena"
        type="button"
      >
        <Sparkles className="h-4 w-4 text-neutral-600" />
        {triggerLabel}
      </button>

      <div
        className={[
          "fixed inset-0 z-[80] transition-opacity duration-150",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" onClick={() => setOpen(false)} />

        {/* Drawer */}
        <div className="absolute right-0 top-0 h-full w-full max-w-[560px] overflow-auto border-l border-neutral-200 bg-white shadow-2xl">

          {/* Sticky header */}
          <div className="sticky top-0 z-10 border-b border-neutral-200 bg-white px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="h-4 w-4 text-neutral-600 shrink-0" />
                  <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide">Ask Aliena</div>
                </div>
                <div className="truncate text-base font-semibold text-neutral-900">
                  {effectiveScope === "kb" && resolvedArticleSlug ? resolvedTitle : "Governance"}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge>{effectiveScope === "kb" && resolvedArticleSlug ? "KB mode" : "Global mode"}</Badge>
                  {effectiveScope === "kb" && resolvedArticleSlug && <Badge>Slug: {resolvedArticleSlug}</Badge>}
                  {confidencePct != null && <Badge>Confidence: {confidencePct}%</Badge>}
                </div>
                <div className="mt-3">
                  <Link
                    href="/governance/delivery-governance-framework"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                  >
                    Delivery Governance <ChevronRight className="h-3 w-3 text-neutral-400" />
                  </Link>
                </div>
              </div>

              <button onClick={() => setOpen(false)}
                className="shrink-0 inline-flex items-center justify-center h-8 w-8 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                type="button" aria-label="Close">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Question input */}
            <div className="mt-4 rounded-xl border border-neutral-200 bg-white overflow-hidden">
              <textarea
                value={q}
                onChange={(e) => setQ(e.target.value)}
                rows={3}
                className="w-full resize-none px-4 py-3 text-sm text-neutral-900 placeholder:text-neutral-400 outline-none focus:ring-2 focus:ring-neutral-900/10 bg-white"
                placeholder="Ask a governance question…"
              />
              <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-2.5 bg-neutral-50">
                <div className="text-xs text-neutral-500">
                  Ask about controls, evidence, SLAs, or decision ownership.
                </div>
                <button onClick={ask} disabled={!canAsk || busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                  type="button">
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {busy ? "Asking…" : "Ask"}
                </button>
              </div>
            </div>
          </div>

          {/* Body */}
          <div className="px-5 py-5 space-y-4">

            {/* Error */}
            {err && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-red-800">Error</div>
                  <div className="mt-0.5 text-sm text-red-700">{err}</div>
                </div>
              </div>
            )}

            {/* Empty state */}
            {!result && !err && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">
                Ask a question to get a boardroom-ready answer{" "}
                {effectiveScope === "kb" && resolvedArticleSlug
                  ? "grounded in this article."
                  : "grounded in governance best-practice."}
              </div>
            )}

            {/* Results */}
            {result && !err && (
              <>
                {/* Answer */}
                <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">Answer</div>
                  <div className="whitespace-pre-wrap text-sm text-neutral-900 leading-relaxed">
                    {safeStr(result.answer)}
                  </div>
                </div>

                {/* Key drivers */}
                {!!result.key_drivers?.length && (
                  <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">Key drivers</div>
                    <ul className="space-y-1.5">
                      {result.key_drivers.slice(0, 8).map((d, i) => (
                        <li key={i} className="text-sm text-neutral-700 flex items-start gap-2">
                          <span className="text-neutral-400 mt-0.5">•</span>
                          {safeStr(d)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Today's actions */}
                {!!result.today_actions?.length && (
                  <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">Today's actions</div>
                    <div className="space-y-2.5">
                      {result.today_actions.slice(0, 6)
                        .sort((a, b) => Number(a.priority) - Number(b.priority))
                        .map((a, i) => (
                          <div key={i} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm font-semibold text-neutral-900">
                                P{a.priority}: {safeStr(a.action)}
                              </div>
                              {a.owner_suggestion && (
                                <span className="shrink-0 rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-xs text-neutral-600">
                                  {safeStr(a.owner_suggestion)}
                                </span>
                              )}
                            </div>
                            <div className="mt-1 text-xs text-neutral-600">{safeStr(a.why)}</div>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Blockers */}
                {!!result.blockers?.length && (
                  <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">Blockers</div>
                    <div className="space-y-2.5">
                      {result.blockers.slice(0, 6).map((b, i) => (
                        <div key={i} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3.5">
                          <div className="flex flex-wrap items-center gap-2 mb-1.5">
                            <span className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-xs text-neutral-600 font-medium">
                              {safeStr(b.kind)}
                            </span>
                            {typeof b.age_days === "number" && (
                              <span className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-xs text-neutral-500">{b.age_days}d</span>
                            )}
                            {typeof b.severity === "number" && (
                              <span className="rounded-md border border-neutral-200 bg-white px-2 py-0.5 text-xs text-neutral-500">Sev {b.severity}</span>
                            )}
                          </div>
                          <div className="text-sm font-semibold text-neutral-900">{safeStr(b.title)}</div>
                          <div className="mt-1 text-xs text-neutral-600">
                            <span className="font-medium text-neutral-700">Next:</span> {safeStr(b.next_action)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommended routes */}
                {!!result.recommended_routes?.length && (
                  <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                    <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-3">Recommended routes</div>
                    <div className="flex flex-wrap gap-2">
                      {result.recommended_routes.slice(0, 10).map((r, i) => (
                        <Link key={i} href={safeStr(r.href)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 hover:bg-neutral-50">
                          {safeStr(r.label)}
                          <ExternalLink className="h-3 w-3 text-neutral-400" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}

                {/* Data requests */}
                {!!result.data_requests?.length && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">To be more accurate, I need:</div>
                    <ul className="space-y-1">
                      {result.data_requests.slice(0, 10).map((d, i) => (
                        <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                          <span className="text-amber-600 mt-0.5">•</span>
                          {safeStr(d)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}