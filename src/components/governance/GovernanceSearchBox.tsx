"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type SearchResult = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  updated_at: string | null;
  category_id: string | null;
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
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [q, setQ] = useState(initialQ);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // fixed panel positioning
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({ display: "none" });

  const lastReq = useRef<number>(0);

  const canSearch = useMemo(() => q.trim().length >= 2, [q]);

  function recomputePanelPos() {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const w = Math.max(280, Math.min(r.width, 860));

    setPanelStyle({
      position: "fixed",
      left: r.left,
      top: r.bottom + 8,
      width: w,
      zIndex: 9999,
      display: "block",
    });
  }

  useEffect(() => {
    if (!open) {
      setPanelStyle({ display: "none" });
      return;
    }
    recomputePanelPos();

    const onScroll = () => recomputePanelPos();
    const onResize = () => recomputePanelPos();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;

    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if (wrapRef.current?.contains(t)) return; // inside component
      setOpen(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Search request
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
        const json = await res.json();

        if (lastReq.current !== reqId) return;

        if (!json?.ok) {
          setErr(safeStr(json?.error) || "Search failed");
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

  const shouldShowPanel = open && (busy || err || (canSearch && results.length) || (canSearch && !busy));

  return (
    <div ref={wrapRef} className="relative">
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

      {shouldShowPanel ? (
        <div style={panelStyle} className="pointer-events-auto">
          <div className="overflow-hidden rounded-xl border bg-white shadow-lg dark:border-white/10 dark:bg-[#0b0d12]">
            <div className="flex items-center justify-between border-b px-3 py-2 text-xs opacity-70 dark:border-white/10">
              <span>{busy ? "Searching…" : err ? "Search error" : `${results.length} result(s)`}</span>
              <button
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
                      <div className="mt-1 line-clamp-2 text-xs opacity-75">{safeStr(r.summary)}</div>
                    ) : null}
                    {r.updated_at ? (
                      <div className="mt-2 text-xs opacity-60">Updated {fmtUpdated(r.updated_at)}</div>
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
      ) : null}
    </div>
  );
}