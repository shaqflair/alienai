import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient }     from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { buildPremortemSignals } from "@/lib/server/ai/premortem/buildPremortemSignals";
import { scorePremortem }        from "@/lib/server/ai/premortem/scorePremortem";
import { getLatestPremortemSnapshot } from "@/lib/server/ai/premortem/premortemRepo";
import { computeDecisionImpact }  from "@/lib/server/ai/decisions/computeDecisionImpact";
import { computeTruthLayer }      from "@/lib/server/ai/truth/computeTruthLayer";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

function jsonOk(data: any)           { const r = NextResponse.json({ ok: true, ...data }); r.headers.set("Cache-Control", "no-store"); return r; }
function jsonErr(e: string, s = 400) { const r = NextResponse.json({ ok: false, error: e }, { status: s }); r.headers.set("Cache-Control", "no-store"); return r; }
function safeStr(x: any): string     { return typeof x === "string" ? x : x == null ? "" : String(x); }

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonErr("Unauthorized", 401);

    const body      = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    if (!projectId) return jsonErr("projectId required", 400);

    const { data: mem } = await supabase.from("project_members").select("role")
      .eq("project_id", projectId).eq("user_id", user.id).eq("is_active", true).maybeSingle();

    const admin = createAdminClient();
    const { data: proj } = await admin.from("projects").select("organisation_id, status").eq("id", projectId).maybeSingle();
    const orgId = safeStr(proj?.organisation_id) || null;

    let hasAccess = !!mem;
    if (!hasAccess && orgId) {
      const { data: orgMem } = await supabase.from("organisation_members").select("role")
        .eq("organisation_id", orgId).eq("user_id", user.id).is("removed_at", null).maybeSingle();
      hasAccess = !!orgMem;
    }
    if (!hasAccess) return jsonErr("Forbidden", 403);
    if (!orgId)     return jsonErr("Project has no organisation", 400);

    let signals, score;
    const latestSnapshot = await getLatestPremortemSnapshot(admin, projectId);

    if (latestSnapshot) {
      const snapshotSignals = latestSnapshot.signal_detail as any;
      signals = {
        project: { id: projectId, code: null, title: "Project", status: safeStr(proj?.status), finishDate: null },
        completeness: snapshotSignals?.completeness ?? { milestones: true, raid: true, approvals: true, financials: true, recentArtifacts: true },
        schedule:   snapshotSignals?.schedule   ?? { overdueCriticalCount: 0, overdueCount: 0, avgSlipDays: null, dueSoonAtRiskCount: 0, stagnatingCount: 0 },
        governance: snapshotSignals?.governance ?? { pendingApprovalCount: 0, overdueApprovalCount: 0, stuckChangeCount: 0, missingMandatoryArtifactCount: 0, staleWeeklyReport: false, gateGapCount: 0 },
        budget:     snapshotSignals?.budget      ?? { approvedBudget: null, actualSpend: null, forecastSpend: null, variancePct: null, unapprovedChangeValue: 0, financialPlanApproved: false },
        stability:  snapshotSignals?.stability  ?? { unresolvedIssueCount: 0, overdueRaidCount: 0, risingIssueTrend: false, lowRecentActivity: false, contradictoryStatus: false },
        evidence: [],
      };
      score = {
        failureRiskScore: latestSnapshot.failure_risk_score,
        failureRiskBand:  latestSnapshot.failure_risk_band as any,
        confidence:       latestSnapshot.confidence_score,
        direction:        (latestSnapshot.direction ?? "stable") as any,
        hiddenRisk:       latestSnapshot.hidden_risk,
        pillars: {
          schedule:   latestSnapshot.schedule_score,
          governance: latestSnapshot.governance_score,
          budget:     latestSnapshot.budget_score,
          stability:  latestSnapshot.stability_score,
        },
        topDrivers: latestSnapshot.top_drivers ?? [],
      };
    } else {
      signals = await buildPremortemSignals(admin, projectId);
      score   = scorePremortem(signals);
    }

    const decisions  = computeDecisionImpact(signals, score);
    const truthLayer = computeTruthLayer(signals, score, safeStr(proj?.status));

    return jsonOk({
      projectId,
      orgId,
      decisions,
      truthLayer,
      fromSnapshot: !!latestSnapshot,
      snapshotAge:  latestSnapshot
        ? Math.round((Date.now() - new Date(latestSnapshot.generated_at).getTime()) / 60000)
        : null,
    });

  } catch (e: any) {
    console.error("[premortem/decisions] error:", e);
    return jsonErr(safeStr(e?.message) || "Failed", 500);
  }
}

export async function GET(req: NextRequest) {
  try {
    const supabase  = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonErr("Unauthorized", 401);

    const url       = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    if (!projectId) return jsonErr("projectId required", 400);

    const body = { projectId };
    const fakeReq = new NextRequest(req.url, {
      method: "POST",
      body: JSON.stringify(body),
      headers: req.headers,
    });
    return POST(fakeReq);
  } catch (e: any) {
    return jsonErr(safeStr(e?.message) || "Failed", 500);
  }
}