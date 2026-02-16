// src/lib/orchestrator/handlers/stakeholder-to-dashboard.ts
import type { ArtifactEventLike } from "../types";

export function stakeholderEventToDashboardSuggestions(evt: ArtifactEventLike) {
  const rows = Array.isArray(evt?.payload?.rows) ? evt.payload.rows : [];
  if (!rows.length) return [];

  // crude scoring: count “high influence + low support”
  let highRiskCount = 0;
  for (const r of rows) {
    const influence = String(r?.influence ?? "").toLowerCase();
    const support = String(r?.support_level ?? r?.support ?? "").toLowerCase();
    const hi = ["high", "h", "3"].includes(influence);
    const low = ["low", "l", "1", "opposed", "blocker"].some((k) => support.includes(k));
    if (hi && low) highRiskCount++;
  }

  if (highRiskCount === 0) return [];

  const message =
    highRiskCount === 1
      ? "Stakeholder risk increasing: 1 high-influence stakeholder shows low support."
      : `Stakeholder risk increasing: ${highRiskCount} high-influence stakeholders show low support.`;

  return [
    {
      project_id: evt.project_id,
      source_event_id: evt.id,
      target_artifact_type: "status_dashboard",
      suggestion_type: "add_insight",
      confidence: 0.7,
      rationale: "Derived from Stakeholder Register update.",
      patch: {
        op: "append_row",
        table: "insights",
        value: {
          title: "Stakeholder risk increasing",
          message,
          severity: highRiskCount >= 2 ? "high" : "medium",
          created_at: new Date().toISOString(),
          source: { artifact_type: "stakeholder_register", event_id: evt.id },
        },
      },
    },
  ];
}
