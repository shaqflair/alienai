import type { OrchestratorStep } from "./types";

import { validateArtifact } from "./steps/validateArtifact";
import { deriveRisks } from "./steps/deriveRisks";
import { narrative } from "./steps/narrative";

export const ORCHESTRATOR_STEPS: OrchestratorStep[] = [
  validateArtifact,
  deriveRisks,
  narrative,
];
