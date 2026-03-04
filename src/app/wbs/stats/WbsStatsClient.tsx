// src/app/wbs/stats/WbsStatsClient.tsx — RAID Intelligence style
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type WbsStats = {
  totalLeaves: number;
  done: number;
  remaining: number;
  overdue: number;
  due_7: number;
  due_14: number;
  due_30: number;
  due_60: number;
  missing_effort: number;
};

type BriefingResp = {
  ok: boolean;
  insights?: any[];
  meta?: { wbs_computed?: any } | null;
  error?: string;
};

export type DaysParam = 7 | 14 | 30 | 60 | "all";

const EMPTY: WbsStats = {
  totalLeaves: 0, done: 0, remaining: 0, overdue: 0,
  due_7: 0, due_14: 0, due_30: 0, due_60: 0, missing_effort: 0,
};

/* ─── Design tokens (RAID style) ───────────────────────────────────────────── */
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
  R: { fg: "#7f1d1d", bg: "#fef2f2", border: "#fca5a5", label: "CRITICAL" },
  A: { fg: "#78350f", bg: "#fffbeb", border: "#fcd34d", label: "ADVISORY" },
  G: { fg: "#14532d", bg: "#f0fdf4", border: "#86efac", label: "CLEAR"    },
  N: { fg: "#57534e", bg: "#fafaf9", border: "#e7e5e4", label: "—"        },
};

function asNum(x: any, fallback = 0) {
  const n = Number(x); return Number.isFinite(n) ? n : fallback;
}
function isPlainObject(x: any): x is Record<string, any> {
  if (!x || typeof x !== "object" || Array.isArray(x)) return false;
  return Object.getPrototypeOf(x) === Object.prototype;
}
export function normalizeWbsStats(raw: any): WbsStats | null {
  try {
    if (!isPlainObject(raw)) return null;
    const totalLeaves = asNum(raw.totalLeaves ?? raw.total_leaves ?? raw.total ?? 0);
    const done        = asNum(raw.done ?? raw.completed ?? 0);
    const remaining   = asNum(raw.remaining ?? raw.open ?? 0);
    const overdue     = asNum(raw.overdue ?? 0);
    const due_7       = asNum(raw.due_7 ?? raw.due7 ?? 0);
    const due_14      = asNum(raw.due_14 ?? raw.due14 ?? 0);
    const due_30      = asNum(raw.due_30 ?? raw.due30 ?? 0);
    const due_60      = asNum(raw.due_60 ?? raw.due60 ?? 0);
    const missing_effort = asNum(raw.missing_effort ?? raw.missingEffort ?? 0);
    if (!totalLeaves && !done && !remaining && !overdue && !due_7 && !due_14 && !due_30 && !due_60 && !missing_effort) return null;
    return { totalLeaves, done, remaining, overdue, due_7, due_14, due_30, due_60, missing_effort };
  } catch { return null; }
}
export function calcRemainingPct(stats: WbsStats) {
  if (!stats.totalLeaves) return 0;
  return Math.round((stats.remaining / stats.totalLeaves) * 100);
}

function buildItemsHref(days: DaysParam, params?: Record<string, any>) {
  const sp = new URLSearchParams();
  sp.set("days", String(days));
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean") { if (v) sp.set(k, "1"); continue; }
    sp.set(k, String(v));
  }
  return `/wbs/items?${sp.toString()}`;
}

function wbsRag(s: WbsStats): Rag {
  if (!s.totalLeaves) return "N";
  const overdueRate = s.overdue / Math.max(s.totalLeaves, 1);
  if (overdueRate > 0.25 || s.overdue > 5) return "R";
  if (overdueRate > 0.1 || s.overdue > 2) return "A";
  return "G";
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

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px",
      fontFamily: T.mono, fontSize: 10, fontWeight: active ? 600 : 400,
      letterSpacing: "0.07em", textTransform: "uppercase" as const,
      background: active ? T.ink : "transparent",
      color: active ? "#fff" : T.ink3,
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

function KpiTile({
  label, value, sub, rag = "N", href,
}: {
  label: string; value: number | string; sub?: string; rag?: Rag; href?: string;
}) {
  const ragCfg = RAG[rag];
  const inner = (
    <div style={{
      background: rag !== "N" ? ragCfg.bg : T.surface,
      border: `1px solid ${rag !== "N" ? ragCfg.border : T.hr}`,
      borderRadius: 4, padding: "22px 24px",
      transition: "box-shadow 0.15s ease",
      cursor: href ? "pointer" : "default",
    }}
      onMouseEnter={e => { if (href) (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 12px rgba(0,0,0,0.08)"; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <Cap>{label}</Cap>
        {rag !== "N" && (
          <span style={{
            fontFamily: T.mono, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em",
            textTransform: "uppercase", color: ragCfg.fg,
            background: ragCfg.bg, border: `1px solid ${ragCfg.border}`,
            borderRadius: 2, padding: "2px 6px",
          }}>{ragCfg.label}</span>
        )}
      </div>
      <div style={{
        fontFamily: T.serif, fontSize: 44, fontWeight: 700, lineHeight: 1,
        color: rag !== "N" ? ragCfg.fg : T.ink, marginBottom: 8,
      }}>{value}</div>
      {sub && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {href && <Mono size={9} color={T.ink4} upper>View items →</Mono>}
          {!href && <Mono size={9} color={T.ink4}>{sub}</Mono>}
        </div>
      )}
    </div>
  );
  if (!href) return inner;
  return <Link href={href} style={{ textDecoration: "none", display: "block" }}>{inner}</Link>;
}

export default function WbsStatsClient({ initialDays }: { initialDays: DaysParam }) {
  const router = useRouter();
  const [days, setDays] = useState<DaysParam>(initialDays);
  const [stats, setStats] = useState<WbsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [nowStr, setNowStr] = useState("");

  useEffect(() => {
    setNowStr(new Date().toLocaleString("en-GB", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    }).replace(",", ""));
  }, []);

  useEffect(() => {
    router.replace(`/wbs/stats?days=${encodeURIComponent(String(days))}`);
  }, [days]);

  useEffect(() => {
    const ac = new AbortController();
    (async () => {
      try {
        setLoading(true); setErr("");
        const r = await fetch(`/api/ai/briefing?days=${encodeURIComponent(String(days))}`, { cache: "no-store", signal: ac.signal });
        const j = (await r.json().catch(() => null)) as BriefingResp | null;
        if (!j) throw new Error("Failed to load WBS stats");
        if (!j.ok) throw new Error(j.error || "Failed to load WBS stats");
        setStats(normalizeWbsStats((j.meta as any)?.wbs_computed ?? {}));
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setErr(e?.message || "Failed to load WBS stats");
        setStats(null);
      } finally { setLoading(false); }
    })();
    return () => ac.abort();
  }, [days]);

  const s = stats ?? EMPTY;
  const hasData = stats !== null;
  const rag = wbsRag(s);
  const ragCfg = RAG[rag];
  const remainingPct = useMemo(() => calcRemainingPct(s), [s]);
  const completionPct = s.totalLeaves ? Math.round((s.done / s.totalLeaves) * 100) : 0;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap');
        @keyframes ragPulse { 0%,100%{opacity:.2} 50%{opacity:.45} }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.body }}>

        {/* ── Header bar ── */}
        <div style={{
          background: T.ink, borderBottom: `1px solid #292524`,
          padding: "0 40px",
        }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Mono size={10} color="#a8a29e" upper weight={600}>WBS Intelligence</Mono>
              <span style={{ color: "#44403c", fontSize: 10 }}>·</span>
              <Mono size={10} color="#78716c">Work Package Delivery</Mono>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              {nowStr && <Mono size={9} color="#57534e">Updated {nowStr}</Mono>}
              <Link href={buildItemsHref(days)} style={{
                fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em",
                textTransform: "uppercase", color: "#a8a29e", textDecoration: "none",
                padding: "4px 12px", border: "1px solid #292524", borderRadius: 2,
              }}>View Items →</Link>
            </div>
          </div>
        </div>

        {/* ── KPI strip ── */}
        <div style={{ borderBottom: `1px solid ${T.hr}`, background: T.surface }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex" }}>
            {[
              { label: "Total Work Packages", value: loading ? "…" : s.totalLeaves, sub: "leaf nodes" },
              { label: "Completed", value: loading ? "…" : s.done, sub: `${completionPct}% done` },
              { label: "Remaining", value: loading ? "…" : s.remaining, sub: `${remainingPct}% open` },
              { label: "Overdue", value: loading ? "…" : s.overdue, sub: "past due date", rag: hasData && s.overdue > 0 ? (rag === "R" ? "R" : "A") as Rag : "N" as Rag },
              { label: "Missing Effort", value: loading ? "…" : s.missing_effort, sub: "no estimate", rag: hasData && s.missing_effort > 0 ? "A" as Rag : "N" as Rag },
            ].map((cell, i, arr) => (
              <div key={cell.label} style={{
                padding: "24px 32px", flex: 1,
                borderRight: i < arr.length - 1 ? `1px solid ${T.hr}` : "none",
              }}>
                <Cap>{cell.label}</Cap>
                <div style={{
                  fontFamily: T.serif, fontSize: 40, fontWeight: 700, lineHeight: 1,
                  marginTop: 10, marginBottom: 6,
                  color: (cell as any).rag && (cell as any).rag !== "N" ? RAG[(cell as any).rag as Rag].fg : T.ink,
                }}>{cell.value}</div>
                <Cap>{cell.sub}</Cap>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main content ── */}
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "40px 40px" }}>

          {/* Window pills */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 32 }}>
            <div style={{ display: "flex", gap: 6 }}>
              {(["all", 7, 14, 30, 60] as const).map((d) => (
                <Pill key={String(d)} label={d === "all" ? "All" : `${d}d`} active={days === d} onClick={() => setDays(d as DaysParam)} />
              ))}
            </div>
            {loading && <Mono size={10} color={T.ink4}>Loading…</Mono>}
            {err && <Mono size={10} color={RAG.R.fg}>{err}</Mono>}
          </div>

          {/* RAG Intelligence summary */}
          {hasData && (
            <div style={{
              background: ragCfg.bg, border: `1px solid ${ragCfg.border}`,
              borderRadius: 4, padding: "20px 28px", marginBottom: 32,
              display: "flex", alignItems: "flex-start", gap: 16,
            }}>
              <div style={{ marginTop: 2 }}>
                <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 12, height: 12 }}>
                  {rag === "R" && (
                    <span style={{ position: "absolute", inset: -3, borderRadius: "50%", background: ragCfg.fg, opacity: 0.2, animation: "ragPulse 2.2s ease-in-out infinite" }} />
                  )}
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: ragCfg.fg, display: "inline-block" }} />
                </span>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <Cap>WBS Intelligence Summary</Cap>
                  <span style={{
                    fontFamily: T.mono, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: ragCfg.fg, background: "rgba(255,255,255,0.6)", border: `1px solid ${ragCfg.border}`,
                    borderRadius: 2, padding: "2px 6px",
                  }}>{ragCfg.label}</span>
                </div>
                <div style={{ fontFamily: T.body, fontSize: 14, color: T.ink2, lineHeight: 1.6 }}>
                  {s.totalLeaves === 0
                    ? "No work packages found for this selection."
                    : `${s.done} of ${s.totalLeaves} work packages completed (${completionPct}%). ${s.remaining} remaining — ${remainingPct}% of portfolio still open.`
                  }
                  {s.overdue > 0 && ` ⚠ ${s.overdue} item${s.overdue > 1 ? "s" : ""} are overdue and require immediate attention.`}
                  {s.missing_effort > 0 && ` ${s.missing_effort} work package${s.missing_effort > 1 ? "s" : ""} missing effort estimates.`}
                </div>
              </div>
            </div>
          )}

          {/* Due-date breakdown */}
          <SectionRule label="Schedule Horizon" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
            <KpiTile label="Due in 7 days"  value={s.due_7}  rag={s.due_7 > 3 ? "R" : s.due_7 > 0 ? "A" : "N"}  href={buildItemsHref(days, { bucket: "due_7" })} />
            <KpiTile label="Due in 14 days" value={s.due_14} rag={s.due_14 > 5 ? "A" : "N"} href={buildItemsHref(days, { bucket: "due_14" })} />
            <KpiTile label="Due in 30 days" value={s.due_30} rag="N" href={buildItemsHref(days, { bucket: "due_30" })} />
            <KpiTile label="Due in 60 days" value={s.due_60} rag="N" href={buildItemsHref(days, { bucket: "due_60" })} />
          </div>

          {/* Status breakdown */}
          <SectionRule label="Delivery Status" />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
            <KpiTile label="Overdue"        value={s.overdue}        rag={s.overdue > 5 ? "R" : s.overdue > 0 ? "A" : "G"} href={buildItemsHref(days, { bucket: "overdue" })} />
            <KpiTile label="Missing Effort" value={s.missing_effort} rag={s.missing_effort > 0 ? "A" : "N"} href={buildItemsHref(days, { missingEffort: 1 })} />
            <KpiTile label="Completed"      value={s.done}           rag={completionPct >= 80 ? "G" : completionPct >= 50 ? "A" : "N"} href={buildItemsHref(days, { status: "done" })} />
          </div>

          {/* Delivery pulse bar */}
          {hasData && s.totalLeaves > 0 && (
            <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 4, padding: "24px 28px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <Cap>Delivery Pulse</Cap>
                <Mono size={10} color={T.ink4}>{s.done} done · {s.remaining} remaining · {completionPct}% complete</Mono>
              </div>
              <div style={{ height: 6, background: T.hr, borderRadius: 3, overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 3,
                  background: completionPct >= 80 ? RAG.G.fg : completionPct >= 50 ? "#d97706" : RAG.R.fg,
                  width: `${completionPct}%`, transition: "width 1s cubic-bezier(0.16,1,0.3,1)",
                }} />
              </div>
              <div style={{ display: "flex", marginTop: 16 }}>
                <Link href={buildItemsHref(days)} style={{
                  fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.07em",
                  textTransform: "uppercase", color: T.ink3, textDecoration: "none",
                  padding: "6px 14px", border: `1px solid ${T.hr}`, borderRadius: 2,
                }}>View All Items →</Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
