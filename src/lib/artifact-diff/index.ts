import type { ArtifactDiffV1 } from "@/types/artifact-diff";
import { computeCharterV2Diff } from "./computeCharterV2Diff";

/**
 * Main entry point.
 * Today: Charter v2 structured diff.
 * Later: route by artifact type to different diff engines.
 */
export function computeArtifactDiff(base: unknown, head: unknown): ArtifactDiffV1 {
  // Auto-detect Charter v2 by shape inside computeCharterV2Diff
  return computeCharterV2Diff(base, head, {
    artifactType: "PROJECT_CHARTER",
    baseRevision: 0,
    headRevision: 0,
  });
}

export { computeCharterV2Diff } from "./computeCharterV2Diff";
export { normalizeCharterV2 } from "./normalizeCharterV2";
