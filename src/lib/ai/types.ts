// src/lib/ai/types.ts
export type EventSeverity = "info" | "warning" | "critical";

export type ProjectEvent = {
  id: string;
  project_id: string;
  artifact_id?: string | null;
  section_key?: string | null;

  event_type: string;
  actor_user_id?: string | null;
  source: "app" | "system" | "import" | "ai";
  severity: EventSeverity;

  payload: any;
  created_at: string;
};

export type SuggestionType = "improve" | "risk" | "compliance" | "financial" | "consistency";
export type SuggestionSeverity = "low" | "medium" | "high";
export type SuggestionStatus = "proposed" | "applied" | "dismissed";

export type AiSuggestion = {
  id: string;
  project_id: string;
  artifact_id?: string | null;
  section_key?: string | null;

  suggestion_type: SuggestionType;
  severity: SuggestionSeverity;

  title: string;
  body: string;

  rationale: string;
  evidence: any;
  recommended_patch?: any | null;

  status: SuggestionStatus;

  triggered_by_event_id?: string | null;
  trigger_key: string;

  created_at: string;
  updated_at: string;
};

export type TriggerContext = {
  projectId: string;
  artifactId?: string | null;
  sectionKey?: string | null;
  event: ProjectEvent;
};

export type TriggerResult = {
  trigger_key: string;
  suggestion_type: SuggestionType;
  severity: SuggestionSeverity;

  title: string;
  body: string;
  rationale: string;

  evidence?: any;
  recommended_patch?: any | null;
};
