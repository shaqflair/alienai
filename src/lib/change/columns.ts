import type { ChangeStatus } from "./types";

export const CHANGE_COLUMNS: { key: ChangeStatus; title: string }[] = [
  { key: "new", title: "New (Intake)" },
  { key: "analysis", title: "Analysis (AI Impact)" },
  { key: "review", title: "Review (Approval)" },
  { key: "in_progress", title: "In Progress" },
  { key: "implemented", title: "Implemented" },
  { key: "closed", title: "Closed" },
];
