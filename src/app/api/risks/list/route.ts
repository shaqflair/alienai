// src/app/api/risks/list/route.ts
// ✅ Org-scoped: all org members see portfolio-wide RAID items.
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

function clampDays(x: string | null, fallback = 30) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return new Set([7, 14, 30, 60]).has(n) ? n : fallback;
}

function safeScope(x: string | null) {
  const v = String(x || "").toLowerCase();
  return ["window", "overdue", "all"].includes(v) ? v : "all";
}

function safeType(x: string | null) {
  const v = String(x || "").trim();
  if (!v || v.toLowerCase() === "all") return "all";
  return new Set(["Risk", "Issue", "Assumption", "Dependency"]).has(v) ? v : "all";
}

function safeStatus(x: string | null) {
  const v = String(x || "").trim().toLowerCase();
  if (!v || v === "all") return "all";
  const map: Record<string, string> = {
    open: "Open", in_progress: "In Progress",
    mitigated: "Mitigated", closed: "Closed", invalid: "Invalid",
  };
  return map[v] || "all";
}

function isoDateUTC(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2,"0")}/${String(d.getUTCMonth()+1).padStart(2,"0")}/${d.getUTCFullYear()}`;
}

function clamp01to100(n: any) {
  const v = Number(n); if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function asIsoOrNull(x: any): string | null { return x ? String(x) : null; }
function num(x: any, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }

function currencySymbol(code: any) {
  const c = String(code || "GBP").trim().toUpperCase();
  if (c === "GBP" || c === "UKP") return "£";
  if (c === "EUR") return "€";
  if (c === "USD") return "$";
  if (c === "NGN") return "₦";
  if (c === "GHS") return "GH₵";
  return "£";
}

function buildScoreTooltip(components: any, modelVersion: any, scoredAt: any) {
  const lines: string[] = [];
  if (modelVersion) lines.push(`Model: ${String(modelVersion)}`);
  const uk = fmtDateUK(scoredAt);
  if (uk) lines.push(`Scored: ${uk}`);

  if (components && typeof components === "object") {
    const p = (components as any).probability ?? (components as any).prob ?? null;
    const s = (components as any).severity ?? (components as any).sev ?? null;
    const age = (components as any).age ?? (components as any).item_age ?? null;
    const blk = (components as any).blocked ?? (components as any).blocker ?? null;
    if (p != null) lines.push(`Probability: ${p}`);
    if (s != null) lines.push(`Severity: ${s}`);
    if (age != null) lines.push(`Age: ${age}`);
    if (blk != null) lines.push(`Blocked: ${blk}`);
    if (lines.length <= 2) {
      try {
        const compact = JSON.stringify(components);
        if (compact && compact !== "{}") lines.push(`Components: ${compact}`);
      } catch { /* ignore */ }
    }
  }
  return lines.join("\n");
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const url = new URL(req.url);

  const scope = safeScope(url.searchParams.get("scope"));
  const windowDays = clampDays(url.searchParams.get("window"), 30);
  const type = safeType(url.searchParams.get("type"));
  const status = safeStatus(url.searchParams.get("status"));

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (authErr || !userId) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }

  // ✅ Org-wide scope
  const scoped = await resolveOrgActiveProjectScope(supabase, userId);
  const projectIds = scoped.projectIds;

  if (!projectIds.length) {
    return NextResponse.json({
      ok: true, scope, windowDays, type, status, items: [],
      meta: { projectCount: 0, scope: "org", active_only: true },
    });
  }

  let q = supabase
    .from("raid_items")
    .select(`
      id, project_id, type, title, description, status, priority,
      probability, severity, due_date, owner_id, owner_label,
      ai_rollup, ai_status, ai_dirty, ai_last_run_at, created_at, updated_at,
      projects:projects ( id, title, project_code )
    `)
    .in("project_id", projectIds);

  if (type !== "all") q = q.eq("type", type);
  if (status !== "all") q = q.eq("status", status);

  const today = new Date();
  const todayStr = isoDateUTC(today);
  const toStr = isoDateUTC(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + windowDays)));

  if (scope === "window") q = q.gte("due_date", todayStr).lte("due_date", toStr);
  else if (scope === "overdue") q = q.lt("due_date", todayStr).not("status", "in", '("Closed","Invalid")');

  const { data, error } = await q
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("severity", { ascending: false, nullsFirst: false })
    .limit(500);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = data || [];
  const raidItemIds = rows.map((r: any) => r.id).filter(Boolean);

  const scoreByItem = new Map<string, any>();
  const predByItem = new Map<string, any>();
  const finByItem = new Map<string, any>();
  let finOptionalError: string | null = null;

  if (raidItemIds.length) {
    const cap = Math.min(5000, raidItemIds.length * 10);

    const { data: scores, error: sErr } = await supabase
      .from("raid_item_scores")
      .select("raid_item_id, score, components, model_version, scored_at")
      .in("raid_item_id", raidItemIds)
      .order("scored_at", { ascending: false })
      .limit(cap);

    if (sErr) return NextResponse.json({ ok: false, error: sErr.message }, { status: 500 });

    for (const s of scores || []) {
      const id = (s as any).raid_item_id as string;
      if (!id || scoreByItem.has(id)) continue;
      scoreByItem.set(id, {
        raid_item_id: id,
        score: (s as any).score ?? null,
        components: (s as any).components && typeof (s as any).components === "object" ? (s as any).components : null,
        model_version: (s as any).model_version ?? null,
        scored_at: asIsoOrNull((s as any).scored_at),
      });
    }

    const { data: preds, error: pErr } = await supabase
      .from("raid_sla_predictions")
      .select("raid_item_id, breach_probability, days_to_breach, confidence, drivers, model_version, predicted_at")
      .in("raid_item_id", raidItemIds)
      .order("predicted_at", { ascending: false })
      .limit(cap);

    if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });

    for (const p of preds || []) {
      const id = (p as any).raid_item_id as string;
      if (!id || predByItem.has(id)) continue;
      predByItem.set(id, {
        raid_item_id: id,
        breach_probability: (p as any).breach_probability ?? null,
        days_to_breach: (p as any).days_to_breach ?? null,
        confidence: (p as any).confidence ?? null,
        drivers: (p as any).drivers ?? null,
        model_version: (p as any).model_version ?? null,
        predicted_at: asIsoOrNull((p as any).predicted_at),
      });
    }

    const { data: fins, error: fErr } = await supabase
      .from("raid_financials")
      .select("raid_item_id, currency, est_cost_impact, est_schedule_days, est_revenue_at_risk, est_penalties, updated_at")
      .in("raid_item_id", raidItemIds)
      .limit(Math.min(5000, raidItemIds.length));

    if (fErr) {
      finOptionalError = looksMissingRelation(fErr) ? "raid_financials missing" : fErr.message;
    } else {
      for (const f of fins || []) {
        const id = (f as any).raid_item_id as string;
        if (!id) continue;
        finByItem.set(id, {
          raid_item_id: id,
          currency: String((f as any).currency ?? "GBP").toUpperCase() || "GBP",
          est_cost_impact: (f as any).est_cost_impact ?? null,
          est_schedule_days: (f as any).est_schedule_days ?? null,
          est_revenue_at_risk: (f as any).est_revenue_at_risk ?? null,
          est_penalties: (f as any).est_penalties ?? null,
          updated_at: asIsoOrNull((f as any).updated_at),
        });
      }
    }
  }

  const items = rows.map((r: any) => {
    const p = clamp01to100(r?.probability);
    const s = clamp01to100(r?.severity);
    const basicScore = r?.probability == null || r?.severity == null ? null : Math.round((p * s) / 100);
    const aiScore = scoreByItem.get(r.id) || null;
    const pred = predByItem.get(r.id) || null;
    const fin = finByItem.get(r.id) || null;
    const score = aiScore?.score ?? basicScore;
    const cur = String((fin?.currency ?? "GBP") || "GBP").toUpperCase();

    return {
      id: r.id,
      project_id: r.project_id,
      project_title: r?.projects?.title || "Project",
      project_code: r?.projects?.project_code ?? null,

      type: r.type,
      title: r.title || r.description?.slice(0, 80) || "RAID item",
      description: r.description || "",
      status: r.status,
      priority: r.priority,
      probability: r.probability,
      severity: r.severity,

      score,
      score_source: aiScore ? "ai" : "basic",
      score_components: aiScore?.components ?? null,
      score_model_version: aiScore?.model_version ?? null,
      score_scored_at: aiScore?.scored_at ?? null,
      score_tooltip: buildScoreTooltip(aiScore?.components ?? null, aiScore?.model_version ?? null, aiScore?.scored_at ?? null),

      sla_breach_probability: pred?.breach_probability ?? null,
      sla_days_to_breach: pred?.days_to_breach ?? null,
      sla_confidence: pred?.confidence ?? null,
      sla_drivers: pred?.drivers ?? null,
      sla_model_version: pred?.model_version ?? null,
      sla_predicted_at: pred?.predicted_at ?? null,

      currency: cur,
      currency_symbol: currencySymbol(cur),
      est_cost_impact: fin?.est_cost_impact ?? null,
      est_schedule_days: fin?.est_schedule_days ?? null,
      est_revenue_at_risk: fin?.est_revenue_at_risk ?? null,
      est_penalties: fin?.est_penalties ?? null,
      financials_updated_at: fin?.updated_at ?? null,

      due_date: r.due_date,
      due_date_uk: fmtDateUK(r.due_date),
      owner_label: r.owner_label || "",
      ai_rollup: r.ai_rollup || "",
      ai_status: r.ai_status || "",
      ai_dirty: Boolean(r.ai_dirty),
      ai_last_run_at: r.ai_last_run_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  });

  return NextResponse.json({
    ok: true, scope, windowDays, type, status, items,
    meta: {
      projectCount: projectIds.length, scope: "org", active_only: true,
      optional_tables: { raid_financials: finOptionalError ? { ok: false, error: finOptionalError } : { ok: true } },
    },
  });
}