"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

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

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clamp(s: string, n: number) {
  const t = safeStr(s);
  return t.length > n ? t.slice(0, n) : t;
}

function badge(label: string) {
  return (
    <span className="rounded-lg border bg-white/60 px-2.5 py-1 text-xs opacity-80 dark:bg-white/5">
      {label}
    </span>
  );
}

export default function AskAlienaDrawer(props: {
  articleSlug: string;
  articleTitle: string;
  defaultQuestion?: string;
  triggerClassName?: string;
  triggerLabel?: string;
}) {
  const {
    articleSlug,
    articleTitle,
    defaultQuestion,
    triggerClassName,
    triggerLabel = "Ask Aliena →",
  } = props;

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(
    defaultQuestion || `What governance controls and evidence apply to “${articleTitle}”?`
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<AdvisorResult | null>(null);

  const canAsk = useMemo(() => q.trim().length >= 4, [q]);
  const lastReq = useRef<number>(0);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  async function ask() {
    if (!canAsk || busy) return;

    const reqId = Date.now();
    lastReq.current = reqId;

    setBusy(true);
    setErr(null);

    try {
      const res = await fetch("/api/ai/governance-advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          scope: "kb",
          articleSlug,
          question: clamp(q.trim(), 1200),
          mode: "kb",
        }),
      });

      const json = await res.json().catch(() => null);

      if (lastReq.current !== reqId) return;

      if (!res.ok || !json?.ok) {
        setErr(safeStr(json?.error) || `Request failed (${res.status})`);
        setResult(null);
      } else {
        setResult(json?.result ?? null);
      }
    } catch (e: any) {
      if (lastReq.current !== reqId) return;
      setErr(safeStr(e?.message) || "Request failed");
      setResult(null);
    } finally {
      if (lastReq.current === reqId) setBusy(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          triggerClassName ||
          "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
        }
        title="Ask Aliena about this article"
      >
        {triggerLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-[80]">
          {/* backdrop */}
          <div
            className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />

          {/* drawer */}
          <div className="absolute right-0 top-0 h-full w-full max-w-[560px] overflow-auto border-l bg-white shadow-2xl dark:bg-[#0b0d12] dark:border-white/10">
            <div className="sticky top-0 z-10 border-b bg-white/80 px-5 py-4 backdrop-blur dark:bg-[#0b0d12]/80 dark:border-white/10">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-medium opacity-70">Ask Aliena</div>
                  <div className="mt-1 truncate text-base font-semibold">
                    {articleTitle}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {badge("KB mode")}
                    {badge(`Slug: ${articleSlug}`)}
                    {result?.confidence != null
                      ? badge(`Confidence: ${Math.round(result.confidence * 100)}%`)
                      : null}
                  </div>
                </div>

                <button
                  onClick={() => setOpen(false)}
                  className="rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              <div className="mt-4">
                <textarea
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-xl border bg-white/70 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:border-white/10 dark:bg-white/5 dark:focus:ring-white/10"
                  placeholder="Ask a governance question…"
                />
                <div className="mt-2 flex items-center justify-between">
                  <div className="text-xs opacity-60">
                    Tip: ask about controls, evidence, SLAs, escalation, or decision ownership.
                  </div>
                  <button
                    onClick={ask}
                    disabled={!canAsk || busy}
                    className="inline-flex items-center justify-center rounded-lg border px-3 py-2 text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:hover:bg-white/10"
                  >
                    {busy ? "Asking…" : "Ask"}
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-5">
              {err ? (
                <div className="rounded-xl border bg-white/70 p-4 text-sm dark:border-white/10 dark:bg-white/5">
                  <div className="font-semibold">Error</div>
                  <div className="mt-1 opacity-80">{err}</div>
                </div>
              ) : null}

              {!result ? (
                <div className="rounded-xl border bg-white/70 p-4 text-sm opacity-80 dark:border-white/10 dark:bg-white/5">
                  Ask a question to get a boardroom-ready answer grounded in this article.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                    <div className="text-sm font-semibold">Answer</div>
                    <div className="mt-2 whitespace-pre-wrap text-sm opacity-85">
                      {safeStr(result.answer)}
                    </div>
                  </div>

                  {Array.isArray(result.key_drivers) && result.key_drivers.length ? (
                    <div className="rounded-2xl border bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                      <div className="text-sm font-semibold">Key drivers</div>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm opacity-85">
                        {result.key_drivers.slice(0, 8).map((d, i) => (
                          <li key={i}>{safeStr(d)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {Array.isArray(result.today_actions) && result.today_actions.length ? (
                    <div className="rounded-2xl border bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                      <div className="text-sm font-semibold">Today’s actions</div>
                      <div className="mt-2 space-y-2">
                        {result.today_actions.slice(0, 6).map((a, i) => (
                          <div
                            key={i}
                            className="rounded-xl border bg-white/80 p-4 dark:border-white/10 dark:bg-white/5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-sm font-medium">
                                P{a.priority}: {safeStr(a.action)}
                              </div>
                              {a.owner_suggestion ? (
                                <span className="rounded-md border px-2 py-0.5 text-xs opacity-70 dark:border-white/10">
                                  {safeStr(a.owner_suggestion)}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 text-xs opacity-75">{safeStr(a.why)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {Array.isArray(result.blockers) && result.blockers.length ? (
                    <div className="rounded-2xl border bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                      <div className="text-sm font-semibold">Blockers</div>
                      <div className="mt-2 space-y-2">
                        {result.blockers.slice(0, 6).map((b, i) => (
                          <div
                            key={i}
                            className="rounded-xl border bg-white/80 p-4 dark:border-white/10 dark:bg-white/5"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-md border px-2 py-0.5 text-xs opacity-70 dark:border-white/10">
                                {safeStr(b.kind)}
                              </span>
                              <div className="text-sm font-medium">{safeStr(b.title)}</div>
                              {typeof b.age_days === "number" ? (
                                <span className="rounded-md border px-2 py-0.5 text-xs opacity-70 dark:border-white/10">
                                  {b.age_days}d
                                </span>
                              ) : null}
                              {typeof b.severity === "number" ? (
                                <span className="rounded-md border px-2 py-0.5 text-xs opacity-70 dark:border-white/10">
                                  Sev {b.severity}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2 text-xs opacity-75">
                              Next action: {safeStr(b.next_action)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {Array.isArray(result.recommended_routes) && result.recommended_routes.length ? (
                    <div className="rounded-2xl border bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                      <div className="text-sm font-semibold">Recommended routes</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {result.recommended_routes.slice(0, 10).map((r, i) => (
                          <a
                            key={i}
                            href={safeStr(r.href)}
                            className="inline-flex items-center rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                          >
                            {safeStr(r.label)} →
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {Array.isArray(result.data_requests) && result.data_requests.length ? (
                    <div className="rounded-2xl border bg-white/70 p-5 shadow-sm dark:border-white/10 dark:bg-white/5">
                      <div className="text-sm font-semibold">Data needed</div>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm opacity-85">
                        {result.data_requests.slice(0, 10).map((d, i) => (
                          <li key={i}>{safeStr(d)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}