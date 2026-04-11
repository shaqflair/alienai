// src/app/wbs/items/WbsItemsClient.tsx — RAID Intelligence style
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type DaysParam   = 7 | 14 | 30 | 60 | "all";
export type Bucket      = "overdue" | "due_7" | "due_14" | "due_30" | "due_60" | "";
export type StatusFilter = "open" | "done" | "";

export type WbsItemRow = {
  project_id?:   string | null;
  artifact_id?:  string | null;
  wbs_row_id?:   string | null;
  title?:        string | null;
  project_title?: string | null;
  project_code?:  string | number | null;
  owner_label?:   string | null;
  due_date?:      string | null;
  status?:        string | null;
  missing_effort?: boolean | null;
};

type ApiResp =
  | { ok: false; error: string; meta?: any }
  | { ok: true; items: WbsItemRow[]; nextCursor?: string | null; meta?: any };

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
  R: { fg: "#7f1d1d", bg: "#fef2f2", border: "#fca5a5", label: "OVERDUE"   },
  A: { fg: "#78350f", bg: "#fffbeb", border: "#fcd34d", label: "DUE SOON"  },
  G: { fg: "#14532d", bg: "#f0fdf4", border: "#86efac", label: "DONE"      },
  N: { fg: "#57534e", bg: "#fafaf9", border: "#e7e5e4", label: "OPEN"      },
};

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }

function ukDate(iso?: string | null) {
  const s = safeStr(iso).trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

function buildHref(params: Record<string, any>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  const qs = sp.toString();
  return qs ? `/wbs/items?${qs}` : "/wbs/items";
}

function rowRag(it: WbsItemRow): Rag {
  const st = safeStr(it.status).toLowerCase();
  const isDone = st === "done" || st === "closed" || st === "complete" || st === "completed";
  if (isDone) return "G";
  if (it.due_date) {
    const today = new Date().toISOString().slice(0, 10);
    if (it.due_date < today) return "R";
    const soon = new Date(); soon.setDate(soon.getDate() + 7);
    if (it.due_date <= soon.toISOString().slice(0, 10)) return "A";
  }
  return "N";
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
    <span style={{
      fontFamily: T.mono, fontSize: 9, fontWeight: 600,
      letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink4,
    }}>{children}</span>
  );
}

function Pip({ rag }: { rag: Rag }) {
  const color = rag === "N" ? T.ink5 : RAG[rag].fg;
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />;
}

function StatusChip({ rag }: { rag: Rag }) {
  const cfg = RAG[rag];
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
      textTransform: "uppercase", padding: "2px 7px", borderRadius: 2,
      background: cfg.bg, color: cfg.fg, border: `1px solid ${cfg.border}`,
      whiteSpace: "nowrap",
    }}>{cfg.label}</span>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px",
      fontFamily: T.mono, fontSize: 10, fontWeight: active ? 600 : 400,
      letterSpacing: "0.07em", textTransform: "uppercase" as const,
      background: active ? T.ink : "transparent", color: active ? "#fff" : T.ink3,
      border: `1px solid ${active ? T.ink : T.hr}`,
      borderRadius: 2, cursor: "pointer", transition: "all 0.13s ease",
    }}>{label}</button>
  );
}

function SectionRule({ label }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      {label && <Cap>{label}</Cap>}
      <div style={{ flex: 1, height: "1px", background: T.hr }} />
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────────── */
export default function WbsItemsClient({
  initialDays, initialBucket, initialStatus, initialMissingEffort, initialQ,
}: {
  initialDays: DaysParam; initialBucket: Bucket; initialStatus: StatusFilter;
  initialMissingEffort: boolean; initialQ: string;
}) {
  const router = useRouter();
  const [days,          setDays]          = useState<DaysParam>(initialDays);
  const [bucket,        setBucket]        = useState<Bucket>(initialBucket);
  const [status,        setStatus]        = useState<StatusFilter>(initialStatus);
  const [missingEffort, setMissingEffort] = useState<boolean>(initialMissingEffort);
  const [q,             setQ]             = useState<string>(initialQ);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [err,     setErr]     = useState("");
  const [items,   setItems]   = useState<WbsItemRow[]>([]);
  const [nowStr,  setNowStr]  = useState("");

  useEffect(() => {
    setNowStr(new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).replace(",", ""));
  }, []);

  useEffect(() => {
    const href = buildHref({ days, bucket: bucket || undefined, status: status || undefined, missingEffort: missingEffort ? 1 : undefined, q: q || undefined });
    router.replace(href);
  }, [days, bucket, status, missingEffort, q]);

  async function load() {
    setLoading(true); setErr("");
    try {
      const url = buildHref({ days, bucket: bucket || undefined, status: status || undefined, missingEffort: missingEffort ? 1 : undefined, q: q || undefined })
        .replace("/wbs/items", "/api/wbs/items");
      const r = await fetch(url, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ApiResp | null;
      if (!r.ok) throw new Error((j as any)?.error || `Request failed (${r.status})`);
      if (!j || (j as any).ok !== true) throw new Error((j as any)?.error || "Invalid response");
      setItems((j as any).items || []);
    } catch (e: any) {
      setItems([]); setErr(e?.message || "Failed to load WBS items");
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, [days, bucket, status, missingEffort, q]);

  const title = useMemo(() => {
    if (bucket === "overdue") return "Overdue Work Packages";
    if (bucket === "due_7")   return "Due in 7 Days";
    if (bucket === "due_14")  return "Due in 14 Days";
    if (bucket === "due_30")  return "Due in 30 Days";
    if (bucket === "due_60")  return "Due in 60 Days";
    if (missingEffort)        return "Missing Effort Estimates";
    if (status === "done")    return "Completed Work Packages";
    if (status === "open")    return "Open Work Packages";
    return "All Work Packages";
  }, [bucket, missingEffort, status]);

  const anyFilterOn = !!(bucket || status || missingEffort || q);

  const counts = useMemo(() => {
    const r = items.filter(i => rowRag(i) === "R").length;
    const a = items.filter(i => rowRag(i) === "A").length;
    const g = items.filter(i => rowRag(i) === "G").length;
    return { r, a, g };
  }, [items]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap');
        * { box-sizing: border-box; }
        .wbs-row:hover { background: #fafaf9 !important; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body }}>

        {/* ── Header bar ── */}
        <div style={{ background: T.ink, borderBottom: "1px solid #292524", padding: "0 40px" }}>
          <div style={{ maxWidth: 1280, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Mono size={10} color="#a8a29e" upper weight={600}>WBS Intelligence</Mono>
              <span style={{ color: "#44403c", fontSize: 10 }}>·</span>
              <Mono size={10} color="#78716c">{title}</Mono>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {nowStr && <Mono size={9} color="#57534e">Updated {nowStr}</Mono>}
              <Link href={`/wbs/stats?days=${days}`} style={{
                fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em",
                textTransform: "uppercase", color: "#a8a29e", textDecoration: "none",
                padding: "4px 12px", border: "1px solid #292524", borderRadius: 2,
              }}>← Stats</Link>
            </div>
          </div>
        </div>

        {/* ── KPI strip ── */}
        {!loading && items.length > 0 && (
          <div style={{ borderBottom: `1px solid ${T.hr}`, background: T.surface }}>
            <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex" }}>
              {[
                { label: "Total", value: items.length, rag: "N" as Rag },
                { label: "Overdue", value: counts.r, rag: counts.r > 0 ? "R" as Rag : "N" as Rag },
                { label: "Due Soon", value: counts.a, rag: counts.a > 0 ? "A" as Rag : "N" as Rag },
                { label: "Completed", value: counts.g, rag: counts.g > 0 ? "G" as Rag : "N" as Rag },
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

          {/* Filters */}
          <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 4, padding: "20px 24px", marginBottom: 28 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, marginBottom: 16 }}>
              <Cap>Window</Cap>
              <div style={{ width: 1, height: 14, background: T.hr, margin: "0 4px" }} />
              {(["all", 7, 14, 30, 60] as const).map(d => (
                <Pill key={String(d)} label={d === "all" ? "All" : `${d}d`} active={days === d} onClick={() => setDays(d as DaysParam)} />
              ))}

              <div style={{ width: 1, height: 14, background: T.hr, margin: "0 8px" }} />
              <Cap>Quick</Cap>
              <div style={{ width: 1, height: 14, background: T.hr, margin: "0 4px" }} />

              {([
                { label: "Overdue",      val: "overdue" as Bucket },
                { label: "Due 7d",       val: "due_7"   as Bucket },
                { label: "Due 14d",      val: "due_14"  as Bucket },
                { label: "Due 30d",      val: "due_30"  as Bucket },
                { label: "Due 60d",      val: "due_60"  as Bucket },
              ]).map(({ label, val }) => (
                <Pill key={val} label={label} active={bucket === val}
                  onClick={() => { setBucket(val); setStatus(""); setMissingEffort(false); }} />
              ))}

              <Pill label="Missing Effort" active={missingEffort}
                onClick={() => { setMissingEffort(true); setBucket(""); setStatus(""); }} />

              <div style={{ width: 1, height: 14, background: T.hr, margin: "0 8px" }} />
              <Pill label="Open"      active={status === "open"} onClick={() => { setStatus("open");  setBucket(""); setMissingEffort(false); }} />
              <Pill label="Done"      active={status === "done"} onClick={() => { setStatus("done");  setBucket(""); setMissingEffort(false); }} />

              {anyFilterOn && (
                <button onClick={() => { setBucket(""); setStatus(""); setMissingEffort(false); setQ(""); if (inputRef.current) inputRef.current.value = ""; }}
                  style={{
                    fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em",
                    textTransform: "uppercase", color: RAG.R.fg, background: "transparent",
                    border: `1px solid ${RAG.R.border}`, borderRadius: 2, cursor: "pointer", padding: "4px 10px",
                  }}>Clear ×</button>
              )}
            </div>

            {/* Search */}
            <div style={{ position: "relative", maxWidth: 400 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: T.ink4, fontSize: 14 }}>⌕</span>
              <input
                ref={inputRef}
                defaultValue={q}
                onKeyDown={e => { if (e.key === "Enter") setQ((e.target as HTMLInputElement).value.trim()); }}
                placeholder="Search work package / project… (Enter)"
                style={{
                  width: "100%", padding: "8px 12px 8px 34px",
                  fontFamily: T.mono, fontSize: 11, color: T.ink,
                  background: T.bg, border: `1px solid ${T.hr}`, borderRadius: 2, outline: "none",
                }}
              />
            </div>
          </div>

          {/* State messages */}
          {loading && (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <Mono size={12} color={T.ink4}>Loading work packages…</Mono>
            </div>
          )}
          {!loading && err && (
            <div style={{ background: RAG.R.bg, border: `1px solid ${RAG.R.border}`, borderRadius: 4, padding: "16px 20px" }}>
              <Mono size={12} color={RAG.R.fg}>{err}</Mono>
            </div>
          )}
          {!loading && !err && items.length === 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 4, padding: "48px 0", textAlign: "center" }}>
              <Mono size={12} color={T.ink4}>No items match your filters.</Mono>
            </div>
          )}

          {/* Table */}
          {!loading && !err && items.length > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 4, overflow: "hidden" }}>
              <SectionRule label={`${items.length} work package${items.length !== 1 ? "s" : ""}`} />

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", minWidth: 900, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${T.hr}` }}>
                      {["Status", "Work Package", "Project ID", "Project", "Owner", "Due Date", "Flags"].map(h => (
                        <th key={h} style={{
                          padding: "12px 20px", textAlign: "left",
                          fontFamily: T.mono, fontSize: 9, fontWeight: 600,
                          letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink4,
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const rag    = rowRag(it);
                      const wp     = safeStr(it.title).trim() || "Work package";
                      const proj   = safeStr(it.project_title).trim() || "—";
                      const code   = it.project_code == null ? "" : String(it.project_code);
                      const owner  = safeStr(it.owner_label).trim();
                      const due    = ukDate(it.due_date);
                      const canOpen = !!(it.project_id && it.artifact_id);
                      const openHref = canOpen
                        ? `/projects/${it.project_id}/artifacts/${it.artifact_id}?focus=wbs&row=${encodeURIComponent(safeStr(it.wbs_row_id))}`
                        : null;

                      return (
                        <tr key={`${it.project_id}:${it.artifact_id}:${it.wbs_row_id}:${idx}`}
                          className="wbs-row"
                          style={{ borderBottom: `1px solid ${T.hr}`, background: T.surface }}
                        >
                          <td style={{ padding: "16px 20px" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ position: "relative", display: "inline-flex", width: 10, height: 10, alignItems: "center", justifyContent: "center" }}>
                                {rag === "R" && (
                                  <span style={{ position: "absolute", inset: -3, borderRadius: "50%", background: RAG.R.fg, opacity: 0.15 }} />
                                )}
                                <span style={{ width: 7, height: 7, borderRadius: "50%", background: rag === "N" ? T.ink5 : RAG[rag].fg, display: "inline-block" }} />
                              </span>
                            </div>
                          </td>

                          <td style={{ padding: "16px 20px" }}>
                            <div style={{ fontFamily: T.body, fontSize: 13, fontWeight: 600, color: T.ink, marginBottom: 4 }}>{wp}</div>
                            {openHref && (
                              <Link href={openHref} style={{
                                fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
                                textTransform: "uppercase", color: T.ink4, textDecoration: "none",
                              }}>Open →</Link>
                            )}
                          </td>

                          <td style={{ padding: "16px 20px" }}>
                            {code
                              ? <Mono size={11} color={T.ink2} weight={600}>{code}</Mono>
                              : <Mono size={11} color={T.ink5}>—</Mono>
                            }
                          </td>

                          <td style={{ padding: "16px 20px" }}>
                            <Mono size={12} color={T.ink2}>{proj}</Mono>
                          </td>

                          <td style={{ padding: "16px 20px" }}>
                            {owner
                              ? <Mono size={11} color={T.ink3}>{owner}</Mono>
                              : <Mono size={11} color={T.ink5}>—</Mono>
                            }
                          </td>

                          <td style={{ padding: "16px 20px" }}>
                            {due
                              ? <Mono size={11} color={rag === "R" ? RAG.R.fg : T.ink2} weight={rag === "R" ? 600 : 400}>{due}</Mono>
                              : <Mono size={11} color={T.ink5}>No date</Mono>
                            }
                          </td>

                          <td style={{ padding: "16px 20px" }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              <StatusChip rag={rag} />
                              {it.missing_effort && (
                                <span style={{
                                  fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em",
                                  textTransform: "uppercase", padding: "2px 7px", borderRadius: 2,
                                  background: RAG.A.bg, color: RAG.A.fg, border: `1px solid ${RAG.A.border}`,
                                }}>Missing Effort</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}