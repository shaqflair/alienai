"use client";

import { useState, useEffect, useRef } from "react";

/* =============================================================================
   TYPES
============================================================================= */
type ResultType = "person" | "project" | "allocation" | "scenario";

type SearchResult = {
  id:       string;
  type:     ResultType;
  title:    string;
  subtitle: string;
  href:     string;
  meta?:    string;
  colour?:  string;
};

/* =============================================================================
   HELPERS
============================================================================= */
const TYPE_ICON: Record<ResultType, string> = {
  person:     "P",
  project:    "Pr",
  allocation: "Al",
  scenario:    "Sc",
};

const TYPE_LABEL: Record<ResultType, string> = {
  person:     "People",
  project:    "Projects",
  allocation: "Allocations",
  scenario:    "Scenarios",
};

const TYPE_COLOUR: Record<ResultType, string> = {
  person:     "#0891b2",
  project:    "#7c3aed",
  allocation: "#059669",
  scenario:    "#d97706",
};

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark style={{ background: "rgba(14,116,144,0.15)", color: "#0e7490",
                      borderRadius: "2px", padding: "0 1px" }}>
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  );
}

/* =============================================================================
   RESULT ITEM
============================================================================= */
function ResultItem({
  result, query, isActive, onClick,
}: {
  result:    SearchResult;
  query:    string;
  isActive: boolean;
  onClick:  () => void;
}) {
  const typeColour = result.colour ?? TYPE_COLOUR[result.type];

  return (
    <a
      href={result.href}
      onClick={onClick}
      style={{
        display:    "flex",
        alignItems: "center",
        gap:        "10px",
        padding:    "8px 12px",
        textDecoration: "none",
        background: isActive ? "rgba(14,116,144,0.06)" : "transparent",
        borderLeft: isActive ? "2px solid #0e7490" : "2px solid transparent",
        transition: "background 0.1s",
        cursor:     "pointer",
      }}
    >
      <div style={{
        width:          28,
        height:         28,
        borderRadius:   result.type === "person" ? "50%" : "7px",
        background:     `${typeColour}18`,
        border:         `1.5px solid ${typeColour}30`,
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        flexShrink:     0,
        fontSize:       "8px",
        fontWeight:     800,
        color:          typeColour,
        letterSpacing:  "0.02em",
      }}>
        {result.type === "project" || result.type === "allocation"
          ? <div style={{
              width: 8, height: 8, borderRadius: "2px",
              background: typeColour,
            }} />
          : TYPE_ICON[result.type]
        }
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize:     "12px",
          fontWeight:   600,
          color:        "#0f172a",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}>
          {highlightMatch(result.title, query)}
        </div>
        <div style={{
          fontSize:     "11px",
          color:        "#94a3b8",
          overflow:     "hidden",
          textOverflow: "ellipsis",
          whiteSpace:   "nowrap",
        }}>
          {highlightMatch(result.subtitle, query)}
        </div>
      </div>

      {result.meta && (
        <span style={{
          fontSize:   "9px",
          fontWeight: 700,
          color:      typeColour,
          background: `${typeColour}15`,
          padding:    "2px 6px",
          borderRadius: "4px",
          flexShrink:   0,
          whiteSpace:   "nowrap",
        }}>
          {result.meta}
        </span>
      )}
    </a>
  );
}

/* =============================================================================
   MAIN COMPONENT
============================================================================= */
export default function GlobalSearch() {
  const [query,       setQuery]       = useState("");
  const [results,     setResults]     = useState<SearchResult[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [open,        setOpen]        = useState(false);
  const [activeIdx,   setActiveIdx]   = useState(-1);
  const [error,       setError]       = useState<string | null>(null);

  const inputRef    = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const abortRef    = useRef<AbortController | null>(null);

  const debouncedQuery = useDebounce(query, 220);

  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setResults([]);
      setOpen(false);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    fetch(`/api/search?q=${encodeURIComponent(debouncedQuery)}`, {
      signal: abortRef.current.signal,
      cache:  "no-store",
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setResults(data.results ?? []);
          setOpen(true);
          setActiveIdx(-1);
        } else {
          setError(data.error ?? "Search failed");
        }
      })
      .catch(e => {
        if (e.name !== "AbortError") setError("Search unavailable");
      })
      .finally(() => setLoading(false));
  }, [debouncedQuery]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || !results.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === "Enter" && activeIdx >= 0) {
      e.preventDefault();
      const r = results[activeIdx];
      if (r) {
        window.location.href = r.href;
        setOpen(false);
        setQuery("");
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  }

  const grouped = results.reduce<Record<ResultType, SearchResult[]>>(
    (acc, r) => {
      if (!acc[r.type]) acc[r.type] = [];
      acc[r.type].push(r);
      return acc;
    },
    {} as Record<ResultType, SearchResult[]>
  );

  const typeOrder: ResultType[] = ["person", "project", "allocation", "scenario"];

  function globalIdx(type: ResultType, localIdx: number): number {
    let offset = 0;
    for (const t of typeOrder) {
      if (t === type) return offset + localIdx;
      offset += (grouped[t] ?? []).length;
    }
    return -1;
  }

  return (
    <div style={{ position: "relative", padding: "0 12px 8px" }}>
      <div style={{
        display:    "flex",
        alignItems: "center",
        gap:        "8px",
        background: "rgba(255,255,255,0.06)",
        border:     "1.5px solid rgba(255,255,255,0.1)",
        borderRadius: "9px",
        padding:    "7px 10px",
        transition: "border-color 0.15s",
      }}>
        <svg width="13" height="13" viewBox="0 0 20 20" fill="none"
          style={{ flexShrink: 0, opacity: 0.5 }}>
          <circle cx="8.5" cy="8.5" r="5.5" stroke="white" strokeWidth="2"/>
          <path d="M13 13l3.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round"/>
        </svg>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); if (e.target.value) setOpen(true); }}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (results.length) setOpen(true); }}
          placeholder="Search..."
          style={{
            flex:       1,
            background: "none",
            border:     "none",
            outline:    "none",
            color:      "white",
            fontSize:   "12px",
            fontFamily: "inherit",
            minWidth:   0,
          }}
        />

        {loading && (
          <div style={{
            width: 10, height: 10, borderRadius: "50%",
            border: "1.5px solid rgba(255,255,255,0.3)",
            borderTopColor: "white",
            animation: "spin 0.6s linear infinite",
            flexShrink: 0,
          }} />
        )}

        {query && !loading && (
          <button type="button"
            onClick={() => { setQuery(""); setResults([]); setOpen(false); inputRef.current?.focus(); }}
            style={{
              background: "none", border: "none", color: "rgba(255,255,255,0.4)",
              cursor: "pointer", fontSize: "14px", lineHeight: 1, padding: 0,
              flexShrink: 0,
            }}>
            x
          </button>
        )}
      </div>

      {open && (results.length > 0 || error) && (
        <div
          ref={dropdownRef}
          style={{
            position:  "absolute",
            top:       "100%",
            left:      12,
            right:     12,
            zIndex:    1000,
            background: "white",
            borderRadius: "12px",
            border:     "1.5px solid #e2e8f0",
            boxShadow: "0 16px 48px rgba(0,0,0,0.15)",
            marginTop: "4px",
            maxHeight: "420px",
            overflowY: "auto",
          }}
        >
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

          {error ? (
            <div style={{
              padding: "14px 14px", fontSize: "12px", color: "#dc2626",
            }}>{error}</div>
          ) : (
            typeOrder.map(type => {
              const group = grouped[type];
              if (!group?.length) return null;
              return (
                <div key={type}>
                  <div style={{
                    padding:       "7px 12px 4px",
                    fontSize:      "9px",
                    fontWeight:    800,
                    color:         "#94a3b8",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    borderTop:     "1px solid #f1f5f9",
                  }}>
                    {TYPE_LABEL[type]}
                  </div>

                  {group.map((result, localIdx) => {
                    const gIdx = globalIdx(type, localIdx);
                    return (
                      <ResultItem
                        key={result.id}
                        result={result}
                        query={debouncedQuery}
                        isActive={activeIdx === gIdx}
                        onClick={() => { setOpen(false); setQuery(""); }}
                      />
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
