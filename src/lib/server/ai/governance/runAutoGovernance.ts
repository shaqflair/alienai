import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GovernanceActionType =
  | "escalate_approval"
  | "nudge_raid_owner"
  | "request_status_update"
  | "route_change_request"
  | "flag_false_green"
  | "request_artifact_approval";

export type GovernanceActionStatus = "pending" | "sent" | "acknowledged" | "resolved" | "escalated" | "dismissed";

export type GovernanceAction = {
  id?:               string;
  project_id:        string;
  organisation_id:  string;
  action_type:       GovernanceActionType;
  title:             string;
  detail:            string;
  owner_user_id:     string | null;
  owner_label:       string;
  target_ref_type:   string | null;  // "approval", "raid_item", "artifact", "change_request"
  target_ref_id:     string | null;
  priority:          "critical" | "high" | "medium";
  status:            GovernanceActionStatus;
  escalation_hours: number;
  escalate_to_user_id: string | null;
  auto_created:       boolean;
  created_at?:       string;
  due_by?:           string | null;
};

export type AutoGovernanceResult = {
  project_id:       string;
  project_title:    string;
  actions_created: number;
  actions_updated: number;
  actions:          GovernanceAction[];
  summary:          string;
};

function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any): number {
  const n = Number(x); return Number.isFinite(n) ? n : 0;
}
function hoursAgo(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 3600000;
}
function dueDateISO(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3600000).toISOString();
}

export async function runAutoGovernance(
  supabase: SupabaseClient,
  projectId: string,
  orgId: string,
): Promise<AutoGovernanceResult> {
  const actions: GovernanceAction[] = [];

  // 1. Fetch project
  const { data: proj } = await supabase
    .from("projects")
    .select("id, title, status, pm_user_id, pm_name, sponsor_user_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!proj) return { project_id: projectId, project_title: "Unknown", actions_created: 0, actions_updated: 0, actions: [], summary: "Project not found" };

  const projectTitle = safeStr(proj.title);
  const pmUserId     = proj.pm_user_id ?? null;
  const sponsorId    = proj.sponsor_user_id ?? null;

  // 2. Fetch existing pending actions to avoid duplicates
  const { data: existingActions } = await supabase
    .from("ai_governance_actions")
    .select("action_type, target_ref_id, status")
    .eq("project_id", projectId)
    .in("status", ["pending", "sent"]);

  const existingSet = new Set(
    (existingActions ?? []).map((a: any) => `${a.action_type}:${a.target_ref_id ?? ""}`)
  );

  function alreadyExists(type: GovernanceActionType, refId?: string | null): boolean {
    return existingSet.has(`${type}:${refId ?? ""}`);
  }

  // --- GOVERNANCE CHECKS ---

  // Overdue approvals (48h SLA)
  const { data: approvals } = await supabase
    .from("approval_requests")
    .select("id, step_label, current_approver_user_id, created_at, due_date, artifact_id, artifact_type")
    .eq("project_id", projectId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  for (const ap of (approvals ?? [])) {
    const ageHours = hoursAgo(safeStr(ap.created_at));
    const slaHours = 48;
    if (ageHours < slaHours) continue;
    if (alreadyExists("escalate_approval", ap.id)) continue;

    actions.push({
      project_id:         projectId,
      organisation_id:    orgId,
      action_type:        "escalate_approval",
      title:              `Approval overdue: ${safeStr(ap.step_label) || "Pending approval"}`,
      detail:              `Approval has been pending for ${Math.round(ageHours)} hours (SLA: ${slaHours}h). Escalating to approver and project sponsor.`,
      owner_user_id:      ap.current_approver_user_id ?? pmUserId,
      owner_label:        ap.current_approver_user_id ? "Assigned approver" : safeStr(proj.pm_name) || "PM",
      target_ref_type:    "approval",
      target_ref_id:      ap.id,
      priority:            ageHours > 96 ? "critical" : "high",
      status:              "pending",
      escalation_hours:    24,
      escalate_to_user_id: sponsorId,
      auto_created:        true,
      due_by:              dueDateISO(24),
    });
  }

  // Overdue Critical/High RAID items
  const { data: raidItems } = await supabase
    .from("raid_items")
    .select("id, type, title, owner_label, owner_user_id, due_date, status, priority")
    .eq("project_id", projectId)
    .in("status", ["Open", "In Progress"])
    .not("due_date", "is", null)
    .lt("due_date", new Date().toISOString().slice(0, 10));

  for (const item of (raidItems ?? [])) {
    if (item.priority !== "Critical" && item.priority !== "High") continue;
    if (alreadyExists("nudge_raid_owner", item.id)) continue;

    actions.push({
      project_id:         projectId,
      organisation_id:    orgId,
      action_type:        "nudge_raid_owner",
      title:              `Overdue ${safeStr(item.type)}: ${safeStr(item.title)}`,
      detail:              `This ${safeStr(item.type).toLowerCase()} is past its due date and has no resolution. Nudging owner to update status.`,
      owner_user_id:      item.owner_user_id ?? pmUserId,
      owner_label:        safeStr(item.owner_label) || safeStr(proj.pm_name) || "PM",
      target_ref_type:    "raid_item",
      target_ref_id:      item.id,
      priority:            item.priority === "Critical" ? "critical" : "high",
      status:              "pending",
      escalation_hours:    48,
      escalate_to_user_id: pmUserId,
      auto_created:        true,
      due_by:              dueDateISO(48),
    });
  }

  // Stale reporting (14 days)
  const { data: recentArtifacts } = await supabase
    .from("artifacts")
    .select("id, updated_at")
    .eq("project_id", projectId)
    .eq("is_current", true)
    .order("updated_at", { ascending: false })
    .limit(1);

  const lastUpdate = recentArtifacts?.[0]?.updated_at;
  if (lastUpdate && hoursAgo(lastUpdate) > 336 && !alreadyExists("request_status_update", projectId)) {
    actions.push({
      project_id:         projectId,
      organisation_id:    orgId,
      action_type:        "request_status_update",
      title:              "Project reporting is stale — update required",
      detail:              `No project documentation has been updated in ${Math.round(hoursAgo(lastUpdate) / 24)} days. Requesting a status update.`,
      owner_user_id:      pmUserId,
      owner_label:        safeStr(proj.pm_name) || "Project Manager",
      target_ref_type:    null,
      target_ref_id:      projectId,
      priority:            "medium",
      status:              "pending",
      escalation_hours:    72,
      escalate_to_user_id: sponsorId,
      auto_created:        true,
      due_by:              dueDateISO(72),
    });
  }

  // False-green detection (Truth Layer alert)
  const { data: latestSnapshot } = await supabase
    .from("ai_premortem_snapshots")
    .select("failure_risk_score, hidden_risk, failure_risk_band")
    .eq("project_id", projectId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const declaredStatus = safeStr(proj.status).toLowerCase();
  const isGreen = declaredStatus === "green" || declaredStatus === "active" || declaredStatus === "on track";

  if (latestSnapshot && (latestSnapshot.hidden_risk || (isGreen && Number(latestSnapshot.failure_risk_score) >= 50))) {
    if (!alreadyExists("flag_false_green", projectId)) {
      actions.push({
        project_id:         projectId,
        organisation_id:    orgId,
        action_type:        "flag_false_green",
        title:              "Status mismatch — Truth Layer alert",
        detail:              `Project is reported as ${proj.status} but Pre-Mortem AI scores risk at ${latestSnapshot.failure_risk_score}/100. Recommend status review.`,
        owner_user_id:      pmUserId,
        owner_label:        safeStr(proj.pm_name) || "PM",
        target_ref_type:    null,
        target_ref_id:      projectId,
        priority:            "critical",
        status:              "pending",
        escalation_hours:    24,
        escalate_to_user_id: sponsorId,
        auto_created:        true,
        due_by:              dueDateISO(24),
      });
    }
  }

  // Persist actions
  let created = 0;
  for (const action of actions) {
    const { error } = await supabase.from("ai_governance_actions").insert({
      project_id:            action.project_id,
      organisation_id:       action.organisation_id,
      action_type:           action.action_type,
      title:                 action.title,
      detail:                action.detail,
      owner_user_id:         action.owner_user_id,
      owner_label:           action.owner_label,
      target_ref_type:       action.target_ref_type,
      target_ref_id:         action.target_ref_id,
      priority:              action.priority,
      status:                action.status,
      escalation_hours:      action.escalation_hours,
      escalate_to_user_id:   action.escalate_to_user_id,
      auto_created:          action.auto_created,
      due_by:                action.due_by,
    });
    if (!error) created++;
  }

  const summary = actions.length === 0
    ? "No governance gaps detected."
    : `${actions.length} action(s) created: ${actions.map(a => a.action_type).join(", ")}.`;

  return { project_id: projectId, project_title: projectTitle, actions_created: created, actions_updated: 0, actions, summary };
}

export async function runPortfolioAutoGovernance(
  supabase: SupabaseClient,
  orgId: string,
): Promise<{ total_actions: number; projects_scanned: number; results: AutoGovernanceResult[] }> {
  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .not("status", "in", '("closed","archived")');

  const results: AutoGovernanceResult[] = [];
  let total = 0;

  for (const proj of (projects ?? [])) {
    const result = await runAutoGovernance(supabase, proj.id, orgId);
    results.push(result);
    total += result.actions_created;
  }

  return { total_actions: total, projects_scanned: projects?.length ?? 0, results };
}