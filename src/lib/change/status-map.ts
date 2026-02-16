import type { ChangeStatus } from "@/lib/change/types";

export type DbChangeStatus = "draft" | "submitted" | "approved" | "changes_requested" | "rejected";

export function uiToDbStatus(ui: ChangeStatus): DbChangeStatus {
  switch (ui) {
    case "new":
    case "analysis":
      return "draft";
    case "review":
      return "submitted";
    case "in_progress":
    case "implemented":
    case "closed":
      return "approved";
    default:
      return "draft";
  }
}

export function dbToUiStatus(db: string | null | undefined): ChangeStatus {
  const s = String(db ?? "").toLowerCase();
  if (s === "draft") return "new";
  if (s === "submitted") return "review";
  if (s === "approved") return "in_progress";
  if (s === "changes_requested") return "analysis";
  if (s === "rejected") return "new";
  return "new";
}
