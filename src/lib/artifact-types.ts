// src/lib/artifact-types.ts
// ✅ FIX: Added FINANCIAL_PLAN to ARTIFACT_TYPES so isArtifactType() accepts it
// Previously caused: Error: Invalid artifact type (digest 3431537679)

export const ARTIFACT_TYPES = [
  "PROJECT_CHARTER",
  "SCOPE_STATEMENT",
  "REQUIREMENTS",
  "STAKEHOLDER_REGISTER",
  "COMMUNICATION_PLAN",
  "RISK_REGISTER",
  "ISSUE_LOG",
  "CHANGE_LOG",
  "MILESTONE_PLAN",
  "WBS",
  "RESOURCE_PLAN",
  "BUDGET_PLAN",
  "FINANCIAL_PLAN",        // ✅ NEW — was missing, caused Invalid artifact type crash
  "LESSONS_LEARNED",
  "WEEKLY_REPORT",
  "STATUS_REPORT",
  "CLOSE_OUT_REPORT",
  "BENEFITS_REALISATION",
  "QUALITY_PLAN",
  "PROCUREMENT_PLAN",
  "TRANSITION_PLAN",
  "PIR",
] as const;

export type ArtifactType = typeof ARTIFACT_TYPES[number];