import "server-only";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export type ProjectRiskRow = {
  project_id:           string;
  project_title:       string;
  project_code:        string | null;
  pm_name:             string | null;
  declared_status:     string | null;
  failure_risk_score:  number;
  failure_risk_band:   string;
  confidence_score:    number;
  direction:           string | null;
  hidden_risk:         boolean;
  schedule_score:      number;
  governance_score:    number;
  budget_score:        number;
  stability_score:     number;
  top_drivers:         any[];
  recommended_actions: any[];
  narrative:           { executive: string; delivery: string };
  signal_detail:       any;
  generated_at:        string;
  snapshot_age_hours:  number;
  has_snapshot:        boolean;
  // truth layer
  evidence_status:     "green" | "amber" | "red";
  gap:                 "none" | "minor" | "material" | "critical";
  is_false_green:      boolean;
};

export type PortfolioIntelligencePayload = {
  ok:                   true;
  organisationId:       string;
  generatedAt:          string;
  totalProjects:        number;
  scoredProjects:       number;
  unscoredProjects:     number;
  // Portfolio risk summary
  avgFailureRisk:       number;
  portfolioRiskBand:    string;
  criticalCount:        number;
  highCount:            number;
  moderateCount:        number;
  lowCount:             number;
  // Truth layer summary
  falseGreenCount:      number;
  materialGapCount:     number;
  reportingTrustScore: number; // 0-100
  // Worsening trend
  worseningCount:       number;
  improvingCount:       number;
  // Projects ranked by risk
  projects:             ProjectRiskRow[];
  // Portfolio-level top decisions (cross-project)
  topDecisions: Array<{
    project_id:    string;
    project_title: string;
    action:        string;
    rationale:     string;
    pillar:        string;
    priority:      string;
    score_impact:  number;
    risk_reduction_pct: number;
    effort:        string;
    owner_hint:    string;
  }>;
};

function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any): number {
  const n = Number(x); return Number.isFinite(n) ? n : 0;
}

function evidenceStatus(score: number): "green" | "amber" | "red" {
  if (score >= 60) return "red";
  if (score >= 30) return "amber";
  return "green";
}
function statusNorm(s: string | null): "green" | "amber" | "red" | "unknown" {
  const v = safeStr(s).toLowerCase().replace(/[^a-z]/g, "");
  if (v === "green" || v === "g" || v === "ontrack" || v === "active") return "green";
  if (v === "amber" || v === "a" || v === "y")   return "amber";
  if (v === "red"   || v === "r")                return "red";
  return "unknown";
}
function gapLevel(declared: string, evidence: string): "none" | "minor" | "material" | "critical" {
  const order: Record<string, number> = { green: 0, amber: 1, red: 2, unknown: -1 };
  const d = order[declared] ?? -1, e = order[evidence] ?? -1;
  if (d === -1 || e === -1) return "none";
  const diff = e - d;
  if (diff <= 0) return "none"; if (diff === 1) return "minor"; if (diff === 2) return "material";
  return "critical";
}
function riskBand(score: number): string {
  if (score >= 75) return "Critical"; if (score >= 50) return "High";
  if (score >= 25) return "Moderate"; return "Low";
}

export async function loadPortfolioIntelligence(): Promise<PortfolioIntelligencePayload | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return { ok: false, error: "Unauthorized" };

    const admin = createAdminClient();

    const scope = await resolvePortfolioScope(supabase, user.id);
    const orgId = safeStr(scope?.organisationId).trim();
    if (!orgId) return { ok: false, error: "No active organisation" };

    const { data: projects } = await admin
      .from("projects")
      .select("id, title, project_code, status, resource_status, pm_name, pm_user_id")
      .eq("organisation_id", orgId)
      .is("deleted_at", null)
      .not("status", "in", '("closed","archived")');

    const activeProjects = (projects ?? []).filter((p: any) => {
      const rs = safeStr(p.resource_status).toLowerCase();
      return rs !== "pipeline";
    });

    if (!activeProjects.length) {
      return {
        ok: true, organisationId: orgId,
        generatedAt: new Date().toISOString(),
        totalProjects: 0, scoredProjects: 0, unscoredProjects: 0,
        avgFailureRisk: 0, portfolioRiskBand: "Low",
        criticalCount: 0, highCount: 0, moderateCount: 0, lowCount: 0,
        falseGreenCount: 0, materialGapCount: 0, reportingTrustScore: 100,
        worseningCount: 0, improvingCount: 0,
        projects: [], topDecisions: [],
      };
    }

    const projectIds = activeProjects.map((p: any) => safeStr(p.id));

    const { data: snapshots } = await admin
      .from("ai_premortem_snapshots")
      .select("project_id, generated_at, failure_risk_score, failure_risk_band, confidence_score, direction, hidden_risk, schedule_score, governance_score, budget_score, stability_score, top_drivers, recommended_actions, narrative, signal_detail")
      .eq("organisation_id", orgId)
      .in("project_id", projectIds)
      .order("generated_at", { ascending: false });

    const snapshotMap = new Map<string, any>();
    for (const s of (snapshots ?? [])) {
      if (!snapshotMap.has(s.project_id)) snapshotMap.set(s.project_id, s);
    }

    const pmUserIds = [...new Set(activeProjects.map((p: any) => safeStr(p.pm_user_id)).filter(Boolean))];
    const pmNameMap = new Map<string, string>();
    if (pmUserIds.length) {
      const { data: profiles } = await admin.from("profiles").select("user_id, full_name, email").in("user_id", pmUserIds);
      for (const p of (profiles ?? [])) {
        pmNameMap.set(safeStr(p.user_id), safeStr(p.full_name).trim() || safeStr(p.email).trim());
      }
    }

    const now = new Date();
    const rows: ProjectRiskRow[] = [];
    const topDecisions: PortfolioIntelligencePayload["topDecisions"] = [];

    for (const proj of activeProjects) {
      const pid      = safeStr(proj.id);
      const snap     = snapshotMap.get(pid);
      const pmName   = safeStr(proj.pm_name).trim() || pmNameMap.get(safeStr(proj.pm_user_id)) || null;
      const declStat = safeStr(proj.status);

      if (!snap) {
        rows.push({
          project_id: pid, project_title: safeStr(proj.title), project_code: proj.project_code ?? null,
          pm_name: pmName, declared_status: declStat,
          failure_risk_score: 0, failure_risk_band: "Low", confidence_score: 0,
          direction: null, hidden_risk: false,
          schedule_score: 0, governance_score: 0, budget_score: 0, stability_score: 0,
          top_drivers: [], recommended_actions: [], narrative: { executive: "", delivery: "" },
          signal_detail: {}, generated_at: "", snapshot_age_hours: 0, has_snapshot: false,
          evidence_status: "green", gap: "none", is_false_green: false,
        });
        continue;
      }

      const score      = safeNum(snap.failure_risk_score);
      const evStatus   = evidenceStatus(score);
      const decStatus  = statusNorm(declStat);
      const gap        = gapLevel(decStatus, evStatus);
      const isFalseGreen = snap.hidden_risk || (decStatus === "green" && evStatus !== "green");
      const ageHours   = Math.round((now.getTime() - new Date(snap.generated_at).getTime()) / 3600000);

      rows.push({
        project_id: pid, project_title: safeStr(proj.title), project_code: proj.project_code ?? null,
        pm_name: pmName, declared_status: declStat,
        failure_risk_score:  score,
        failure_risk_band:   safeStr(snap.failure_risk_band),
        confidence_score:    safeNum(snap.confidence_score),
        direction:           snap.direction ?? null,
        hidden_risk:         !!snap.hidden_risk,
        schedule_score:      safeNum(snap.schedule_score),
        governance_score:    safeNum(snap.governance_score),
        budget_score:        safeNum(snap.budget_score),
        stability_score:     safeNum(snap.stability_score),
        top_drivers:         Array.isArray(snap.top_drivers) ? snap.top_drivers : [],
        recommended_actions: Array.isArray(snap.recommended_actions) ? snap.recommended_actions : [],
        narrative:           (snap.narrative && typeof snap.narrative === "object") ? snap.narrative : { executive: "", delivery: "" },
        signal_detail:       snap.signal_detail ?? {},
        generated_at:        safeStr(snap.generated_at),
        snapshot_age_hours:  ageHours,
        has_snapshot:        true,
        evidence_status:     evStatus,
        gap,
        is_false_green:      isFalseGreen,
      });

      const actions = Array.isArray(snap.recommended_actions) ? snap.recommended_actions : [];
      for (const a of actions.slice(0, 2)) {
        if (!a?.action) continue;
        topDecisions.push({
          project_id:          pid,
          project_title:       safeStr(proj.title),
          action:              safeStr(a.action),
          rationale:           safeStr(a.rationale),
          pillar:              safeStr(a.pillar ?? ""),
          priority:            safeStr(a.priority ?? "now"),
          score_impact:        safeNum(a.score ?? score),
          risk_reduction_pct: Math.round((safeNum(a.score ?? 10) / Math.max(score, 1)) * 100),
          effort:              safeStr(a.ownerHint ? "immediate" : "short_term"),
          owner_hint:          safeStr(a.ownerHint ?? "PM"),
        });
      }
    }

    rows.sort((a, b) => b.failure_risk_score - a.failure_risk_score);
    topDecisions.sort((a, b) => b.score_impact - a.score_impact);

    const scored       = rows.filter(r => r.has_snapshot);
    const avgRisk      = scored.length ? Math.round(scored.reduce((s, r) => s + r.failure_risk_score, 0) / scored.length) : 0;
    const falseGreens  = rows.filter(r => r.is_false_green).length;
    const materialGaps = rows.filter(r => r.gap === "material" || r.gap === "critical").length;
    const trustScore   = rows.length > 0 ? Math.max(0, Math.round(100 - (falseGreens / rows.length) * 100)) : 100;

    return {
      ok: true,
      organisationId:      orgId,
      generatedAt:          now.toISOString(),
      totalProjects:        activeProjects.length,
      scoredProjects:       scored.length,
      unscoredProjects:     rows.filter(r => !r.has_snapshot).length,
      avgFailureRisk:       avgRisk,
      portfolioRiskBand:    riskBand(avgRisk),
      criticalCount:        rows.filter(r => r.failure_risk_band === "Critical").length,
      highCount:            rows.filter(r => r.failure_risk_band === "High").length,
      moderateCount:        rows.filter(r => r.failure_risk_band === "Moderate").length,
      lowCount:             rows.filter(r => r.failure_risk_band === "Low").length,
      falseGreenCount:      falseGreens,
      materialGapCount:     materialGaps,
      reportingTrustScore: trustScore,
      worseningCount:       rows.filter(r => r.direction === "worsening").length,
      improvingCount:       rows.filter(r => r.direction === "improving").length,
      projects:             rows,
      topDecisions:         topDecisions.slice(0, 10),
    };

  } catch (e: any) {
    console.error("[loadPortfolioIntelligence]", e);
    return { ok: false, error: String(e?.message ?? "Failed") };
  }
}