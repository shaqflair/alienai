// src/lib/artifact-types.ts

/**
 * Canonical Artifact Types used by the app.
 * Keep these in sync with artifact_definitions.key and artifacts.type.
 *
 * NOTE: Using string union + const list keeps server actions safe.
 */

export const ARTIFACT_TYPES = [
  "PROJECT_CHARTER",
  "STAKEHOLDER_REGISTER",
  "WBS",
  "SCHEDULE",
  "RAID",
  "CHANGE_REQUESTS",
  "LESSONS_LEARNED",
  "PROJECT_CLOSURE_REPORT",

  // ✅ New
  "WEEKLY_REPORT",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];
