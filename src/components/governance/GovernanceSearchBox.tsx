"use client";

// GovernanceSearchBox — inline dropdown (NO fixed overlay, NO click blocking)
// - Renders results panel inside a relative wrapper (absolute dropdown).
// - Outside-click closes.
// - Esc closes.
// - Never blocks other page links (Ask Aliena / Open).

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { Search, X, Loader2, ArrowUpRight } from "lucide-react";

type ResultItem = {
  id?: string;
  slug: string;
  title: string;
  summary?: string | null;
  updated_at?: string | null;
  category?: string | null;
  category_name?: string | null;
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function fmtUpdated(x: unknown) {
  const s = safeStr(x);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export default function GovernanceSearchBox({
  initialQ,
  categorySlug,
  autoFocus,
  placeholder,
}: {
  initialQ?: string;
  categorySlug?: string | null;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState(clamp(safeStr(initialQ).trim(), 200));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [items, setItems] = useState<ResultItem[]>([]);

  const canSearch = q.trim().length >= 2;

  const close = useCallback(() => setOpen(false), []);
  const clear = useCallback(() => {
    setQ("");
    setErr("");
    setItems([]);
    setOpen(false);
    inputRef.current?.focus();
  }, []);

  // Close on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const el = wrapRef.current;
      if (!el) return;
      if (!el.contains(e.target as any)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Esc closes
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Auto focus (optional)
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  // Fetch search results (debounced)
  useEffect(() => {
    let alive = true;
    const qq = q.trim();

    setErr("");

    if (!canSearch) {
      setLoading(false);
      setItems([]);
      return;
    }

    setLoading(true);

    const t = window.setTimeout(async () => {
      try {
        const u = new URL("/api/governance/search", window.location.origin);
        u.searchParams.set("q", qq);
        if (categorySlug) u.searchParams.set("cat", safeStr(categorySlug));

        const res = await fetch(u.toString(), { method: "GET" });
        const json = await res.json().catch(() => null);

        if (!alive) return;

        if (!res.ok || !json?.ok) {
          setErr(safeStr(json?.error) || `Search failed (${res.status})`);
          setItems([]);
          setLoading(false);
          setOpen(true);
          return;
        }

        const list = Array.isArray(json?.items) ? (json.items as ResultItem[]) : [];
        setItems(list.filter((x) => safeStr(x?.slug).trim()));
        setLoading(false);
        setOpen(true);
      } catch (e: any) {
        if (!alive) return;
        setErr(safeStr(e?.message) || "Search failed.");
        setItems([]);
        setLoading(false);
        setOpen(true);
      }
    }, 200);

    return () => {
      alive = false;
      window.clearTimeout(t);
    };
  }, [q, canSearch, categorySlug]);

  const countLabel = useMemo(() => {
    if (!canSearch) return "";
    if (loading) return "Searching…";
    if (err) return "Error";
    return `${items.length} result(s)`;
  }, [canSearch, loading, err, items.length]);

  return (
    <div ref={wrapRef} className="relative w-full">
      {/* Input */}
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
        <Search className="h-4 w-4 text-neutral-500" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(clamp(e.target.value, 200))}
          onFocus={() => {
            if (canSearch) setOpen(true);
          }}
          placeholder={placeholder ?? "Search governance guidance (type 2+ chars)…"}
          className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
        />
        {q ? (
          <button
            type="button"
            onClick={clear}
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
            aria-label="Clear"
            title="Clear"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* Dropdown (ABSOLUTE, not fixed) */}
      {open && canSearch ? (
        <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2">
            <div className="text-xs text-neutral-600">{countLabel}</div>
            <button
              type="button"
              onClick={close}
              className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Close
            </button>
          </div>

          <div className="max-h-[340px] overflow-y-auto p-3">
            {loading ? (
              <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching…
              </div>
            ) : err ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
                {err}
              </div>
            ) : items.length ? (
              <div className="space-y-2">
                {items.map((it) => (
                  <Link
                    key={safeStr(it.slug)}
                    href={`/governance/${encodeURIComponent(safeStr(it.slug))}`}
                    className="block rounded-2xl border border-neutral-200 bg-white p-3 hover:bg-neutral-50"
                    onClick={() => setOpen(false)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-neutral-900">
                          {safeStr(it.title) || safeStr(it.slug)}
                        </div>
                        {safeStr(it.summary).trim() ? (
                          <div className="mt-1 line-clamp-2 text-xs text-neutral-600">
                            {safeStr(it.summary)}
                          </div>
                        ) : null}
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                          {safeStr(it.updated_at).trim() ? (
                            <span className="rounded-md border border-neutral-200 px-2 py-0.5">
                              Updated {fmtUpdated(it.updated_at)}
                            </span>
                          ) : null}
                          {safeStr(it.category_name || it.category).trim() ? (
                            <span className="rounded-md border border-neutral-200 px-2 py-0.5">
                              {safeStr(it.category_name || it.category)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <span className="shrink-0 rounded-lg border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-700">
                        Open <ArrowUpRight className="ml-1 inline h-3.5 w-3.5 text-neutral-400" />
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-sm text-neutral-700">
                No results.
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}