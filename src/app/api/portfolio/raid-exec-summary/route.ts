// src/app/api/portfolio/raid-exec-summary/route.ts — REBUILT v2
// Fixes:
//   ✅ FIX-RES1: Active project filter added to buildExecSummary
//               was: raw project_members join, no status/deleted_at filter
//               → closed/deleted projects appeared in executive PDF/PPTX
//               now: calls filterActiveProjectIds before querying RAID data
//   ✅ FIX-RES2: TypeScript bug in resolveClientNameFromProjects
//               was: .select("id, client_name as string | null | undefined") — invalid syntax
//               → silently selected nothing or threw at runtime
//               now: .select("id, client_name") — plain column name

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";

// Puppeteer / Chromium
import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

export const runtime = "nodejs";
export const maxDuration = 60;

/* ---------------- branding ---------------- */

const BRAND_LOGO_URL =
  "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png ";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200, headers?: HeadersInit) {
  return NextResponse.json({ ok: true, ...data }, { status, headers });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

/* ---------------- utils ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

function clampDays(x: any) {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

function clampScope(x: any) {
  const v = safeStr(x).trim().toLowerCase();
  return v === "all" || v === "overdue" || v === "window" ? v : "window";
}

function clampFormat(x: any) {
  const v = safeStr(x).trim().toLowerCase();
  if (v === "pdf") return "pdf";
  if (v === "md") return "md";
  if (v === "pptx") return "pptx";
  return "pdf";
}

function n(x: any, fallback: number | null = null) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function clamp01to100(v: any) {
  const x = Number(v);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function moneyGBP(x: any) {
  const v = Number(x || 0);
  if (!Number.isFinite(v)) return "—";
  return "£" + Math.round(v).toLocaleString("en-GB");
}

function fmtUkDateTime(x: any) {
  if (!x) return "—";
  const d = new Date(String(x));
  if (Number.isNaN(d.getTime())) return safeStr(x) || "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtUkDate(x: any) {
  if (!x) return "—";
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return safeStr(x) || "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function isoDateUTC(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeFilename(name: string) {
  return String(name || "portfolio_raid_brief")
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

/* ---------------- types ---------------- */

type ExecItem = {
  id: string;
  project_id?: string | null;
  project_title?: string | null;
  type?: string | null;
  title?: string | null;
  score?: number | null;
  due_date?: string | null;
  owner_label?: string | null;
  sla_breach_probability?: number | null;
  sla_days_to_breach?: number | null;
  sla_confidence?: number | null;
  exposure_total?: number | null;
  exposure_total_fmt?: string | null;
  overdue?: boolean | null;
  note?: string | null;
  prompt?: string | null;
  href?: string | null;
};

type ExecSection = { key: string; title: string; items: ExecItem[] };

type ExecSummary = {
  ok: true;
  org_name?: string | null;
  client_name?: string | null;
  scope: string;
  days: number;
  top: number;
  summary: { headline: string; generated_at: string };
  kpis: {
    total_items: number;
    overdue_open: number;
    high_score: number;
    sla_hot: number;
    exposure_total: number;
    exposure_total_fmt?: string;
  };
  wow?: { week_start?: string | null; prev_week_start?: string | null; narrative?: string[] } | null;
  sections: ExecSection[];
};

/* ---------------- data helpers ---------------- */

async function resolveOrgName(supabase: any, userId: string) {
  try {
    const { data, error } = await supabase
      .from("organisation_members")
      .select("organisation_id, organisations:organisations(id,name)")
      .eq("user_id", userId)
      .is("removed_at", null)
      .limit(5);

    if (error) return null;

    const row = (data || [])[0] as any;
    const name = row?.organisations?.name ?? null;
    return typeof name === "string" && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

// ✅ FIX-RES2: Fixed .select() — removed invalid TypeScript cast in column selector
async function resolveClientNameFromProjects(supabase: any, projectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, client_name")   // ✅ was: "id, client_name as string | null | undefined" — invalid
      .in("id", projectIds)
      .limit(2000);

    if (error) return null;

    const names = (data || [])
      .map((p: any) => safeStr(p?.client_name).trim())
      .filter(Boolean);

    if (!names.length) return null;

    const set = new Set(names);
    if (set.size === 1) return Array.from(set)[0];
    return "Multiple clients";
  } catch {
    return null;
  }
}

async function buildExecSummary(args: {
  supabase: any;
  userId: string;
  scope: string;
  days: number;
  top: number;
}): Promise<ExecSummary | { ok: false; error: string }> {
  const { supabase, userId, scope, days, top } = args;

  // accessible projects (membership)
  const { data: memberships, error: memErr } = await supabase
    .from("project_members")
    .select("project_id, removed_at")
    .eq("user_id", userId)
    .is("removed_at", null);

  if (memErr) return { ok: false, error: memErr.message };

  const rawProjectIds = (memberships || [])
    .map((m: any) => m.project_id)
    .filter(Boolean) as string[];

  if (!rawProjectIds.length) return { ok: false, error: "No accessible projects found." };

  // ✅ FIX-RES1: Filter to active projects only — excludes closed/deleted from exec report
  const activeFilter = await filterActiveProjectIds(supabase, rawProjectIds);
  const projectIds = activeFilter.projectIds;

  if (!projectIds.length) return { ok: false, error: "No active projects found." };

  // header context
  const [dbOrg, dbClient] = await Promise.all([
    resolveOrgName(supabase, userId),
    resolveClientNameFromProjects(supabase, projectIds),
  ]);

  const org_name = dbOrg || safeStr(process.env.ORG_NAME || process.env.NEXT_PUBLIC_ORG_NAME).trim() || null;
  const client_name = (dbClient || null) as string | null;

  // window dates
  const today = new Date();
  const todayStr = isoDateUTC(today);
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
  const toStr = isoDateUTC(to);

  let raidQ = supabase
    .from("raid_items")
    .select(`
      id,
      project_id,
      type,
      title,
      description,
      status,
      priority,
      probability,
      severity,
      due_date,
      owner_label,
      ai_rollup,
      projects:projects ( id, title )
    `)
    .in("project_id", projectIds);

  if (scope === "window") {
    raidQ = raidQ.gte("due_date", todayStr).lte("due_date", toStr);
  } else if (scope === "overdue") {
    raidQ = raidQ.lt("due_date", todayStr);
    raidQ = raidQ.not("status", "ilike", "closed");
    raidQ = raidQ.not("status", "ilike", "invalid");
  }

  const { data: raidRows, error: raidErr } = await raidQ.limit(5000);
  if (raidErr) return { ok: false, error: raidErr.message };

  const rows = raidRows || [];
  const raidItemIds = rows.map((r: any) => r.id).filter(Boolean);

  // Latest AI scores
  const scoreByItem = new Map<string, any>();
  if (raidItemIds.length) {
    const { data: scores } = await supabase
      .from("raid_item_scores")
      .select("raid_item_id, score, components, model_version, scored_at")
      .in("raid_item_id", raidItemIds)
      .order("scored_at", { ascending: false })
      .limit(10000);

    for (const s of scores || []) {
      const id = String((s as any).raid_item_id || "");
      if (id && !scoreByItem.has(id)) scoreByItem.set(id, s);
    }
  }

  // Latest SLA predictions
  const predByItem = new Map<string, any>();
  if (raidItemIds.length) {
    const { data: preds } = await supabase
      .from("raid_sla_predictions")
      .select("raid_item_id, breach_probability, days_to_breach, confidence, drivers, model_version, predicted_at")
      .in("raid_item_id", raidItemIds)
      .order("predicted_at", { ascending: false })
      .limit(10000);

    for (const p of preds || []) {
      const id = String((p as any).raid_item_id || "");
      if (id && !predByItem.has(id)) predByItem.set(id, p);
    }
  }

  // Financials
  const finByItem = new Map<string, any>();
  if (raidItemIds.length) {
    const { data: fins } = await supabase
      .from("raid_financials")
      .select("raid_item_id, currency, est_cost_impact, est_schedule_days, est_revenue_at_risk, est_penalties, updated_at")
      .in("raid_item_id", raidItemIds)
      .limit(10000);

    for (const f of fins || []) {
      const id = String((f as any).raid_item_id || "");
      if (id) finByItem.set(id, f);
    }
  }

  const enriched: ExecItem[] = rows.map((r: any) => {
    const due = r?.due_date ? String(r.due_date).slice(0, 10) : null;
    const st = String(r?.status || "").toLowerCase();
    const overdue = Boolean(due && due < todayStr && !["closed", "invalid"].includes(st));

    const p = clamp01to100(r?.probability);
    const s = clamp01to100(r?.severity);
    const basicScore = r?.probability == null || r?.severity == null ? null : Math.round((p * s) / 100);

    const aiScore = scoreByItem.get(r.id) || null;
    const pred = predByItem.get(r.id) || null;
    const fin = finByItem.get(r.id) || null;

    const score = aiScore?.score ?? basicScore ?? null;

    const cost = fin?.est_cost_impact ?? 0;
    const rev = fin?.est_revenue_at_risk ?? 0;
    const pen = fin?.est_penalties ?? 0;
    const exposure_total = (n(cost, 0) || 0) + (n(rev, 0) || 0) + (n(pen, 0) || 0);
    const exposure_total_fmt = exposure_total > 0 ? moneyGBP(exposure_total) : null;

    return {
      id: String(r.id),
      project_id: r.project_id,
      project_title: r?.projects?.title || "Project",
      type: r.type || null,
      title: r.title || r.description?.slice(0, 120) || "RAID item",
      due_date: due,
      owner_label: r.owner_label || "",
      score,
      sla_breach_probability: pred?.breach_probability ?? null,
      sla_days_to_breach: pred?.days_to_breach ?? null,
      sla_confidence: pred?.confidence ?? null,
      exposure_total,
      exposure_total_fmt,
      overdue,
      note: r.ai_rollup ? String(r.ai_rollup).slice(0, 240) : null,
      href: `/projects/${r.project_id}/raid`,
    };
  });

  const total_items = enriched.length;
  const overdue_open = enriched.filter((x) => x.overdue).length;
  const high_score = enriched.filter((x) => (n(x.score, 0) || 0) >= 70).length;
  const sla_hot = enriched.filter((x) => {
    const bp = n(x.sla_breach_probability, -1) ?? -1;
    const dtb = x.sla_days_to_breach == null ? null : n(x.sla_days_to_breach, null);
    return bp >= 70 || (dtb != null && dtb <= 7);
  }).length;
  const exposure_total = enriched.reduce((acc, x) => acc + (n(x.exposure_total, 0) || 0), 0);

  const headline =
    total_items === 0
      ? "No RAID items match the selected horizon."
      : overdue_open > 0 || high_score > 0 || sla_hot > 0
      ? `Priority focus: ${overdue_open} overdue, ${high_score} high-scoring, ${sla_hot} SLA-hot item(s) within the next ${days} days.`
      : `Stable window: ${total_items} item(s) reviewed with no critical flags for the next ${days} days.`;

  const byScore = [...enriched]
    .filter((x) => x.score != null)
    .sort((a, b) => (n(b.score, 0) || 0) - (n(a.score, 0) || 0))
    .slice(0, top);

  const bySla = [...enriched]
    .filter((x) => x.sla_breach_probability != null || x.sla_days_to_breach != null)
    .sort((a, b) => {
      const abp = n(a.sla_breach_probability, -1) ?? -1;
      const bbp = n(b.sla_breach_probability, -1) ?? -1;
      if (bbp !== abp) return bbp - abp;
      const ad = a.sla_days_to_breach == null ? 9999 : (n(a.sla_days_to_breach, 9999) as number);
      const bd = b.sla_days_to_breach == null ? 9999 : (n(b.sla_days_to_breach, 9999) as number);
      return ad - bd;
    })
    .slice(0, top)
    .map((x) => ({
      ...x,
      note:
        x.sla_breach_probability != null
          ? `SLA breach probability ${x.sla_breach_probability}%${
              x.sla_days_to_breach != null ? ` • ~${x.sla_days_to_breach} day(s)` : ""
            }.`
          : x.note,
    }));

  const byExposure = [...enriched]
    .filter((x) => (n(x.exposure_total, 0) || 0) > 0)
    .sort((a, b) => (n(b.exposure_total, 0) || 0) - (n(a.exposure_total, 0) || 0))
    .slice(0, top)
    .map((x) => ({ ...x, note: `Exposure ${x.exposure_total_fmt || "—"} (cost + revenue risk + penalties).` }));

  const decisions = [...enriched]
    .filter((x) => x.overdue || (x.due_date && x.due_date <= toStr))
    .sort((a, b) => {
      if (a.overdue && !b.overdue) return -1;
      if (!a.overdue && b.overdue) return 1;
      const ad = a.due_date || "9999-12-31";
      const bd = b.due_date || "9999-12-31";
      return ad.localeCompare(bd);
    })
    .slice(0, top)
    .map((x) => ({
      ...x,
      prompt: x.overdue
        ? `Confirm owner/action plan and rebaseline due date.`
        : `Confirm mitigation and next update before ${x.due_date}.`,
    }));

  // optional WoW snapshots
  let wow: ExecSummary["wow"] = null;
  try {
    const { data: snaps, error: snapErr } = await supabase
      .from("raid_weekly_snapshots")
      .select("project_id, week_start, snapshot")
      .in("project_id", projectIds)
      .order("week_start", { ascending: false })
      .limit(10000);

    if (!snapErr && (snaps || []).length) {
      const byWeek = new Map<string, { total_items: number; overdue_open: number; high_score: number; sla_hot: number; exposure_total: number }>();

      for (const row of snaps || []) {
        const wk = String((row as any).week_start || "").slice(0, 10);
        if (!wk) continue;
        const snap = (row as any).snapshot || {};
        const agg = byWeek.get(wk) || { total_items: 0, overdue_open: 0, high_score: 0, sla_hot: 0, exposure_total: 0 };
        agg.total_items += n(snap.total_items, 0) || 0;
        agg.overdue_open += n(snap.overdue_open, 0) || 0;
        agg.high_score += n(snap.high_score, 0) || 0;
        agg.sla_hot += n(snap.sla_hot, 0) || 0;
        agg.exposure_total += n(snap.exposure_total, 0) || 0;
        byWeek.set(wk, agg);
      }

      const weeks = Array.from(byWeek.keys()).sort().reverse();
      const week_start = weeks[0] || null;
      const prev_week_start = weeks[1] || null;

      if (week_start && prev_week_start) {
        const cur = byWeek.get(week_start)!;
        const prev = byWeek.get(prev_week_start)!;
        const deltas = {
          overdue_open: cur.overdue_open - prev.overdue_open,
          high_score: cur.high_score - prev.high_score,
          sla_hot: cur.sla_hot - prev.sla_hot,
          exposure_total: cur.exposure_total - prev.exposure_total,
        };
        const sign = (d: number) => (d > 0 ? "↑" : d < 0 ? "↓" : "→");
        wow = {
          week_start,
          prev_week_start,
          narrative: [
            `${sign(deltas.overdue_open)} Overdue: ${cur.overdue_open} (${deltas.overdue_open >= 0 ? "+" : ""}${deltas.overdue_open} WoW)`,
            `${sign(deltas.high_score)} High score: ${cur.high_score} (${deltas.high_score >= 0 ? "+" : ""}${deltas.high_score} WoW)`,
            `${sign(deltas.sla_hot)} SLA hot: ${cur.sla_hot} (${deltas.sla_hot >= 0 ? "+" : ""}${deltas.sla_hot} WoW)`,
            `${sign(deltas.exposure_total)} Exposure: ${moneyGBP(cur.exposure_total)} (${deltas.exposure_total >= 0 ? "+" : ""}${moneyGBP(deltas.exposure_total)})`,
          ],
        };
      } else {
        wow = { week_start: week_start || null, prev_week_start: null, narrative: [] };
      }
    }
  } catch {
    wow = null;
  }

  return {
    ok: true,
    org_name,
    client_name,
    scope,
    days,
    top,
    summary: { headline, generated_at: new Date().toISOString() },
    kpis: {
      total_items,
      overdue_open,
      high_score,
      sla_hot,
      exposure_total,
      exposure_total_fmt: moneyGBP(exposure_total),
    },
    wow,
    sections: [
      { key: "top_score", title: "Top Risks by Score", items: byScore },
      { key: "sla_hot", title: "SLA Breach Watchlist", items: bySla },
      { key: "exposure", title: "Financial Exposure Hotspots", items: byExposure },
      { key: "decisions", title: "Decisions Required (Next Actions)", items: decisions },
    ],
  };
}

/* ---------------- HTML renderer (PDF) — unchanged from original ---------------- */

function esc(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderPdfHtml(summary: ExecSummary) {
  const gen = fmtUkDateTime(summary.summary.generated_at);
  const clientPrimary = summary.client_name ? summary.client_name : "—";
  const orgSecondary = summary.org_name ? summary.org_name : "—";

  const logoUrl =
    safeStr(process.env.BRANDING_LOGO_URL || process.env.NEXT_PUBLIC_BRANDING_LOGO_URL).trim() || BRAND_LOGO_URL;

  const k = summary.kpis;
  const wow = summary.wow;

  const wowBlock =
    wow && wow.prev_week_start
      ? `<div class="card soft"><div class="card-title-row"><div class="card-title">Week-on-week</div><div class="muted">${esc(fmtUkDate(wow.week_start))} vs ${esc(fmtUkDate(wow.prev_week_start))}</div></div><div class="list">${(wow.narrative || []).map((t) => `<div class="li">• ${esc(t)}</div>`).join("") || `<div class="muted">No narrative.</div>`}</div></div>`
      : `<div class="card soft"><div class="muted">Week-on-week will appear after at least <b>2 weekly snapshots</b> exist.</div></div>`;

  const sections = summary.sections.map((sec) => {
    const items = sec.items || [];
    const rows = items.length === 0
      ? `<div class="empty">No items in this section.</div>`
      : items.map((x) => {
          const due = x.due_date ? fmtUkDate(x.due_date) : "—";
          const overdue = Boolean(x.overdue);
          const sc = x.score == null ? null : Number(x.score);
          const bp = x.sla_breach_probability == null ? null : Number(x.sla_breach_probability);
          const hot = (bp != null && bp >= 70) || (sc != null && sc >= 70) || overdue;
          const pills: string[] = [];
          pills.push(`<span class="pill ${overdue ? "pill-danger" : "pill-neutral"}">Due: ${esc(due)}</span>`);
          if (sc != null) pills.push(`<span class="pill ${hot && sc >= 70 ? "pill-warn" : "pill-neutral"}">Score: ${esc(sc)}</span>`);
          if (bp != null) { const dtb = x.sla_days_to_breach != null ? ` • ~${esc(x.sla_days_to_breach)}d` : ""; const conf = x.sla_confidence != null ? ` • ${esc(x.sla_confidence)}%` : ""; pills.push(`<span class="pill ${bp >= 70 ? "pill-warn" : "pill-neutral"}">SLA: ${esc(bp)}%${dtb}${conf}</span>`); }
          if (x.exposure_total_fmt) pills.push(`<span class="pill pill-neutral">Exposure: ${esc(x.exposure_total_fmt)}</span>`);
          if (x.owner_label) pills.push(`<span class="pill pill-neutral">Owner: ${esc(x.owner_label)}</span>`);
          const note = x.note || x.prompt ? `<div class="note">${esc(x.note || x.prompt)}</div>` : "";
          return `<div class="item"><div class="item-meta">${esc(x.project_title || "Project")} • ${esc(x.type || "RAID")}</div><div class="item-title">${esc(x.title || "Untitled")}</div><div class="pills">${pills.join("")}</div>${note}</div>`;
        }).join("");
    return `<div class="card"><div class="card-title-row"><div class="card-title">${esc(sec.title)}</div><div class="muted">${items.length} item(s)</div></div><div class="items">${rows}</div></div>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"/><title>Portfolio RAID Brief</title><style>:root{--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--card:#ffffff;--soft:#f8fafc;--warn:#f59e0b;--danger:#ef4444;--brand:#0b1220}*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--ink);background:#fff}.page{padding:24px 28px 28px}.header{border:1px solid var(--line);border-radius:18px;padding:18px 18px 16px;background:linear-gradient(180deg,#ffffff 0%,#fbfdff 100%)}.brandrow{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:10px}.brandleft{display:flex;align-items:center;gap:12px;min-width:0}.logo{width:44px;height:44px;border-radius:12px;border:1px solid var(--line);background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.logo img{width:100%;height:100%;object-fit:contain;display:block}.wordmark{font-weight:900;letter-spacing:0.12em;font-size:13px;color:var(--brand);text-transform:uppercase}.clientname{font-size:14px;font-weight:900;color:var(--brand);line-height:1.15}.orgline{margin-top:2px;font-size:12px;color:#334155}.orgline b{font-weight:800}.kicker{font-size:12px;color:var(--muted)}.title{margin-top:6px;font-size:24px;font-weight:900;letter-spacing:-0.02em}.headline{margin-top:10px;font-size:14px;color:#334155;line-height:1.45}.gen{margin-top:6px;font-size:12px;color:var(--muted)}.chips{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}.chip{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:700;white-space:nowrap}.chip.warn{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.10)}.chip.danger{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.10)}.grid{margin-top:14px;display:grid;gap:14px}.card{border:1px solid var(--line);border-radius:16px;padding:16px;background:var(--card)}.card.soft{background:var(--soft)}.card-title-row{display:flex;justify-content:space-between;align-items:flex-end;gap:10px}.card-title{font-size:14px;font-weight:900;letter-spacing:-0.01em}.muted{color:var(--muted);font-size:12px}.items{margin-top:12px;display:flex;flex-direction:column;gap:10px}.item{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}.item-meta{font-size:12px;color:var(--muted)}.item-title{margin-top:6px;font-size:14px;font-weight:900;color:#0b1220}.pills{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px}.pill{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:700}.pill-warn{border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.10)}.pill-danger{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.10)}.note{margin-top:10px;font-size:12px;color:#334155;line-height:1.45}.empty{margin-top:10px;font-size:12px;color:var(--muted);padding:10px 12px;border:1px dashed #cbd5e1;border-radius:12px;background:#fff}.list{margin-top:10px}.li{font-size:12px;color:#334155;margin:6px 0}.footer{margin-top:14px;font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:10px;border-top:1px solid var(--line);padding-top:10px}@page{size:A4;margin:12mm}</style></head><body><div class="page"><div class="header"><div class="brandrow"><div class="brandleft"><div class="logo">${logoUrl ? `<img src="${esc(logoUrl)}" alt="Logo"/>` : `<div class="wordmark">ΛLIENΛ</div>`}</div><div><div class="clientname">${esc(clientPrimary)}</div><div class="orgline"><b>Organisation:</b> ${esc(orgSecondary)}</div></div></div><div class="kicker">Executive Summary • next ${esc(summary.days)} days • scope: ${esc(summary.scope)}</div></div><div class="title">Portfolio RAID Brief</div><div class="headline">${esc(summary.summary.headline)}</div><div class="gen">Generated: ${esc(gen)}</div><div class="chips"><span class="chip">Total: ${esc(k.total_items)}</span><span class="chip ${k.overdue_open ? "danger" : ""}">Overdue: ${esc(k.overdue_open)}</span><span class="chip ${k.high_score ? "warn" : ""}">High score: ${esc(k.high_score)}</span><span class="chip ${k.sla_hot ? "warn" : ""}">SLA hot: ${esc(k.sla_hot)}</span><span class="chip ${k.exposure_total ? "warn" : ""}">Exposure: ${esc(k.exposure_total_fmt || "—")}</span></div></div><div class="grid">${wowBlock}${sections}</div><div class="footer"><div>Aliena AI • Portfolio Insights</div><div>${esc(fmtUkDateTime(new Date().toISOString()))}</div></div></div></body></html>`;
}

/* ---------------- puppeteer (chromium) — unchanged ---------------- */

async function renderPdfFromHtml(html: string) {
  const isProd = process.env.NODE_ENV === "production";
  const executablePath = isProd ? await chromium.executablePath() : undefined;

  const browser = await (isProd ? puppeteerCore : puppeteer).launch({
    args: isProd ? chromium.args : ["--no-sandbox", "--disable-setuid-sandbox"],
    executablePath,
    headless: true,
  } as any);

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setCacheEnabled(false);
    await page.setContent(html, { waitUntil: ["domcontentloaded", "networkidle0"] });
    await page.evaluateHandle("document.fonts && document.fonts.ready");
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
    });
    return pdf;
  } finally {
    await browser.close();
  }
}

/* ---------------- PPTX renderer — unchanged from original ---------------- */

async function fetchAsDataUri(url: string, fallbackMime = "image/png"): Promise<string | null> {
  try {
    const res = await fetch(url, { cache: "no-store" as any });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    const ct = safeStr(res.headers.get("content-type")).trim().toLowerCase();
    const mime = ct && ct.includes("/") ? ct : fallbackMime;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function fmtUKShortDate(d: any) {
  if (!d) return "—";
  const s = String(d).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const dt = new Date(String(d));
  if (Number.isNaN(dt.getTime())) return s;
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function priorityFromScore(score: any) {
  const v = Number(score);
  if (!Number.isFinite(v)) return { label: "Info", kind: "neutral" as const };
  if (v >= 70) return { label: "High Priority", kind: "danger" as const };
  if (v >= 40) return { label: "Medium Priority", kind: "warn" as const };
  return { label: "Low Priority", kind: "neutral" as const };
}

async function renderPptxFromSummary(summary: ExecSummary) {
  const mod = await import("pptxgenjs");
  const PptxGenJS = (mod as any).default || (mod as any);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const SLIDE_W = 13.333;
  const SLIDE_H = 7.5;
  const C = { bg: "F8FAFC", grid: "E5E7EB", card: "FFFFFF", border: "E5E7EB", text: "0F172A", muted: "64748B", teal: "14B8A6", indigo: "6366F1", warn: "F59E0B", danger: "EF4444", pillBg: "F1F5F9" };
  const safe = (x: any) => (x == null ? "" : String(x));
  const nn = (x: any, fb = 0) => (Number.isFinite(Number(x)) ? Number(x) : fb);
  const topScoreSec = (summary.sections || []).find((s) => s.key === "top_score") || (summary.sections || [])[0];
  const featured = topScoreSec?.items?.[0] || null;
  const featuredScore = featured?.score ?? null;
  const pr = priorityFromScore(featuredScore);
  const client = summary.client_name || "Client";
  const org = summary.org_name || "My Organisation";
  const windowLabel = `Next ${summary.days} Days`;
  const genStamp = summary.summary?.generated_at ? new Date(summary.summary.generated_at) : new Date();
  const genText = genStamp.toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const k = summary.kpis || ({} as any);
  const kTotal = nn(k.total_items, 0);
  const kOverdue = nn(k.overdue_open, 0);
  const kHigh = nn(k.high_score, 0);
  const kSla = nn(k.sla_hot, 0);
  const kExposureFmt = safe(k.exposure_total_fmt || "—");
  const logoUrl = safeStr(process.env.BRANDING_LOGO_URL || process.env.NEXT_PUBLIC_BRANDING_LOGO_URL).trim() || BRAND_LOGO_URL;
  const logoDataUri = await fetchAsDataUri(logoUrl);
  const slide = pptx.addSlide();
  slide.addShape("rect", { x: 0, y: 0, w: SLIDE_W, h: SLIDE_H, fill: { color: C.bg } });
  const gridStep = 0.55;
  for (let x = 0; x <= SLIDE_W; x += gridStep) slide.addShape("line", { x, y: 0, w: 0, h: SLIDE_H, line: { color: C.grid, width: 0.5, transparency: 80 } });
  for (let y = 0; y <= SLIDE_H; y += gridStep) slide.addShape("line", { x: 0, y, w: SLIDE_W, h: 0, line: { color: C.grid, width: 0.5, transparency: 80 } });
  const addCard = (x: number, y: number, w: number, h: number, opts?: { fill?: string; border?: string }) => { slide.addShape("roundRect", { x, y, w, h, fill: { color: opts?.fill || C.card }, line: { color: opts?.border || C.border, width: 1 } }); };
  const addPill = (x: number, y: number, w: number, h: number, text: string, kind: "neutral" | "warn" | "danger") => { const fill = kind === "warn" ? "FFF7ED" : kind === "danger" ? "FEF2F2" : C.pillBg; const line = kind === "warn" ? "FED7AA" : kind === "danger" ? "FECACA" : C.border; const color = kind === "warn" ? "92400E" : kind === "danger" ? "991B1B" : C.muted; slide.addShape("roundRect", { x, y, w, h, fill: { color: fill }, line: { color: line, width: 1 } }); slide.addText(text, { x, y: y + 0.08, w, h, fontSize: 11, color, align: "center", valign: "mid", bold: true }); };
  const margin = 0.55, gutter = 0.35, leftX = margin, rightX = 6.95, topY = margin, leftW = 6.05, rightW = SLIDE_W - rightX - margin;
  const logoBoxX = leftX, logoBoxY = topY, logoBoxW = 0.62, logoBoxH = 0.62;
  slide.addShape("roundRect", { x: logoBoxX, y: logoBoxY, w: logoBoxW, h: logoBoxH, fill: { color: "FFFFFF" }, line: { color: C.border, width: 1 } });
  if (logoDataUri) { slide.addImage({ data: logoDataUri, x: logoBoxX + 0.07, y: logoBoxY + 0.07, w: logoBoxW - 0.14, h: logoBoxH - 0.14 }); } else { slide.addShape("roundRect", { x: logoBoxX, y: logoBoxY, w: logoBoxW, h: logoBoxH, fill: { color: C.indigo }, line: { color: C.indigo, width: 1 } }); slide.addText("A", { x: logoBoxX, y: logoBoxY + 0.06, w: logoBoxW, h: logoBoxH, fontSize: 18, color: "FFFFFF", bold: true, align: "center", valign: "mid" }); }
  slide.addText("Portfolio RAID Brief", { x: leftX + 0.75, y: topY - 0.02, w: 5.0, h: 0.4, fontSize: 20, bold: true, color: C.text });
  slide.addText(`${org}  •  ${client}`, { x: leftX + 0.75, y: topY + 0.33, w: 5.5, h: 0.3, fontSize: 10.5, color: C.muted });
  addCard(rightX + rightW - 2.75, topY - 0.02, 2.75, 0.65, { fill: C.card });
  slide.addText("ANALYSIS WINDOW", { x: rightX + rightW - 2.65, y: topY + 0.06, w: 2.55, h: 0.2, fontSize: 8.5, color: C.muted, bold: true, align: "right" });
  slide.addText(windowLabel, { x: rightX + rightW - 2.65, y: topY + 0.28, w: 2.55, h: 0.3, fontSize: 12.5, color: C.text, bold: true, align: "right" });
  const statusY = topY + 0.9;
  addCard(leftX, statusY, leftW, 1.55);
  slide.addText("PORTFOLIO STATUS", { x: leftX + 0.3, y: statusY + 0.18, w: leftW - 0.6, h: 0.2, fontSize: 9, color: C.teal, bold: true });
  slide.addText(safe(summary.summary?.headline || ""), { x: leftX + 0.3, y: statusY + 0.45, w: leftW - 0.6, h: 0.9, fontSize: 11, color: C.text });
  const kpiY = statusY + 1.75, tileW = (leftW - gutter) / 2, tileH = 0.95;
  const addKpiTile = (x: number, y: number, value: number, label: string) => { addCard(x, y, tileW, tileH); slide.addText(String(value), { x, y: y + 0.15, w: tileW, h: 0.4, fontSize: 22, bold: true, color: C.text, align: "center" }); slide.addText(label.toUpperCase(), { x, y: y + 0.62, w: tileW, h: 0.25, fontSize: 9, color: C.muted, align: "center", bold: true }); };
  addKpiTile(leftX, kpiY, kTotal, "Total Open"); addKpiTile(leftX + tileW + gutter, kpiY, kOverdue, "Overdue"); addKpiTile(leftX, kpiY + tileH + gutter, kHigh, "High Score"); addKpiTile(leftX + tileW + gutter, kpiY + tileH + gutter, kSla, "SLA Hot");
  const exposureY = kpiY + tileH * 2 + gutter + 0.1;
  addCard(leftX, exposureY, leftW, 0.85, { fill: "EEF2FF" });
  slide.addText(`Exposure: ${kExposureFmt}`, { x: leftX + 0.75, y: exposureY + 0.18, w: leftW - 1.0, h: 0.25, fontSize: 12, bold: true, color: C.text });
  slide.addText(nn(k.exposure_total, 0) > 0 ? "Financial exposure detected — review hotspots." : "No immediate financial exposure detected", { x: leftX + 0.75, y: exposureY + 0.46, w: leftW - 1.0, h: 0.25, fontSize: 10, color: C.muted });
  const rightTopY = statusY;
  slide.addText("Top Risks by Score", { x: rightX, y: rightTopY, w: rightW - 2.4, h: 0.35, fontSize: 14, bold: true, color: C.text });
  addPill(rightX + rightW - 2.2, rightTopY + 0.02, 2.2, 0.35, pr.label, pr.kind);
  const featY = rightTopY + 0.5;
  addCard(rightX, featY, rightW, 1.8);
  slide.addShape("roundRect", { x: rightX + 0.18, y: featY + 0.22, w: 0.08, h: 1.36, fill: { color: pr.kind === "danger" ? C.danger : pr.kind === "warn" ? C.warn : C.teal }, line: { color: pr.kind === "danger" ? C.danger : pr.kind === "warn" ? C.warn : C.teal } });
  const projType = `${safe(featured?.project_title || "PROJECT")} • ${safe(featured?.type || "RAID")}`.toUpperCase();
  slide.addText(projType, { x: rightX + 0.35, y: featY + 0.23, w: rightW - 2.0, h: 0.2, fontSize: 8.5, color: C.indigo, bold: true });
  slide.addText(safe(featured?.title || "—"), { x: rightX + 0.35, y: featY + 0.48, w: rightW - 2.2, h: 0.3, fontSize: 14, color: C.text, bold: true });
  const desc = safe(featured?.note || featured?.prompt || "");
  slide.addText(desc || " ", { x: rightX + 0.35, y: featY + 0.82, w: rightW - 2.2, h: 0.35, fontSize: 10.5, color: C.muted });
  const scoreBoxX = rightX + rightW - 1.55;
  slide.addText("RISK SCORE", { x: scoreBoxX, y: featY + 0.42, w: 1.3, h: 0.18, fontSize: 8, color: C.muted, bold: true, align: "right" });
  slide.addText(String(nn(featuredScore, 0)), { x: scoreBoxX, y: featY + 0.6, w: 1.3, h: 0.5, fontSize: 26, bold: true, color: pr.kind === "danger" ? C.danger : pr.kind === "warn" ? C.warn : C.teal, align: "right" });
  const metaY = featY + 1.35;
  const due = featured?.due_date ? fmtUKShortDate(featured.due_date) : "—";
  const owner = safe(featured?.owner_label || "—");
  const exposure = safe(featured?.exposure_total_fmt || "—");
  slide.addText(`Due  ${due}`, { x: rightX + 0.35, y: metaY, w: 2.0, h: 0.25, fontSize: 10, color: C.text });
  slide.addText(`Owner  ${owner}`, { x: rightX + 2.55, y: metaY, w: 2.3, h: 0.25, fontSize: 10, color: C.text });
  slide.addText(`Exposure  ${exposure}`, { x: rightX + 4.95, y: metaY, w: rightW - 5.3, h: 0.25, fontSize: 10, color: C.text });
  const bottomTilesY = featY + 2.05, bottomTileH = 1.25, bottomTileW = (rightW - gutter) / 2;
  addCard(rightX, bottomTilesY, bottomTileW, bottomTileH);
  slide.addText("SLA BREACH WATCHLIST", { x: rightX + 0.25, y: bottomTilesY + 0.2, w: bottomTileW - 0.5, h: 0.2, fontSize: 9, color: C.muted, bold: true });
  slide.addText(kSla > 0 ? `${kSla} item(s) look SLA-hot` : "No active breaches", { x: rightX + 0.25, y: bottomTilesY + 0.55, w: bottomTileW - 0.5, h: 0.3, fontSize: 10.5, color: C.text });
  addCard(rightX + bottomTileW + gutter, bottomTilesY, bottomTileW, bottomTileH);
  slide.addText("FINANCIAL HOTSPOTS", { x: rightX + bottomTileW + gutter + 0.25, y: bottomTilesY + 0.2, w: bottomTileW - 0.5, h: 0.2, fontSize: 9, color: C.muted, bold: true });
  slide.addText(nn(k.exposure_total, 0) > 0 ? `Exposure ${kExposureFmt}` : "No hotspots detected", { x: rightX + bottomTileW + gutter + 0.25, y: bottomTilesY + 0.55, w: bottomTileW - 0.5, h: 0.3, fontSize: 10.5, color: C.text });
  slide.addText(`Generated: ${genText}`, { x: leftX, y: SLIDE_H - 0.4, w: 5.0, h: 0.25, fontSize: 9, color: C.muted });
  slide.addText("Week-on-week trend analysis will appear after 2+ snapshots", { x: rightX, y: SLIDE_H - 0.4, w: rightW, h: 0.25, fontSize: 9, color: C.muted, align: "right" });
  const buf = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(buf);
}

/* ---------------- handler ---------------- */

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const top = clampInt(url.searchParams.get("top"), 1, 20, 5);
    const scope = clampScope(url.searchParams.get("scope"));
    const download = safeStr(url.searchParams.get("download")).trim() === "1";
    const format = clampFormat(url.searchParams.get("format"));

    const exec = await buildExecSummary({ supabase, userId: auth.user.id, scope, days, top });
    if (!(exec as any).ok) return jsonErr((exec as any).error || "Failed", 500);

    const summary = exec as ExecSummary;

    if (!download) {
      return jsonOk(summary, 200, { "Cache-Control": "no-store, max-age=0" });
    }

    if (format === "md") {
      const lines: string[] = [];
      lines.push(`# Portfolio RAID Brief`);
      lines.push(`Client: ${summary.client_name || "—"} • Organisation: ${summary.org_name || "—"}`);
      lines.push(`Generated: ${fmtUkDateTime(summary.summary.generated_at)}`);
      lines.push(``);
      lines.push(summary.summary.headline);
      lines.push(``);
      for (const sec of summary.sections) {
        lines.push(`## ${sec.title}`);
        for (const it of sec.items) {
          lines.push(`- ${it.project_title || "Project"} • ${it.type || "RAID"} • ${it.title || "Untitled"} • Due ${it.due_date ? fmtUkDate(it.due_date) : "—"}`);
        }
        lines.push(``);
      }
      return new NextResponse(Buffer.from(lines.join("\n")), {
        status: 200,
        headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="portfolio_raid_brief_${days}d.md"`, "cache-control": "no-store, max-age=0" },
      });
    }

    if (format === "pptx") {
      const pptxBuf = await renderPptxFromSummary(summary);
      const base = sanitizeFilename(summary.client_name || "") || sanitizeFilename(summary.org_name || "") || "portfolio_raid_brief";
      return new NextResponse(Buffer.from(pptxBuf), {
        status: 200,
        headers: { "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation", "content-disposition": `attachment; filename="${base}_raid_brief_${days}d.pptx"`, "cache-control": "no-store, max-age=0" },
      });
    }

    const html = renderPdfHtml(summary);
    const pdf = await renderPdfFromHtml(html);
    const base = sanitizeFilename(summary.client_name || "") || sanitizeFilename(summary.org_name || "") || "portfolio_raid_brief";
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}_raid_brief_${days}d.pdf"`, "cache-control": "no-store, max-age=0" },
    });

  } catch (e: any) {
    console.error("[GET /api/portfolio/raid-exec-summary]", e);
    return jsonErr(String(e?.message || e || "Failed"), 500);
  }
}