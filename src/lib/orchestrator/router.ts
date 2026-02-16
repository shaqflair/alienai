import "server-only";

import type { ArtifactEventRow, SuggestionInsert } from "./types";

export function routeEventToSuggestions(evt: ArtifactEventRow): SuggestionInsert[] {
  const artifactType = String(evt.artifact_type || "").toLowerCase();
  const action = String(evt.action || "").toLowerCase();

  // 1) Project Charter → seed downstream artifacts
  if (artifactType === "project_charter" && (action === "created" || action === "updated")) {
    return [
      {
        project_id: evt.project_id,
        source_event_id: evt.id,
        target_artifact_id: null,
        target_artifact_type: "stakeholder_register",
        suggestion_type: "narrative",
        patch: null,
        rationale:
          "Charter changed. Suggest seeding stakeholder register with sponsor, PM, customer reps, delivery leads, and key approvers.",
        confidence: 0.75,
      },
      {
        project_id: evt.project_id,
        source_event_id: evt.id,
        target_artifact_type: "schedule",
        suggestion_type: "narrative",
        patch: null,
        rationale:
          "Charter changed. Suggest drafting initial milestones (kickoff, design complete, build complete, UAT, go-live) aligned to start/end dates.",
        confidence: 0.72,
      },
      {
        project_id: evt.project_id,
        source_event_id: evt.id,
        target_artifact_type: "raid",
        suggestion_type: "narrative",
        patch: null,
        rationale:
          "Charter changed. Suggest seeding RAID with typical startup risks (resource availability, approvals, scope creep, environment access, vendor lead times).",
        confidence: 0.7,
      },
    ];
  }

  // 2) Stakeholder Register → RAID (patch) + Dashboard narrative
  if (artifactType === "stakeholder_register" && (action === "created" || action === "updated")) {
    const stakeholders = evt.payload?.stakeholders ?? [];
    const suggestions: SuggestionInsert[] = [];

    // Stakeholder → RAID risk patch suggestions
    for (const s of stakeholders) {
      const influence = String(s?.influence ?? "").toLowerCase();
      const interest = String(s?.interest ?? "").toLowerCase();

      if (influence === "high" && interest !== "high") {
        suggestions.push({
          project_id: evt.project_id,
          source_event_id: evt.id,
          target_artifact_type: "raid",
          suggestion_type: "patch",
          confidence: 0.82,
          rationale: `High-influence stakeholder (${s.name}) shows low engagement. Risk of late escalation or delivery blockage.`,
          patch: {
            type: "raid.add",
            data: {
              category: "Stakeholder",
              description: `${s.name} may block or delay progress due to low engagement.`,
              impact: "High",
              probability: "Medium",
              mitigation: "Increase engagement cadence and clarify expectations.",
              owner: s.owner ?? null,
            },
          },
        });
      }
    }

    // Stakeholder → Dashboard narrative suggestion
    const highRiskNames = stakeholders
      .filter(
        (x: any) =>
          String(x?.influence ?? "").toLowerCase() === "high" &&
          String(x?.interest ?? "").toLowerCase() !== "high"
      )
      .map((x: any) => x?.name)
      .filter(Boolean);

    if (highRiskNames.length > 0) {
      suggestions.push({
        project_id: evt.project_id,
        source_event_id: evt.id,
        target_artifact_type: "dashboard",
        suggestion_type: "narrative",
        confidence: 0.75,
        rationale: "Stakeholder engagement imbalance detected",
        patch: {
          type: "dashboard.narrative",
          data: {
            message: `⚠ Stakeholder risk increasing: ${highRiskNames.join(
              ", "
            )} have high influence but insufficient engagement.`,
            severity: "amber",
          },
        },
      });
    }

    return suggestions;
  }

  return [];
}
