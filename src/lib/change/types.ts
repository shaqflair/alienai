export type ChangeStatus =
  | "new"
  | "analysis"
  | "review"
  | "in_progress"
  | "implemented"
  | "closed";

export type ChangePriority = "Low" | "Medium" | "High" | "Critical";

export type AiImpact = {
  days: number;
  cost: number;
  risk: string;
};

export type ChangeItem = {
  id: string;              // CR-001 etc (UI id)
  dbId?: string;           // uuid if coming from DB
  title: string;
  requester: string;
  summary: string;
  status: ChangeStatus;
  priority: ChangePriority;
  tags: string[];

  aiImpact: AiImpact;

  // form-only details (optional)
  justification?: string;
  financial?: string;
  schedule?: string;
  risks?: string;
  dependencies?: string;
};
