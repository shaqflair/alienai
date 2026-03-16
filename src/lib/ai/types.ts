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

export type SuggestionType =
  | "improve"
  | "risk"
  | "compliance"
  | "financial"
  | "consistency"
  // legacy-safe / engine-safe extension points already used by existing flows
  | "add_stakeholder";

export type SuggestionSeverity = "low" | "medium" | "high";

/**
 * Canonical DB / engine status values.
 */
export type SuggestionStatus = "proposed" | "applied" | "dismissed";

/**
 * Backward-compatible status aliases still tolerated by API/UI/apply-reject flows.
 * We do not force the rest of the app to use these, but typing them here keeps
 * route/panel compatibility while contracts are being aligned.
 */
export type SuggestionStatusCompat =
  | SuggestionStatus
  | "suggested"
  | "rejected"
  | "all";

export type AiSuggestion = {
  id: string;
  project_id: string;
  artifact_id?: string | null;
  section_key?: string | null;

  /**
   * Used by panel filtering and apply/reject routes.
   * Must be populated for artifact-scoped suggestions such as closure report rules.
   */
  target_artifact_type?: string | null;

  suggestion_type: SuggestionType;
  severity: SuggestionSeverity;

  title: string;
  body: string;

  /**
   * Legacy explanation field kept for compatibility with existing consumers.
   * In newer engine output, body/title are primary and rationale is supporting text.
   */
  rationale: string;
  evidence: any;

  /**
   * Canonical engine/DB patch field.
   */
  recommended_patch?: any | null;

  /**
   * Backward-compatible alias expected by existing apply/API consumers.
   * The engine may populate recommended_patch and the API can map it to patch.
   */
  patch?: any | null;

  /**
   * Canonical persisted status. Some older consumers may still read/write
   * "suggested" or "rejected", so compatibility handling should remain in routes.
   */
  status: SuggestionStatus | SuggestionStatusCompat;

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

  /**
   * Needed so inserted suggestions can still appear when panel/API filters by artifact type.
   */
  target_artifact_type?: string | null;

  suggestion_type: SuggestionType;
  severity: SuggestionSeverity;

  title: string;
  body: string;
  rationale: string;

  evidence?: any;

  /**
   * Canonical engine patch payload.
   */
  recommended_patch?: any | null;

  /**
   * Optional compatibility alias. Trigger engine can populate either or both,
   * and persistence code can normalize before insert.
   */
  patch?: any | null;
};