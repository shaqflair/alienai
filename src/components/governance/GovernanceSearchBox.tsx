"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type SearchResult = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  updated_at: string | null;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function fmtUpdated(x: unknown) {
  const s = safeStr(x);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export default function GovernanceSearchBox({
  initialQ = "",
  categorySlug,
}: {
  initialQ?: string;
  categorySlug?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState(initialQ);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // fixed panel positioning
  const [pos, setPos] = useState<{ left: number; top: number; width: number }>({
    left: 0,
    top: 0,
    width: 420,
  });

  const lastReq = useRef<number>(0);
  const canSearch = useMemo(() => q.trim().length >= 2, [q]);

  function recompute() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(320, Math.min(r.width, 900));
    setPos({ left: r.left, top: r.bottom + 8, width });
  }

  // keep panel anchored while open
  useEffect(() => {
    if (!open) return;
    recompute();

    const onScroll = () => recompute();
    const onResize = () => recompute();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // close on escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // search request (debounced)
  useEffect(() => {
    const qq = q.trim();
    if (qq.length < 2) {
      setResults([]);
      setErr(null);
      setBusy(false);
      return;
    }

    const reqId = Date.now();
    lastReq.current = reqId;

    const t = setTimeout(async () => {
      setBusy(true);
      setErr(null);
      try {
        const u = new URL("/api/governance/search", window.location.origin);
        u.searchParams.set("q", qq);
        if (categorySlug) u.searchParams.set("cat", categorySlug);

        const res = await fetch(u.toString(), { cache: "no-store" });
        const json = await res.json().catch(() => null);

        if (lastReq.current !== reqId) return;

        if (!res.ok || !json?.ok) {
          setErr(safeStr(json?.error) || `Search failed (${res.status})`);
          setResults([]);
        } else {
          setResults(Array.isArray(json.results) ? json.results : []);
        }
      } catch (e: any) {
        if (lastReq.current !== reqId) return;
        setErr(safeStr(e?.message) || "Search failed");
        setResults([]);
      } finally {
        if (lastReq.current === reqId) setBusy(false);
      }
    }, 220);

    return () => clearTimeout(t);
  }, [q, categorySlug]);

  const showPanel = open && (busy || err || canSearch);

  return (
    <>
      <input
        ref={inputRef}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search governance guidance (type 2+ chars)…"
        className="w-full rounded-lg border bg-white/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:bg-white/5 dark:focus:ring-white/10"
      />

      {showPanel ? (
        <>
          {/* Backdrop: ONLY purpose is to close on outside click.
              This prevents invisible hitboxes elsewhere. */}
          <button
            type="button"
            aria-label="Close search"
            className="fixed inset-0 z-[9998] cursor-default bg-transparent"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div
            className="fixed z-[9999]"
            style={{ left: pos.left, top: pos.top, width: pos.width }}
          >
            <div className="overflow-hidden rounded-xl border bg-white shadow-lg dark:border-white/10 dark:bg-[#0b0d12]">
              <div className="flex items-center justify-between border-b px-3 py-2 text-xs opacity-70 dark:border-white/10">
                <span>
                  {busy ? "Searching…" : err ? "Search error" : `${results.length} result(s)`}
                </span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border px-2 py-0.5 hover:bg-black/5 dark:border-white/10 dark:hover:bg-white/10"
                >
                  Close
                </button>
              </div>

              {err ? (
                <div className="px-3 py-3 text-sm opacity-80">{err}</div>
              ) : results.length ? (
                <div className="max-h-[360px] overflow-auto p-2">
                  {results.map((r) => (
                    <a
                      key={r.id}
                      href={`/governance/${encodeURIComponent(r.slug)}`}
                      className="block rounded-lg border bg-white/70 p-3 text-sm hover:bg-white/90 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
                      onClick={() => setOpen(false)}
                    >
                      <div className="font-semibold">{safeStr(r.title)}</div>
                      {r.summary ? (
                        <div className="mt-1 line-clamp-2 text-xs opacity-75">
                          {safeStr(r.summary)}
                        </div>
                      ) : null}
                      {r.updated_at ? (
                        <div className="mt-2 text-xs opacity-60">
                          Updated {fmtUpdated(r.updated_at)}
                        </div>
                      ) : null}
                    </a>
                  ))}
                </div>
              ) : canSearch && !busy ? (
                <div className="px-3 py-3 text-sm opacity-80">No matches.</div>
              ) : (
                <div className="px-3 py-3 text-sm opacity-60">Type at least 2 characters.</div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}