// src/lib/orchestrator/types.ts
export type OrchestratorContext = {
  projectId?: string;
  artifactId?: string;
  artifactType?: string;
  artifactJson: any;
  meta?: Record<string, any>;
};
export type OrchestratorResult = {
  ok?: boolean;
  messages?: string[];
  data?: any;
  processed?: number;
  failed?: number;
  last_event_id?: string | null;
};
export type OrchestratorStep = {
  key: string;
  run: (ctx: OrchestratorContext) => Promise<OrchestratorResult>;
};
export type ArtifactEventLike = {
  id: string;
  artifact_id: string;
  event_type?: string;
  payload?: any;
  created_at?: string;
  project_id?: string;
};
export type ArtifactEventRow = ArtifactEventLike & {
  project_id: string;
  artifact_type?: string;
  action?: string;
};
export type SuggestionInsert = {
  project_id: string;
  artifact_id?: string;
  suggestion_type: string;
  payload?: any;
  status?: string;
  patch?: unknown;
  confidence?: number;
  rationale?: string;
  target_artifact_id?: string | null;
  target_artifact_type?: string | null;
  source_event_id?: string | null;
};
export type OrchestratorOptions = {
  projectId?: string;
  artifactId?: string;
  artifactType?: string;
  steps?: OrchestratorStep[];
  limit?: number;
  dryRun?: boolean;
};
export type OrchestratorRunResult = OrchestratorResult;
export type ArtifactEventPayload = {
  eventId: string;
  artifactId?: string;
  projectId?: string;
  eventType: string;
  payload: any;
};