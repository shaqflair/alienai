export type ArtifactAction =
  | "created"
  | "updated"
  | "deleted"
  | "submitted"
  | "approved"
  | "changes_requested"
  | "rejected";

export type ArtifactType =
  | "project_charter"
  | "stakeholder_register"
  | "wbs"
  | "schedule"
  | "raid"
  | "change_request_log"
  | "status_dashboard"
  | "lessons_learned";

export type ArtifactEvent = {
  project_id: string;
  artifact_id: string;
  artifact_type: ArtifactType;
  action: ArtifactAction;
  payload?: Record<string, any>;
  actor_user_id?: string | null;
};
