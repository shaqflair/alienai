// src/app/api/portfolio/raid-list/route.ts
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
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;
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
function num(x: any, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }
function currencySymbol(code: any) {
  const c = String(code || "GBP").trim().toUpperCase();
  if (c === "USD") return "$"; if (c === "EUR") return "€";
  return "£";
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
  if (authErr || !userId)
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  const scoped = await resolveOrgActiveProjectScope(supabase, userId);
  const projectIds = scoped.projectIds;

  if (!projectIds.length)
    return NextResponse.json({
      ok: true, scope, windowDays, type, status, items: [],
      meta: { projectCount: 0, scope: "org", active_only: true },
    });

  let q = supabase
    .from("raid_items")
    .select(`
      id, project_id, type, title, description, status, priority,
      probability, severity, due_date, owner_label,
      ai_rollup, ai_status, created_at, updated_at,
      projects:projects ( id, title, project_code )
    `)
    .in("project_id", projectIds);

  if (type !== "all") q = q.eq("type", type);
  if (status !== "all") q = q.eq("status", status);
  else q = q.not("status", "in", '("Closed","Invalid")');

  const today = new Date();
  const todayStr = isoDateUTC(today);
  const toStr = isoDateUTC(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + windowDays)));

  if (scope === "window") q = q.gte("due_date", todayStr).lte("due_date", toStr);
  else if (scope === "overdue") q = q.lt("due_date", todayStr);

  const { data, error } = await q
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(200);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = data || [];
  const ids = rows.map((r: any) => r.id).filter(Boolean);

  const scoreByItem = new Map<string, any>();
  const predByItem = new Map<string, any>();
  const finByItem = new Map<string, any>();

  if (ids.length) {
    const cap = Math.min(5000, ids.length * 10);
    const [scoresRes, predsRes, finsRes] = await Promise.all([
      supabase.from("raid_item_scores").select("raid_item_id, score, components, model_version, scored_at")
        .in("raid_item_id", ids).order("scored_at", { ascending: false }).limit(cap),
      supabase.from("raid_sla_predictions").select("raid_item_id, breach_probability, days_to_breach, confidence, predicted_at")
        .in("raid_item_id", ids).order("predicted_at", { ascending: false }).limit(cap),
      supabase.from("raid_financials").select("raid_item_id, currency, est_cost_impact, est_revenue_at_risk, est_penalties")
        .in("raid_item_id", ids).limit(ids.length),
    ]);
    for (const s of scoresRes.data || []) { const id = (s as any).raid_item_id; if (id && !scoreByItem.has(id)) scoreByItem.set(id, s); }
    for (const p of predsRes.data || []) { const id = (p as any).raid_item_id; if (id && !predByItem.has(id)) predByItem.set(id, p); }
    for (const f of finsRes.data || []) { const id = (f as any).raid_item_id; if (id) finByItem.set(id, f); }
  }

  const items = rows.map((r: any) => {
    const ai = scoreByItem.get(r.id);
    const pred = predByItem.get(r.id);
    const fin = finByItem.get(r.id);
    const p = clamp01to100(r?.probability), s = clamp01to100(r?.severity);
    const basicScore = r?.probability == null || r?.severity == null ? null : Math.round((p * s) / 100);
    const score = ai?.score ?? basicScore;
    const cur = String((fin?.currency ?? "GBP")).toUpperCase();
    const due = r.due_date ? String(r.due_date).slice(0, 10) : null;
    return {
      id: r.id, project_id: r.project_id,
      project_title: r?.projects?.title || "Project",
      project_code: r?.projects?.project_code ?? null,
      type: r.type, title: r.title || r.description?.slice(0, 80) || "RAID item",
      description: r.description || "", status: r.status, priority: r.priority,
      probability: r.probability, severity: r.severity,
      score, score_source: ai ? "ai" : "basic",
      score_tooltip: ai ? "AI-scored" : "P×S formula",
      sla_breach_probability: pred?.breach_probability ?? null,
      sla_days_to_breach: pred?.days_to_breach ?? null,
      sla_confidence: pred?.confidence ?? null,
      currency: cur, currency_symbol: currencySymbol(cur),
      est_cost_impact: fin?.est_cost_impact ?? null,
      est_revenue_at_risk: fin?.est_revenue_at_risk ?? null,
      est_penalties: fin?.est_penalties ?? null,
      due_date: due, due_date_uk: fmtDateUK(due),
      owner_label: r.owner_label || "",
      ai_rollup: r.ai_rollup || "", ai_status: r.ai_status || "",
      created_at: r.created_at, updated_at: r.updated_at,
    };
  });

  return NextResponse.json({
    ok: true, scope, windowDays, type, status, items,
    meta: { projectCount: projectIds.length, scope: "org", active_only: true },
  });
}
