/**
 * Canonical deterministic artifact events.
 * Facts only — no AI calls.
 */

export type StakeholderEventType =
  | "new_stakeholder_added"
  | "stakeholder_updated"
  | "influence_changed"
  | "external_high_influence";

export type ArtifactEvent =
  | {
      artifact: "stakeholder_register";
      event_type: StakeholderEventType;
      project_id: string;
      payload: {
        stakeholder_id: string;
        before?: any | null;
        after: any;
      };
    };

export function buildStakeholderEvent(params: {
  projectId: string;
  eventType: StakeholderEventType;
  stakeholderId: string;
  after: any;
  before?: any | null;
}): ArtifactEvent {
  return {
    artifact: "stakeholder_register",
    event_type: params.eventType,
    project_id: params.projectId,
    payload: {
      stakeholder_id: params.stakeholderId,
      before: params.before ?? null,
      after: params.after,
    },
  };
}
