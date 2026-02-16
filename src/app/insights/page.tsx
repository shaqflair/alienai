// src/app/insights/page.tsx
import "server-only";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

type Insight = {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  body: string;
  href?: string | null;
};

type ExecItem = {
  id: string;
  project_title?: string;
  type?: string;
  title?: string;
  score?: number | null;
  due_date?: string | null;
  owner_label?: string | null;
  sla_breach_probability?: number | null;
  sla_days_to_breach?: number | null;
  sla_confidence?: number | null;
  exposure_total?: number | null;
  exposure_total_fmt?: string | null;
  overdue?: boolean | null;
  href?: string | null;
  note?: string | null;
  prompt?: string | null;

  // internal only (for assembling notes)
  ai_rollup?: string | null;
  project_id?: string | null;
};

type ExecSection = {
  key: string;
  title: string;
  items: ExecItem[];
};

type ExecSummary = {
  ok: true;

  // header context (optional; route has these)
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
  wow?: {
    week_start?: string | null;
    prev_week_start?: string | null;
    narrative?: string[];
  } | null;
  sections: ExecSection[];
};

function chip(kind: "neutral" | "warn" | "danger") {
  if (kind === "danger") return "border-rose-600/40 bg-rose-50 text-rose-800 font-medium";
  if (kind === "warn") return "border-amber-600/40 bg-amber-50 text-amber-800 font-medium";
  return "border-gray-300 bg-gray-50 text-gray-700 font-medium";
}

function sevBox(sev: "high" | "medium" | "info") {
  if (sev === "high") return "border-rose-600/40 bg-rose-50 text-rose-800";
  if (sev === "medium") return "border-amber-600/40 bg-amber-50 text-amber-800";
  return "border-blue-600/40 bg-blue-50 text-blue-800";
}

function n(x: any, fallback: number | null = null) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function isoDateUTC(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function clamp01to100(v: any) {
  const nn = Number(v);
  if (!Number.isFinite(nn)) return 0;
  return Math.max(0, Math.min(100, Math.round(nn)));
}

function moneyGBP(nv: any) {
  const v = Number(nv || 0);
  if (!Number.isFinite(v)) return "—";
  return "£" + v.toLocaleString("en-GB");
}

/**
 * ✅ UK date display (dd/mm/yyyy)
 * - If the string is ISO date-only, format without timezone shifts
 */
function fmtDateUK(x: any) {
  if (!x) return "—";
  const s = String(x).trim();
  if (!s) return "—";

  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!yyyy || !mm || !dd) return "—";
    return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;

  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtDateTimeUK(x: any) {
  if (!x) return "—";
  const d = new Date(String(x));
  if (Number.isNaN(d.getTime())) return String(x);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function InsightsPage() {
  const supabase = await createClient();

  // Window defaults
  const days = 30;
  const top = 5;
  const scope: "window" = "window";

  // ✅ auth (single source of truth)
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id || null;

  // ✅ ACTIVE + ACCESSIBLE project scope (single source of truth)
  let scopedProjectIds: string[] = [];
  let scopeMeta: any = null;

  if (userId) {
    try {
      const scoped = await resolveActiveProjectScope(supabase, userId);
      scopedProjectIds = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];
      scopeMeta = scoped?.meta ?? null;
    } catch {
      scopedProjectIds = [];
      scopeMeta = { error: "resolveActiveProjectScope failed" };
    }
  }

  // ─────────────────────────────
  // EXEC SUMMARY (ACTIVE PROJECTS ONLY)
  // ─────────────────────────────
  let exec: ExecSummary | { ok: false; error: string } = {
    ok: false,
    error: "Executive summary unavailable.",
  };

  try {
    if (!userId) {
      exec = { ok: false, error: "Not authenticated" };
    } else if (!scopedProjectIds.length) {
      exec = { ok: false, error: "No accessible active projects found." };
    } else {
      const projectIds = scopedProjectIds;

      // Pull RAID items in-window (scope=window)
      const today = new Date();
      const todayStr = isoDateUTC(today);
      const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days));
      const toStr = isoDateUTC(to);

      const { data: raidRows, error: raidErr } = await supabase
        .from("raid_items")
        .select(
          `
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
          `
        )
        .in("project_id", projectIds)
        .gte("due_date", todayStr)
        .lte("due_date", toStr)
        .limit(2000);

      if (raidErr) {
        exec = { ok: false, error: raidErr.message };
      } else {
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
            .limit(5000);

          for (const s of scores || []) {
            const id = String((s as any).raid_item_id || "");
            if (!id) continue;
            if (!scoreByItem.has(id)) scoreByItem.set(id, s);
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
            .limit(5000);

          for (const p of preds || []) {
            const id = String((p as any).raid_item_id || "");
            if (!id) continue;
            if (!predByItem.has(id)) predByItem.set(id, p);
          }
        }

        // Financials (optional table)
        const finByItem = new Map<string, any>();
        if (raidItemIds.length) {
          const { data: fins, error: fErr } = await supabase
            .from("raid_financials")
            .select("raid_item_id, currency, est_cost_impact, est_schedule_days, est_revenue_at_risk, est_penalties, updated_at")
            .in("raid_item_id", raidItemIds)
            .limit(5000);

          if (!fErr) {
            for (const f of fins || []) {
              const id = String((f as any).raid_item_id || "");
              if (!id) continue;
              finByItem.set(id, f);
            }
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

          return {
            id: r.id,
            project_id: r.project_id,
            project_title: r?.projects?.title || "Project",
            type: r.type,
            title: r.title || r.description?.slice(0, 80) || "RAID item",
            due_date: due,
            owner_label: r.owner_label || "",
            ai_rollup: r.ai_rollup || "",
            score,
            sla_breach_probability: pred?.breach_probability ?? null,
            sla_days_to_breach: pred?.days_to_breach ?? null,
            sla_confidence: pred?.confidence ?? null,
            exposure_total,
            exposure_total_fmt: exposure_total ? moneyGBP(exposure_total) : null,
            overdue,
            href: `/projects/${r.project_id}/raid`,
          };
        });

        const total_items = enriched.length;
        const overdue_open = enriched.filter((x) => x.overdue).length;
        const high_score = enriched.filter((x) => (n(x.score, 0) || 0) >= 70).length;
        const sla_hot = enriched.filter((x) => {
          const bp = n(x.sla_breach_probability, -1) ?? -1;
          const dtb = x.sla_days_to_breach == null ? null : n(x.sla_days_to_breach, null);
          return bp >= 70 || (dtb != null && (dtb as number) <= 7);
        }).length;
        const exposure_total = enriched.reduce((acc, x) => acc + (n(x.exposure_total, 0) || 0), 0);

        const headline =
          total_items === 0
            ? "No RAID items match the selected window."
            : overdue_open > 0 || high_score > 0 || sla_hot > 0
            ? `Priority focus: ${overdue_open} overdue, ${high_score} high-scoring, ${sla_hot} SLA-hot items in the next ${days} days.`
            : `Stable window: ${total_items} items reviewed with no critical flags for the next ${days} days.`;

        const byScore = [...enriched]
          .filter((x) => x.score != null)
          .sort((a, b) => (n(b.score, 0) || 0) - (n(a.score, 0) || 0))
          .slice(0, top)
          .map((x) => ({ ...x, note: x.ai_rollup ? String(x.ai_rollup).slice(0, 220) : null }));

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
                    x.sla_days_to_breach != null ? ` • ~${x.sla_days_to_breach} days` : ""
                  }.`
                : null,
          }));

        const byExposure = [...enriched]
          .filter((x) => (n(x.exposure_total, 0) || 0) > 0)
          .sort((a, b) => (n(b.exposure_total, 0) || 0) - (n(a.exposure_total, 0) || 0))
          .slice(0, top)
          .map((x) => ({
            ...x,
            note: `Exposure ${x.exposure_total_fmt || "—"} (cost + revenue risk + penalties).`,
          }));

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
            prompt: x.overdue ? `Confirm owner/action plan and rebaseline due date.` : `Confirm mitigation and next update before ${x.due_date}.`,
          }));

        // WoW from raid_weekly_snapshots.snapshot (optional)
        let wow: ExecSummary["wow"] = null;
        try {
          const { data: snaps, error: snapErr } = await supabase
            .from("raid_weekly_snapshots")
            .select("project_id, week_start, snapshot")
            .in("project_id", projectIds)
            .order("week_start", { ascending: false })
            .limit(5000);

          if (!snapErr && (snaps || []).length) {
            const byWeek = new Map<
              string,
              { total_items: number; overdue_open: number; high_score: number; sla_hot: number; exposure_total: number }
            >();

            for (const row of snaps || []) {
              const wk = String((row as any).week_start || "").slice(0, 10);
              if (!wk) continue;
              const snap = (row as any).snapshot || {};
              const agg = byWeek.get(wk) || {
                total_items: 0,
                overdue_open: 0,
                high_score: 0,
                sla_hot: 0,
                exposure_total: 0,
              };
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
                  `${sign(deltas.exposure_total)} Exposure: ${moneyGBP(cur.exposure_total)} (${deltas.exposure_total >= 0 ? "+" : ""}${moneyGBP(
                    deltas.exposure_total
                  )})`,
                ],
              };
            } else {
              wow = { week_start: week_start || null, prev_week_start: null, narrative: [] };
            }
          }
        } catch {
          wow = null;
        }

        exec = {
          ok: true,
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
    }
  } catch {
    exec = { ok: false, error: "Failed to load executive summary" };
  }

  // ─────────────────────────────
  // EXISTING INSIGHTS (RPC) — ACTIVE PROJECTS ONLY
  // ─────────────────────────────
  let insights: Insight[] = [];
  if (userId && scopedProjectIds.length) {
    try {
      const { data } = await supabase.rpc("get_portfolio_insights", { p_project_ids: scopedProjectIds, p_days: days });
      insights = Array.isArray(data) ? (data as any) : [];
    } catch {
      insights = [];
    }
  }

  // ✅ Download links (no dropdown)
  const downloadPdfHref = `/api/portfolio/raid-exec-summary?days=${days}&scope=${scope}&top=${top}&download=1&format=pdf`;
  const downloadPptxHref = `/api/portfolio/raid-exec-summary?days=${days}&scope=${scope}&top=${top}&download=1&format=pptx`;

  return (
    <div className="min-h-screen bg-white text-gray-900 font-['Inter','system-ui',sans-serif]">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">Insights</h1>
        <p className="mt-3 text-lg text-gray-600">Decision intelligence generated from RAID and delivery signals.</p>

        {/* ───────────────────────────────── Executive Summary ───────────────────────────────── */}
        <div className="mt-10 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
              <div className="text-sm text-gray-500">Executive Summary • next {days} days</div>
              <div className="mt-2 text-2xl font-bold text-gray-900">Portfolio RAID Brief</div>
              <div className="mt-3 text-gray-700">
                {(exec as any).ok ? (exec as any).summary?.headline : "Executive summary unavailable."}
              </div>

              {(exec as any).ok ? (
                <div className="mt-2 text-sm text-gray-500">
                  Generated: {fmtDateTimeUK((exec as any).summary?.generated_at)}
                </div>
              ) : (exec as any).error ? (
                <div className="mt-2 text-sm text-rose-700">{safeStr((exec as any).error)}</div>
              ) : null}

              {/* Optional scope debug line (safe, small) */}
              {scopeMeta ? (
                <div className="mt-2 text-xs text-gray-400">
                  Active projects in scope: {scopedProjectIds.length}
                </div>
              ) : null}
            </div>

            <div className="shrink-0 flex items-center gap-3">
              <Link
                href={downloadPdfHref}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition"
              >
                Download PDF
              </Link>

              <Link
                href={downloadPptxHref}
                className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition"
              >
                Download PPTX
              </Link>

              <Link
                href="/risks"
                className="rounded-lg border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition"
              >
                Open RAID →
              </Link>
            </div>
          </div>

          {/* KPI chips */}
          {(exec as any).ok ? (
            <div className="mt-6 flex flex-wrap gap-3 text-sm">
              <span className={`rounded-full border px-3 py-1.5 font-medium ${chip("neutral")}`}>
                Total: {(exec as any).kpis?.total_items ?? 0}
              </span>
              <span
                className={`rounded-full border px-3 py-1.5 font-medium ${
                  (exec as any).kpis?.overdue_open ? chip("danger") : chip("neutral")
                }`}
              >
                Overdue: {(exec as any).kpis?.overdue_open ?? 0}
              </span>
              <span
                className={`rounded-full border px-3 py-1.5 font-medium ${
                  (exec as any).kpis?.high_score ? chip("warn") : chip("neutral")
                }`}
              >
                High score: {(exec as any).kpis?.high_score ?? 0}
              </span>
              <span
                className={`rounded-full border px-3 py-1.5 font-medium ${
                  (exec as any).kpis?.sla_hot ? chip("warn") : chip("neutral")
                }`}
              >
                SLA hot: {(exec as any).kpis?.sla_hot ?? 0}
              </span>
              <span
                className={`rounded-full border px-3 py-1.5 font-medium ${
                  (exec as any).kpis?.exposure_total ? chip("warn") : chip("neutral")
                }`}
              >
                Exposure: {safeStr((exec as any).kpis?.exposure_total_fmt || "—")}
              </span>
            </div>
          ) : null}

          {/* Week-on-week */}
          {(exec as any).ok && (exec as any).wow?.prev_week_start ? (
            <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-6">
              <div className="flex items-center justify-between gap-4">
                <div className="font-semibold text-gray-900">Week-on-week</div>
                <div className="text-sm text-gray-500">
                  {fmtDateUK((exec as any).wow?.week_start || null)} vs{" "}
                  {fmtDateUK((exec as any).wow?.prev_week_start || null)}
                </div>
              </div>
              <div className="mt-4 space-y-2 text-gray-700">
                {Array.isArray((exec as any).wow?.narrative) && (exec as any).wow.narrative.length ? (
                  (exec as any).wow.narrative.map((t: string, i: number) => <div key={i}>• {t}</div>)
                ) : (
                  <div className="text-gray-600">No week-on-week narrative yet.</div>
                )}
              </div>
            </div>
          ) : (exec as any).ok ? (
            <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-6 text-gray-600">
              Week-on-week will appear after at least{" "}
              <span className="font-medium text-gray-900">2 weekly snapshots</span> exist.
            </div>
          ) : null}

          {/* Sections */}
          {(exec as any).ok ? (
            <div className="mt-10 grid grid-cols-1 gap-6">
              {(exec as any).sections?.map((sec: ExecSection) => (
                <div key={sec.key} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div className="font-semibold text-lg text-gray-900">{sec.title}</div>
                    <div className="text-sm text-gray-500">{sec.items?.length || 0} items</div>
                  </div>

                  <div className="mt-6 space-y-4">
                    {sec.items?.length ? (
                      sec.items.map((x) => {
                        const sc = n(x.score, null);
                        const bp = n(x.sla_breach_probability, null);
                        const overdue = Boolean(x.overdue);
                        const badge =
                          overdue || (bp != null && bp >= 70) || (sc != null && sc >= 70) ? chip("warn") : chip("neutral");

                        return (
                          <div
                            key={x.id}
                            className="rounded-xl border border-gray-200 bg-white p-5 hover:shadow-md hover:border-gray-300 transition"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="text-sm text-gray-500">
                                  {safeStr(x.project_title)} • {safeStr(x.type)}
                                </div>
                                <div className="mt-1 font-semibold text-gray-900 truncate">{safeStr(x.title)}</div>

                                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                                  <span className={`rounded-full border px-3 py-1.5 ${overdue ? chip("danger") : chip("neutral")}`}>
                                    Due: {x.due_date ? fmtDateUK(x.due_date) : "—"}
                                  </span>

                                  {sc != null ? (
                                    <span className={`rounded-full border px-3 py-1.5 ${badge}`}>Score: {sc}</span>
                                  ) : null}

                                  {bp != null ? (
                                    <span className={`rounded-full border px-3 py-1.5 ${bp >= 70 ? chip("warn") : chip("neutral")}`}>
                                      SLA: {bp}%
                                      {x.sla_days_to_breach != null ? ` (${x.sla_days_to_breach}d)` : ""}
                                      {x.sla_confidence != null ? ` • ${x.sla_confidence}%` : ""}
                                    </span>
                                  ) : null}

                                  {x.exposure_total_fmt ? (
                                    <span className={`rounded-full border px-3 py-1.5 ${chip("neutral")}`}>
                                      Exposure: {safeStr(x.exposure_total_fmt)}
                                    </span>
                                  ) : null}

                                  {x.owner_label ? (
                                    <span className={`rounded-full border px-3 py-1.5 ${chip("neutral")}`}>
                                      Owner: {safeStr(x.owner_label)}
                                    </span>
                                  ) : null}
                                </div>

                                {x.note || x.prompt ? (
                                  <div className="mt-3 text-sm text-gray-600">{safeStr(x.note || x.prompt)}</div>
                                ) : null}
                              </div>

                              {x.href ? (
                                <Link
                                  href={safeStr(x.href)}
                                  className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 transition"
                                >
                                  Open →
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-5 text-gray-600">
                        No items in this section.
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-8 rounded-xl border border-gray-200 bg-gray-50 p-6 text-gray-600">
              Executive summary not available yet.
            </div>
          )}
        </div>

        {/* ───────────────────────────────── Existing insight cards ───────────────────────────────── */}
        <div className="mt-12 grid grid-cols-1 gap-6">
          {insights.length ? (
            insights.map((x) => (
              <div key={x.id} className={`rounded-xl border p-6 ${sevBox(x.severity)} shadow-sm hover:shadow-md transition`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="text-xl font-semibold text-gray-900">{x.title}</div>
                    <div className="mt-2 text-gray-700">{x.body}</div>
                  </div>
                  {x.href ? (
                    <Link
                      href={safeStr(x.href)}
                      className="shrink-0 text-sm font-medium text-blue-600 hover:text-blue-800 transition"
                    >
                      View →
                    </Link>
                  ) : null}
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-gray-600 text-center">
              {userId
                ? "No insights yet — add RAID due dates / priorities to generate signals."
                : "Please sign in to view insights."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
