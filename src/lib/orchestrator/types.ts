// src/lib/orchestrator/types.ts

export type OrchestratorContext = {
  projectId: string;
  artifactId: string;
  artifactType: string;
  artifactJson: any;
  meta?: Record<string, any>;
};

export type OrchestratorResult = {
  ok: boolean;
  messages: string[];
  data?: any;
};

export type OrchestratorStep = {
  key: string;
  run: (ctx: OrchestratorContext) => Promise<OrchestratorResult>;
};

// FIX: Added missing exports that are imported by other files
export type ArtifactEventLike = {
  id: string;
  artifact_id: string;
  event_type: string;
  payload?: any;
  created_at?: string;
};

export type ArtifactEventRow = ArtifactEventLike & {
  project_id: string;
  processed?: boolean;
};

export type SuggestionInsert = {
  project_id: string;
  artifact_id: string;
  suggestion_type: string;
  payload: any;
  status?: string;
};

export type OrchestratorOptions = {
  projectId: string;
  artifactId: string;
  artifactType: string;
  steps?: OrchestratorStep[];
};

// FIX: Added alias for backward compatibility
export type OrchestratorRunResult = OrchestratorResult;

// FIX: Added missing handler types
export type ArtifactEventPayload = {
  eventId: string;
  artifactId: string;
  projectId: string;
  eventType: string;
  payload: any;
};