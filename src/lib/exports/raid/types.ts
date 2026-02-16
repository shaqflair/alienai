import "server-only";

/**
 * RAID Item Definition
 * Standardizes the structure for Risks, Issues, Assumptions, and Dependencies
 * for use across all export formats.
 */
export type RaidItem = {
  id: string;
  type: "risk" | "issue" | "assumption" | "dependency" | string;
  title: string;
  owner?: string | null;
  status?: string | null;
  due_date?: string | null;
  impact?: string | null;
  probability?: string | null;
  severity?: string | null;
  description?: string | null;
  mitigation?: string | null;
  created_at?: string | null;
};
