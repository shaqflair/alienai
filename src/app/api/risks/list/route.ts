// src/app/api/risks/list/route.ts
// Returns RAID items of type Risk (+ optional other types) for the org's active projects.
// ✅ Org-scoped via resolveOrgActiveProjectScope
// ✅ No JSX — pure API route
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ─── helpers ───────────────────────────────────────────────────────────────── */

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function jsonOk(data: any, status = 200)    { return noStore(NextResponse.json({ ok: true,  ...data }, { status })); }
function jsonErr(error: string, status = 400, meta?: any) { return noStore(NextResponse.json({ ok: false, error, meta }, { status })); }

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampDays(v: string | null): number {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.min(365, Math.floor(n)) : 30;
}

function fmtUkDate(iso: string | null) {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).slice(0, 10));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function uniqStrings(xs: any): string[] {
  const arr = Array.isArray(xs) ? xs : xs == null ? [] : [xs];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const s = safeStr(v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/* ─── GET /api/risks/list ────────────────────────────────────────────────────
   Query params:
     days    = 7 | 14 | 30 | 60 | all   (window for "due soon", default 30)
     scope   = all | window | overdue   (default all)
     type    = all | Risk | Issue | Assumption | Dependency  (default Risk)
     status  = all | open | in_progress | mitigated | closed | invalid (default open)
     limit   = 1–500  (default 200)
─────────────────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (authErr || !userId) return jsonErr("Not authenticated", 401);

    const url    = new URL(req.url);
    const days   = clampDays(url.searchParams.get("days"));
    const scope  = safeStr(url.searchParams.get("scope") || "all").toLowerCase();
    const typeP  = safeStr(url.searchParams.get("type")  || "Risk");
    const statusP = safeStr(url.searchParams.get("status") || "open").toLowerCase();
    const limit  = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10)));

    // Org-wide scope
    const scoped     = await resolveOrgActiveProjectScope(supabase, userId);
    const projectIds = (scoped?.projectIds ?? []).filter(Boolean);

    if (!projectIds.length) {
      return jsonOk({
        scope: "org", windowDays: days, type: typeP, status: statusP,
        items: [],
        meta: { projectCount: 0, scope: "org", active_only: true, organisationId: scoped?.organisationId ?? null },
      });
    }

    const today  = new Date().toISOString().slice(0, 10);
    const winEnd = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    // Build query
    let q = supabase
      .from("raid_items")
      .select(`
        id, project_id, type, title, description, status, priority,
        probability, severity, due_date, owner_label, ai_rollup,
        created_at, updated_at,
        projects:projects ( id, title, project_code )
      `)
      .in("project_id", projectIds)
      .order("updated_at", { ascending: false })
      .limit(limit);

    // Type filter
    if (typeP.toLowerCase() !== "all") {
      q = q.eq("type", typeP);
    }

    // Status filter
    if (statusP !== "all") {
      const statusMap: Record<string, string> = {
        open: "Open", in_progress: "In Progress",
        mitigated: "Mitigated", closed: "Closed", invalid: "Invalid",
      };
      const mapped = statusMap[statusP];
      if (mapped) q = q.eq("status", mapped);
    } else {
      // default: exclude closed/invalid for "all"
      q = q.not("status", "in", '("Closed","Invalid")');
    }

    // Scope filter
    if (scope === "window") {
      q = q.gte("due_date", today).lte("due_date", winEnd);
    } else if (scope === "overdue") {
      q = q.lt("due_date", today);
    }

    const { data: rows, error: rowErr } = await q;
    if (rowErr) return jsonErr(rowErr.message, 500);

    // Enrich with latest AI scores + SLA predictions + financials
    const ids = (rows ?? []).map((r: any) => String(r.id)).filter(Boolean);

    const [scoresRes, predsRes, finsRes] = await Promise.all([
      ids.length
        ? supabase.from("raid_item_scores")
            .select("raid_item_id, score, scored_at")
            .in("raid_item_id", ids)
            .order("scored_at", { ascending: false })
            .limit(ids.length * 3)
        : { data: [], error: null },
      ids.length
        ? supabase.from("raid_sla_predictions")
            .select("raid_item_id, breach_probability, days_to_breach, confidence, predicted_at")
            .in("raid_item_id", ids)
            .order("predicted_at", { ascending: false })
            .limit(ids.length * 3)
        : { data: [], error: null },
      ids.length
        ? supabase.from("raid_financials")
            .select("raid_item_id, currency, est_cost_impact, est_schedule_days, est_revenue_at_risk, est_penalties")
            .in("raid_item_id", ids)
            .limit(ids.length)
        : { data: [], error: null },
    ]);

    const scoreByItem = new Map<string, number>();
    for (const s of scoresRes.data ?? []) {
      const id = String((s as any).raid_item_id || "");
      if (id && !scoreByItem.has(id)) scoreByItem.set(id, Number((s as any).score));
    }

    const predByItem = new Map<string, any>();
    for (const p of predsRes.data ?? []) {
      const id = String((p as any).raid_item_id || "");
      if (id && !predByItem.has(id)) predByItem.set(id, p);
    }

    const finByItem = new Map<string, any>();
    for (const f of finsRes.data ?? []) {
      const id = String((f as any).raid_item_id || "");
      if (id) finByItem.set(id, f);
    }

    const items = (rows ?? []).map((r: any) => {
      const id   = String(r.id);
      const aiScore = scoreByItem.get(id);
      const pred = predByItem.get(id);
      const fin  = finByItem.get(id);

      const p = Number(r?.probability ?? 0);
      const s = Number(r?.severity    ?? 0);
      const basicScore = r?.probability != null && r?.severity != null
        ? Math.round((p * s) / 100)
        : null;
      const score       = aiScore != null ? Math.round(aiScore) : basicScore;
      const scoreSource = aiScore != null ? "ai" : "basic";

      const proj         = r?.projects as any;
      const projectCode  = proj?.project_code
        ? (typeof proj.project_code === "string" ? proj.project_code.trim() : String(proj.project_code))
        : null;

      const currency_symbol = safeStr(fin?.currency === "USD" ? "$" : fin?.currency === "EUR" ? "€" : "£");

      return {
        id,
        project_id:    String(r.project_id),
        project_title: proj?.title  ? String(proj.title)  : "Project",
        project_code:  projectCode,
        type:          String(r.type   || "Risk"),
        title:         String(r.title  || r.description?.slice(0, 120) || "RAID item"),
        description:   String(r.description || ""),
        status:        String(r.status || "Open"),
        priority:      r.priority ? String(r.priority) : null,
        probability:   r.probability != null ? Number(r.probability)  : null,
        severity:      r.severity    != null ? Number(r.severity)     : null,
        score,
        score_source:  scoreSource,
        score_tooltip: scoreSource === "ai" ? "AI-scored" : "P×S formula",
        sla_breach_probability: pred?.breach_probability != null ? Number(pred.breach_probability) : null,
        sla_days_to_breach:     pred?.days_to_breach     != null ? Number(pred.days_to_breach)     : null,
        sla_confidence:         pred?.confidence         != null ? Number(pred.confidence)         : null,
        currency:        safeStr(fin?.currency || "GBP"),
        currency_symbol,
        est_cost_impact:     fin?.est_cost_impact     != null ? Number(fin.est_cost_impact)     : null,
        est_revenue_at_risk: fin?.est_revenue_at_risk != null ? Number(fin.est_revenue_at_risk) : null,
        est_penalties:       fin?.est_penalties       != null ? Number(fin.est_penalties)       : null,
        due_date:    r.due_date ? String(r.due_date).slice(0, 10) : null,
        due_date_uk: fmtUkDate(r.due_date),
        owner_label: String(r.owner_label || ""),
        ai_rollup:   String(r.ai_rollup   || ""),
        ai_status:   "",
        created_at:  String(r.created_at || ""),
        updated_at:  String(r.updated_at || ""),
      };
    });

    return jsonOk({
      scope:      "org",
      windowDays: days,
      type:       typeP,
      status:     statusP,
      items,
      meta: {
        projectCount:    projectIds.length,
        scope:           "org",
        active_only:     true,
        organisationId:  scoped?.organisationId ?? null,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/risks/list]", e);
    return jsonErr(String(e?.message ?? e), 500);
  }
}