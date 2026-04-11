// src/lib/server/gates/checkGate1.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

export type GateCriterionStatus = "pass" | "fail" | "warn";

export type GateCriterion = {
  id: string;
  label: string;
  description: string;
  status: GateCriterionStatus;
  detail?: string | null;
  href?: string | null;
};

export type Gate1Result = {
  ok: boolean;
  canProceed: boolean;   // true if all pass, or admin overriding
  passCount: number;
  failCount: number;
  warnCount: number;
  criteria: GateCriterion[];
  projectId: string;
  checkedAt: string;
};

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function checkGate1(projectId: string): Promise<Gate1Result> {
  const supabase = await createClient();
  const checkedAt = new Date().toISOString();

  const [
    charterRow,
    wbsRow,
    scheduleRow,
    stakeholderRow,
    financialRow,
    milestoneCount,
    riskCount,
    assumptionCount,
    dependencyCount,
  ] = await Promise.all([

    // 1. Project Charter — must exist and be approved (check both artifact_type and type columns)
    supabase
      .from("artifacts")
      .select("id, approval_status, title")
      .eq("project_id", projectId)
      .or("artifact_type.eq.project_charter,type.eq.PROJECT_CHARTER")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 2. WBS — must exist with content (check both artifact_type and type columns)
    supabase
      .from("artifacts")
      .select("id, content_json, title")
      .eq("project_id", projectId)
      .or("artifact_type.eq.wbs,type.eq.WBS")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 3. Schedule — must exist (check both artifact_type and type columns)
    supabase
      .from("artifacts")
      .select("id, title")
      .eq("project_id", projectId)
      .or("artifact_type.eq.schedule,type.eq.SCHEDULE")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 4. Stakeholder Register — must exist (check both artifact_type and type columns)
    supabase
      .from("artifacts")
      .select("id, title")
      .eq("project_id", projectId)
      .or("artifact_type.eq.stakeholder_register,type.eq.STAKEHOLDER_REGISTER")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 5. Financial Plan — must exist and be approved (uses type not artifact_type)
    supabase
      .from("artifacts")
      .select("id, approval_status, title")
      .eq("project_id", projectId)
      .eq("type", "FINANCIAL_PLAN")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // 3b. Schedule milestones count
    supabase
      .from("schedule_milestones")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),

    // 6. RAID — at least 1 risk
    supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .ilike("type", "risk"),

    // 7. RAID — at least 1 assumption
    supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .ilike("type", "assumption"),

    // 8. RAID — at least 1 dependency
    supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .ilike("type", "dependency"),
  ]);

  const charter      = charterRow.data;
  const wbs          = wbsRow.data;
  const schedule     = scheduleRow.data;
  const stakeholder  = stakeholderRow.data;
  const financial    = financialRow.data;
  const milestones   = milestoneCount.count ?? 0;
  const risks        = riskCount.count ?? 0;
  const assumptions  = assumptionCount.count ?? 0;
  const dependencies = dependencyCount.count ?? 0;

  // Check WBS has actual rows in content_json
  const wbsRows = (() => {
    try {
      const cj = wbs?.content_json as any;
      if (Array.isArray(cj?.rows)) return cj.rows.length;
      if (Array.isArray(cj)) return cj.length;
      return 0;
    } catch { return 0; }
  })();

  const criteria: GateCriterion[] = [
    {
      id: "charter",
      label: "Project Charter",
      description: "Must exist and be approved",
      status: !charter
        ? "fail"
        : charter.approval_status === "approved"
          ? "pass"
          : "warn",
      detail: !charter
        ? "No project charter found. Create and submit a charter for approval."
        : charter.approval_status === "approved"
          ? "Charter approved."
          : `Charter exists but is currently "${charter.approval_status}". It must be approved before Gate 1.`,
      href: charter ? `/projects/${projectId}/artifacts` : `/projects/${projectId}/artifacts`,
    },
    {
      id: "wbs",
      label: "Work Breakdown Structure",
      description: "Must exist with at least one work package",
      status: !wbs ? "fail" : wbsRows === 0 ? "warn" : "pass",
      detail: !wbs
        ? "No WBS found. Create a work breakdown structure."
        : wbsRows === 0
          ? "WBS exists but has no work packages. Add deliverables before baselining."
          : `WBS has ${wbsRows} work package${wbsRows !== 1 ? "s" : ""}.`,
      href: wbs ? `/projects/${projectId}/artifacts/${wbs.id}` : `/projects/${projectId}/artifacts`,
    },
    {
      id: "schedule",
      label: "Schedule",
      description: "Must exist with at least one milestone",
      status: !schedule ? "fail" : milestones === 0 ? "warn" : "pass",
      detail: !schedule
        ? "No schedule found. Create a project schedule."
        : milestones === 0
          ? "Schedule exists but has no milestones. Add at least one milestone."
          : `Schedule has ${milestones} milestone${milestones !== 1 ? "s" : ""}.`,
      href: schedule ? `/projects/${projectId}/artifacts/${schedule.id}` : `/projects/${projectId}/artifacts`,
    },
    {
      id: "stakeholder_register",
      label: "Stakeholder Register",
      description: "Must exist",
      status: !stakeholder ? "fail" : "pass",
      detail: !stakeholder
        ? "No stakeholder register found. Create a stakeholder register."
        : "Stakeholder register exists.",
      href: stakeholder
        ? `/projects/${projectId}/artifacts/${stakeholder.id}`
        : `/projects/${projectId}/artifacts`,
    },
    {
      id: "financial_plan",
      label: "Financial Plan",
      description: "Must exist and be approved",
      status: !financial
        ? "fail"
        : financial.approval_status === "approved"
          ? "pass"
          : "warn",
      detail: !financial
        ? "No financial plan found. Create and submit a financial plan for approval."
        : financial.approval_status === "approved"
          ? "Financial plan approved."
          : `Financial plan exists but is currently "${financial.approval_status}". It must be approved before Gate 1.`,
      href: financial ? `/projects/${projectId}/artifacts/${financial.id}` : `/projects/${projectId}/artifacts`,
    },
    {
      id: "raid_risks",
      label: "Risk Register",
      description: "At least 1 risk must be logged",
      status: risks === 0 ? "fail" : "pass",
      detail: risks === 0
        ? "No risks logged. Identify and log at least one project risk."
        : `${risks} risk${risks !== 1 ? "s" : ""} logged.`,
      href: `/projects/${projectId}/raid`,
    },
    {
      id: "raid_assumptions",
      label: "Assumptions",
      description: "At least 1 assumption must be logged",
      status: assumptions === 0 ? "fail" : "pass",
      detail: assumptions === 0
        ? "No assumptions logged. Log at least one project assumption."
        : `${assumptions} assumption${assumptions !== 1 ? "s" : ""} logged.`,
      href: `/projects/${projectId}/raid`,
    },
    {
      id: "raid_dependencies",
      label: "Dependencies",
      description: "At least 1 dependency must be logged",
      status: dependencies === 0 ? "fail" : "pass",
      detail: dependencies === 0
        ? "No dependencies logged. Log at least one project dependency."
        : `${dependencies} dependenc${dependencies !== 1 ? "ies" : "y"} logged.`,
      href: `/projects/${projectId}/raid`,
    },
  ];

  const passCount = criteria.filter((c) => c.status === "pass").length;
  const failCount = criteria.filter((c) => c.status === "fail").length;
  const warnCount = criteria.filter((c) => c.status === "warn").length;

  return {
    ok: true,
    canProceed: failCount === 0 && warnCount === 0,
    passCount,
    failCount,
    warnCount,
    criteria,
    projectId,
    checkedAt,
  };
}