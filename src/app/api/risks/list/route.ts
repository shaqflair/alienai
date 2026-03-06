// src/app/api/risks/list/route.ts
// Queries raid_log table (org-scoped by organisation_id)
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function jsonOk(data: any, status = 200) { return noStore(NextResponse.json({ ok: true, ...data }, { status })); }
function jsonErr(error: string, status = 400, meta?: any) { return noStore(NextResponse.json({ ok: false, error, meta }, { status })); }

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }

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

async function getOrgId(supabase: any, userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();
  return data?.organisation_id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (authErr || !userId) return jsonErr("Not authenticated", 401);

    const url     = new URL(req.url);
    const days    = clampDays(url.searchParams.get("days") || url.searchParams.get("window"));
    const scope   = safeStr(url.searchParams.get("scope") || "all").toLowerCase();
    const typeP   = safeStr(url.searchParams.get("type")  || "all");
    const statusP = safeStr(url.searchParams.get("status") || "all").toLowerCase();
    const limit   = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") ?? "200", 10)));

    const orgId = await getOrgId(supabase, userId);
    if (!orgId) return jsonErr("No organisation found", 403);

    const today  = new Date().toISOString().slice(0, 10);
    const winEnd = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

    // Base query on raid_log
    let q = supabase
      .from("raid_log")
      .select(`
        id, project_id, name, type, priority,
        likelihood, severity, ai_rollup, owner,
        status, last_updated, organisation_id,
        projects:projects!raid_log_project_id_fkey(id, title, project_code, human_id)
      `)
      .eq("organisation_id", orgId)
      .order("last_updated", { ascending: false })
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
      q = q.not('status', 'in', '("Closed","Invalid")');
    }

    // Scope filter (using last_updated as proxy since no due_date)
    if (scope === "window") {
      q = q.gte("last_updated", today).lte("last_updated", winEnd);
    } else if (scope === "overdue") {
      q = q.lt("last_updated", today);
    }

    const { data: rows, error: rowErr } = await q;
    if (rowErr) return jsonErr(rowErr.message, 500);

    // Resolve owner UUIDs to full names via profiles
    const ownerIds = [...new Set(
      (rows ?? []).map((r: any) => r.owner).filter((o: any) => o && typeof o === "string")
    )];
    const ownerMap = new Map<string, string>();
    if (ownerIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", ownerIds);
      for (const p of profiles ?? []) {
        if (p.user_id && p.full_name) ownerMap.set(String(p.user_id), String(p.full_name));
      }
    }

    const items = (rows ?? []).map((r: any) => {
      const id        = String(r.id);
      const prob      = r.likelihood != null ? Number(r.likelihood) : null;
      const sev       = r.severity   != null ? Number(r.severity)   : null;
      const score     = prob != null && sev != null ? Math.round((prob * sev) / 100) : null;
      const proj      = r.projects as any;
      const projectCode = proj?.project_code
        ? (typeof proj.project_code === "string" ? proj.project_code.trim() : String(proj.project_code))
        : null;

      return {
        id,
        project_id:    String(r.project_id || ""),
        project_title: proj?.title ? String(proj.title) : "Project",
        project_human_id: proj?.human_id ?? null,
        project_code:  projectCode,
        type:          String(r.type    || "Risk"),
        title:         String(r.name    || "RAID item"),
        description:   "",
        status:        String(r.status  || "Open"),
        priority:      r.priority ? String(r.priority) : null,
        probability:   prob,
        severity:      sev,
        score,
        score_source:  "basic" as const,
        score_tooltip: "Likelihood x Severity",
        sla_breach_probability: null,
        sla_days_to_breach:     null,
        sla_confidence:         null,
        currency:        "GBP",
        currency_symbol: "£",
        est_cost_impact:     null,
        est_revenue_at_risk: null,
        est_penalties:       null,
        due_date:    null,
        due_date_uk: null,
        owner_label: r.owner ? (ownerMap.get(String(r.owner)) || String(r.owner)) : "",
        ai_rollup:   String(r.ai_rollup || ""),
        created_at:  String(r.last_updated || ""),
        updated_at:  String(r.last_updated || ""),
      };
    });

    return jsonOk({
      scope:      "org",
      windowDays: days,
      type:       typeP,
      status:     statusP,
      items,
      meta: { projectCount: new Set(items.map((i: any) => i.project_id)).size, scope: "org", active_only: false, organisationId: orgId },
    });
  } catch (e: any) {
    console.error("[GET /api/risks/list]", e);
    return jsonErr(String(e?.message ?? e), 500);
  }
}
