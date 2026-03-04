// src/app/changes/ChangesClient.tsx — RAID Intelligence style
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/* ─── Design tokens ─────────────────────────────────────────────────────────── */
const T = {
  bg:      "#f9f7f4",
  surface: "#ffffff",
  hr:      "#e7e5e4",
  ink:     "#1c1917",
  ink2:    "#44403c",
  ink3:    "#78716c",
  ink4:    "#a8a29e",
  ink5:    "#d6d3d1",
  mono:    "'IBM Plex Mono', 'Menlo', monospace",
  serif:   "'Playfair Display', 'Georgia', serif",
  body:    "'Source Serif 4', 'Georgia', serif",
};

type Rag = "R" | "A" | "G" | "N";
const RAG: Record<Rag, { fg: string; bg: string; border: string; label: string }> = {
  R: { fg: "#7f1d1d", bg: "#fef2f2", border: "#fca5a5", label: "CRITICAL"  },
  A: { fg: "#78350f", bg: "#fffbeb", border: "#fcd34d", label: "ADVISORY"  },
  G: { fg: "#14532d", bg: "#f0fdf4", border: "#86efac", label: "DELIVERED" },
  N: { fg: "#57534e", bg: "#fafaf9", border: "#e7e5e4", label: "OPEN"      },
};

/* ─── Types ─────────────────────────────────────────────────────────────────── */
type Row = {
  id: string;
  public_id?: string | null;
  seq?: number | null;
  project_id: string;
  artifact_id?: string | null;
  title?: string | null;
  description?: string | null;
  status?: string | null;
  delivery_status?: string | null;
  priority?: string | null;
  decision_status?: string | null;
  decision_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  requester_name?: string | null;
  requester_id?: string | null;
  projects?: { id?: string; title?: string | null; project_code?: any } | null;
};

type ApiResp =
  | { ok: false; error: string }
  | { ok: true; items: Row[]; nextCursor: string | null; facets?: { priorities?: string[]; statuses?: string[] } };

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function safeStr(x: any) { return typeof x === "string" ? x : ""; }

function fmtUkDate(x?: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return String(x);
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function normPriority(p: any) {
  const v = safeStr(p).trim().toLowerCase();
  if (v === "critical") return "Critical";
  if (v === "high")     return "High";
  if (v === "medium")   return "Medium";
  if (v === "low")      return "Low";
  return safeStr(p).trim();
}

function priorityRag(p: string): Rag {
  const v = p.toLowerCase();
  if (v === "critical") return "R";
  if (v === "high")     return "A";
  return "N";
}

function statusRag(s: string): Rag {
  const v = s.toLowerCase().replace(/\s+/g, "_");
  if (v === "implemented" || v === "closed") return "G";
  if (v === "review" || v === "analysis")    return "A";
  if (v === "in_progress")                   return "N";
  return "N";
}

function projectLabel(r: Row) {
  const code  = r?.projects?.project_code;
  const title = safeStr(r?.projects?.title) || "Project";
  const codeStr = code != null ? String(code) : "";
  return { code: codeStr, title };
}

function openHref(r: Row) {
  const pid = safeStr(r.project_id).trim();
  if (!pid) return "/projects";
  const sp = new URLSearchParams();
  sp.set("cr", safeStr(r.id).trim());
  const pub = safeStr(r.public_id).trim();
  if (pub) sp.set("publicId", pub);
  return `/projects/${pid}/change?${sp.toString()}`;
}

/* ─── Atoms ─────────────────────────────────────────────────────────────────── */
function Mono({ children, size = 11, color, weight = 400, upper = false }: {
  children: React.ReactNode; size?: number; color?: string; weight?: number; upper?: boolean;
}) {
  return (
    <span style={{
      fontFamily: T.mono, fontSize: size, color: color ?? T.ink3,
      fontWeight: weight, letterSpacing: upper ? "0.08em" : undefined,
      textTransform: upper ? "uppercase" : undefined,
    }}>{children}</span>
  );
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink4 }}>
      {children}
    </span>
  );
}

function RagChip({ rag, label }: { rag: Rag; label?: string }) {
  const cfg = RAG[rag];
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
      textTransform: "uppercase", padding: "2px 7px", borderRadius: 2,
      background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.border}`,
      whiteSpace: "nowrap",
    }}>{label ?? cfg.label}</span>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", padding: "4px 12px",
      fontFamily: T.mono, fontSize: 10, fontWeight: active ? 600 : 400,
      letterSpacing: "0.07em", textTransform: "uppercase" as const,
      background: active ? T.ink : "transparent", color: active ? "#fff" : T.ink3,
      border: `1px solid ${active ? T.ink : T.hr}`,
      borderRadius: 2, cursor: "pointer", transition: "all 0.13s ease",
    }}>{label}</button>
  );
}

function SectionRule({ label, count }: { label?: string; count?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 24px", borderBottom: `1px solid ${T.hr}` }}>
      {label && <Cap>{label}</Cap>}
      {count !== undefined && (
        <Mono size={10} color={T.ink4}>{count} items</Mono>
      )}
      <div style={{ flex: 1, height: "1px", background: T.hr }} />
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────────── */
export default function ChangesClient({
  initialQ, initialPriority, initialStale,
}: {
  initialQ: string; initialPriority: string; initialStale: boolean;
}) {
  const router = useRouter();

  const [q,        setQ]        = useState(initialQ);
  const [priority, setPriority] = useState(initialPriority);
  const [stale,    setStale]    = useState(initialStale);
  const [items,    setItems]    = useState<Row[]>([]);
  const [cursor,   setCursor]   = useState<string | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err,      setErr]      = useState("");
  const [nowStr,   setNowStr]   = useState("");

  useEffect(() => {
    setNowStr(new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).replace(",", ""));
  }, []);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (q.trim())        qs.set("q", q.trim());
    if (priority.trim()) qs.set("priority", priority.trim());
    if (stale)           qs.set("stale", "1");
    router.replace(qs.toString() ? `/changes?${qs.toString()}` : "/changes");
  }, [q, priority, stale]);

  const params = useMemo(() => {
    const qs = new URLSearchParams();
    if (q.trim())        qs.set("q", q.trim());
    if (priority.trim()) qs.set("priority", priority.trim());
    if (stale)           qs.set("stale", "1");
    qs.set("limit", "60");
    return qs;
  }, [q, priority, stale]);

  async function loadFirst() {
    setLoading(true); setErr("");
    try {
      const r = await fetch(`/api/change/portfolio?${params.toString()}`, { cache: "no-store" });
      const j = (await r.json()) as ApiResp;
      if (!j.ok) throw new Error((j as any).error || "Failed to load");
      setItems(Array.isArray(j.items) ? j.items : []);
      setCursor(j.nextCursor ?? null);
    } catch (e: any) {
      setItems([]); setCursor(null); setErr(e?.message || "Failed to load changes");
    } finally { setLoading(false); }
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true); setErr("");
    try {
      const qs = new URLSearchParams(params);
      qs.set("cursor", cursor);
      const r = await fetch(`/api/change/portfolio?${qs.toString()}`, { cache: "no-store" });
      const j = (await r.json()) as ApiResp;
      if (!j.ok) throw new Error((j as any).error || "Failed to load more");
      const next = Array.isArray(j.items) ? j.items : [];
      setItems(prev => {
        const seen = new Set(prev.map(x => x.id));
        return [...prev, ...next.filter(x => !seen.has(x.id))];
      });
      setCursor(j.nextCursor ?? null);
    } catch (e: any) { setErr(e?.message || "Failed to load more"); }
    finally { setLoadingMore(false); }
  }

  useEffect(() => { loadFirst(); }, [params.toString()]);

  // Counts
  const counts = useMemo(() => {
    const critical = items.filter(r => normPriority(r.priority).toLowerCase() === "critical").length;
    const high     = items.filter(r => normPriority(r.priority).toLowerCase() === "high").length;
    const open     = items.filter(r => !["implemented","closed"].includes(safeStr(r.delivery_status || r.status).toLowerCase())).length;
    const done     = items.filter(r =>  ["implemented","closed"].includes(safeStr(r.delivery_status || r.status).toLowerCase())).length;
    return { critical, high, open, done };
  }, [items]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap');
        @keyframes ragPulse { 0%,100%{opacity:.2} 50%{opacity:.45} }
        @keyframes spin { to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
        .cr-row:hover { background: #fafaf9 !important; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body }}>

        {/* ── Header bar ── */}
        <div style={{ background: T.ink, borderBottom: "1px solid #292524", padding: "0 40px" }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Mono size={10} color="#a8a29e" upper weight={600}>Change Intelligence</Mono>
              <span style={{ color: "#44403c", fontSize: 10 }}>·</span>
              <Mono size={10} color="#78716c">Portfolio Change Control</Mono>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {nowStr && <Mono size={9} color="#57534e">Updated {nowStr}</Mono>}
              <button onClick={loadFirst} disabled={loading} style={{
                fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em",
                textTransform: "uppercase", color: "#a8a29e", background: "transparent",
                border: "1px solid #292524", borderRadius: 2, cursor: "pointer", padding: "4px 12px",
              }}>Refresh</button>
              <Link href="/" style={{
                fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em",
                textTransform: "uppercase", color: "#a8a29e", textDecoration: "none",
                padding: "4px 12px", border: "1px solid #292524", borderRadius: 2,
              }}>← Dashboard</Link>
            </div>
          </div>
        </div>

        {/* ── KPI strip ── */}
        {!loading && items.length > 0 && (
          <div style={{ borderBottom: `1px solid ${T.hr}`, background: T.surface }}>
            <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex" }}>
              {[
                { label: "Total",    value: items.length,    rag: "N" as Rag },
                { label: "Critical", value: counts.critical, rag: counts.critical > 0 ? "R" as Rag : "N" as Rag },
                { label: "High",     value: counts.high,     rag: counts.high > 0 ? "A" as Rag : "N" as Rag },
                { label: "Open",     value: counts.open,     rag: "N" as Rag },
                { label: "Delivered",value: counts.done,     rag: counts.done > 0 ? "G" as Rag : "N" as Rag },
              ].map((cell, i, arr) => (
                <div key={cell.label} style={{
                  padding: "20px 32px", flex: 1,
                  borderRight: i < arr.length - 1 ? `1px solid ${T.hr}` : "none",
                }}>
                  <Cap>{cell.label}</Cap>
                  <div style={{
                    fontFamily: T.serif, fontSize: 36, fontWeight: 700, lineHeight: 1, marginTop: 8,
                    color: cell.rag !== "N" ? RAG[cell.rag].fg : T.ink,
                  }}>{cell.value}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 40px" }}>

          {/* ── Intelligence summary ── */}
          {!loading && items.length > 0 && (counts.critical > 0 || counts.high > 0) && (
            <div style={{
              background: counts.critical > 0 ? RAG.R.bg : RAG.A.bg,
              border: `1px solid ${counts.critical > 0 ? RAG.R.border : RAG.A.border}`,
              borderRadius: 4, padding: "18px 24px", marginBottom: 24,
              display: "flex", alignItems: "flex-start", gap: 14,
            }}>
              <div style={{ marginTop: 3, position: "relative", width: 12, height: 12, flexShrink: 0 }}>
                {counts.critical > 0 && (
                  <span style={{ position: "absolute", inset: -3, borderRadius: "50%", background: RAG.R.fg, opacity: 0.18, animation: "ragPulse 2.2s ease-in-out infinite" }} />
                )}
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: counts.critical > 0 ? RAG.R.fg : RAG.A.fg, display: "inline-block", marginTop: 2 }} />
              </div>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Cap>Change Intelligence Summary</Cap>
                  <span style={{
                    fontFamily: T.mono, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: counts.critical > 0 ? RAG.R.fg : RAG.A.fg,
                    background: "rgba(255,255,255,0.6)",
                    border: `1px solid ${counts.critical > 0 ? RAG.R.border : RAG.A.border}`,
                    borderRadius: 2, padding: "2px 6px",
                  }}>{counts.critical > 0 ? "CRITICAL" : "ADVISORY"}</span>
                </div>
                <div style={{ fontFamily: T.body, fontSize: 14, color: T.ink2, lineHeight: 1.6 }}>
                  {items.length} change request{items.length !== 1 ? "s" : ""} across the portfolio.
                  {counts.critical > 0 && ` ${counts.critical} critical item${counts.critical > 1 ? "s" : ""} require immediate escalation.`}
                  {counts.high > 0 && ` ${counts.high} high priority item${counts.high > 1 ? "s" : ""} need attention.`}
                  {` ${counts.open} open, ${counts.done} delivered.`}
                </div>
              </div>
            </div>
          )}

          {/* ── Filters ── */}
          <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 4, padding: "20px 24px", marginBottom: 24 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Cap>Priority</Cap>
              <div style={{ width: 1, height: 14, background: T.hr, margin: "0 4px" }} />
              {[
                { label: "All",           val: ""              },
                { label: "High+Critical", val: "High,Critical" },
                { label: "Critical",      val: "Critical"      },
                { label: "High",          val: "High"          },
                { label: "Medium",        val: "Medium"        },
                { label: "Low",           val: "Low"           },
              ].map(({ label, val }) => (
                <Pill key={label} label={label} active={priority === val} onClick={() => setPriority(val)} />
              ))}
              <div style={{ width: 1, height: 14, background: T.hr, margin: "0 8px" }} />
              <Pill label="Stale 14d+" active={stale} onClick={() => setStale(v => !v)} />
              {(q || priority || stale) && (
                <button onClick={() => { setQ(""); setPriority(""); setStale(false); }} style={{
                  fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em",
                  textTransform: "uppercase", color: RAG.R.fg, background: "transparent",
                  border: `1px solid ${RAG.R.border}`, borderRadius: 2, cursor: "pointer", padding: "4px 10px",
                }}>Clear ×</button>
              )}
            </div>

            {/* Search */}
            <div style={{ position: "relative", maxWidth: 440 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.ink4, fontSize: 14 }}>⌕</span>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search title, CR reference, requester…"
                style={{
                  width: "100%", padding: "8px 12px 8px 34px",
                  fontFamily: T.mono, fontSize: 11, color: T.ink,
                  background: T.bg, border: `1px solid ${T.hr}`, borderRadius: 2, outline: "none",
                }}
              />
            </div>

            {err && (
              <div style={{ marginTop: 12, background: RAG.R.bg, border: `1px solid ${RAG.R.border}`, borderRadius: 4, padding: "12px 16px" }}>
                <Mono size={12} color={RAG.R.fg}>{err}</Mono>
              </div>
            )}
          </div>

          {/* ── Table ── */}
          <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 4, overflow: "hidden" }}>
            <SectionRule label="Change Requests" count={loading ? undefined : items.length} />

            {loading ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: "50%",
                    border: `2px solid ${T.ink5}`, borderTopColor: T.ink,
                    animation: "spin 0.8s linear infinite",
                  }} />
                  <Mono size={11} color={T.ink4}>Loading change requests…</Mono>
                </div>
              </div>
            ) : items.length === 0 ? (
              <div style={{ padding: "60px 0", textAlign: "center" }}>
                <Mono size={12} color={T.ink4}>No change requests match your filters.</Mono>
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 960, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.hr}` }}>
                      {["", "Project", "CR Ref", "Title", "Priority", "Status", "Updated", ""].map((h, i) => (
                        <th key={i} style={{
                          padding: "12px 20px", textAlign: i === 7 ? "right" : "left",
                          fontFamily: T.mono, fontSize: 9, fontWeight: 600,
                          letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink4,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => {
                      const pri      = normPriority(r.priority);
                      const priRag   = priorityRag(pri);
                      const lane     = safeStr(r.delivery_status || r.status || "new").trim().replace(/\s+/g, "_").toLowerCase();
                      const stRag    = statusRag(lane);
                      const pub      = safeStr(r.public_id) || (r.seq != null ? `CR-${r.seq}` : "");
                      const title    = safeStr(r.title) || "Untitled change";
                      const { code, title: projTitle } = projectLabel(r);
                      const rowRag   = priRag === "R" ? "R" : stRag === "G" ? "G" : priRag === "A" ? "A" : "N";

                      return (
                        <tr key={r.id} className="cr-row" style={{ borderBottom: `1px solid ${T.hr}`, background: T.surface }}>

                          {/* RAG pip */}
                          <td style={{ padding: "16px 20px 16px 24px", width: 28 }}>
                            <span style={{ position: "relative", display: "inline-flex", width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
                              {rowRag === "R" && (
                                <span style={{ position: "absolute", inset: -3, borderRadius: "50%", background: RAG.R.fg, opacity: 0.15, animation: "ragPulse 2.2s ease-in-out infinite" }} />
                              )}
                              <span style={{ width: 7, height: 7, borderRadius: "50%", background: rowRag === "N" ? T.ink5 : RAG[rowRag].fg, display: "inline-block" }} />
                            </span>
                          </td>

                          {/* Project */}
                          <td style={{ padding: "16px 20px" }}>
                            {code && <Mono size={10} color={T.ink4} weight={600}>{code}</Mono>}
                            <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink, marginTop: code ? 3 : 0 }}>{projTitle}</div>
                          </td>

                          {/* CR ref */}
                          <td style={{ padding: "16px 20px" }}>
                            <Mono size={11} color={T.ink2} weight={600}>{pub || r.id.slice(0, 8)}</Mono>
                          </td>

                          {/* Title */}
                          <td style={{ padding: "16px 20px", minWidth: 320 }}>
                            <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink, marginBottom: 3 }}>{title}</div>
                            {r.requester_name && (
                              <Mono size={10} color={T.ink4}>Requester: {r.requester_name}</Mono>
                            )}
                          </td>

                          {/* Priority */}
                          <td style={{ padding: "16px 20px" }}>
                            {pri ? <RagChip rag={priRag} label={pri} /> : <Mono size={10} color={T.ink5}>—</Mono>}
                          </td>

                          {/* Status */}
                          <td style={{ padding: "16px 20px" }}>
                            <RagChip rag={stRag} label={lane.replace(/_/g, " ")} />
                          </td>

                          {/* Date */}
                          <td style={{ padding: "16px 20px", whiteSpace: "nowrap" }}>
                            <Mono size={11} color={T.ink3}>{fmtUkDate(r.updated_at || r.created_at)}</Mono>
                          </td>

                          {/* Open link */}
                          <td style={{ padding: "16px 24px 16px 20px", textAlign: "right" }}>
                            <button
                              onClick={() => router.push(openHref(r))}
                              style={{
                                fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
                                textTransform: "uppercase", color: T.ink3, background: "transparent",
                                border: `1px solid ${T.hr}`, borderRadius: 2, cursor: "pointer",
                                padding: "4px 10px", transition: "all 0.13s ease",
                              }}
                              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = T.ink; (e.currentTarget as HTMLElement).style.color = T.ink; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = T.hr; (e.currentTarget as HTMLElement).style.color = T.ink3; }}
                            >Open →</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Load more */}
            <div style={{ padding: "16px 24px", borderTop: `1px solid ${T.hr}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Mono size={10} color={T.ink4}>{cursor ? "More available" : items.length ? "End of list" : ""}</Mono>
              {cursor && (
                <button onClick={loadMore} disabled={loadingMore} style={{
                  fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em",
                  textTransform: "uppercase", color: T.ink, background: T.bg,
                  border: `1px solid ${T.hr}`, borderRadius: 2, cursor: "pointer",
                  padding: "6px 16px", opacity: loadingMore ? 0.6 : 1,
                }}>
                  {loadingMore ? "Loading…" : "Load More →"}
                </button>
              )}
            </div>
          </div>

          <div style={{ height: 40 }} />
        </div>
      </div>
    </>
  );
}