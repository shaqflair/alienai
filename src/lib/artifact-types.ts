// src/lib/artifact-types.ts
import "server-only";

/**
 * Artifact Types
 * - This file MUST remain pure TypeScript (NO JSX / React imports).
 * - Used for validation in server actions and API routes.
 *
 * Notes:
 * - We include legacy aliases ("change", "change_request") so older rows/URLs
 *   don’t crash validation.
 * - Canonical UI should prefer: "change_requests"
 */

export const ARTIFACT_TYPES = [
  // Plan
  "project_charter",
  "stakeholder_register",
  "wbs",
  "schedule",
  "weekly_report",

  // Control
  "raid",
  "change_requests",

  // Legacy / aliases (keep for back-compat)
  "change_request",
  "change",

  // Close
  "lessons_learned",
  "project_closure_report",
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** Helpful for normalizing incoming params (optional use). */
export function normalizeArtifactType(input: unknown): ArtifactType | null {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return null;

  const v = raw.toLowerCase().replace(/\s+/g, "_");

  // Common aliases → canonical where appropriate
  if (v === "change_requests" || v === "change_request" || v === "change") return "change_requests";

  // Accept known types
  return (ARTIFACT_TYPES as readonly string[]).includes(v) ? (v as ArtifactType) : null;
}