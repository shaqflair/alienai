import "server-only";

/**
 * Offline mock generator so you can complete the build without any paid API.
 * Returns valid-looking content and can emit canonical v2 charter JSON when prompted.
 */
export function mockGenerate(prompt: string): string {
  const p = String(prompt || "").toLowerCase();

  // If prompt hints at charter v2 / JSON schema, return canonical v2
  if (
    p.includes("project_charter") ||
    p.includes("project charter") ||
    p.includes("charter") ||
    p.includes("version") ||
    p.includes("sections") ||
    p.includes("content_json") ||
    p.includes("meta")
  ) {
    return JSON.stringify(
      {
        version: 2,
        type: "project_charter",
        meta: {
          project_title: "Mock Project Charter",
          project_manager: "Alex",
          project_sponsor: "Sponsor Name",
          customer_account: "Customer Account",
          project_start_date: "2026-01-01",
          project_end_date: "2026-06-30",
        },
        sections: [
          {
            key: "overview",
            title: "Project Overview",
            bullets:
              "• Purpose: Demonstrate end-to-end charter flow\n• Scope: Mock content for UI testing\n• Success: Autosave + approvals + export routes work",
          },
          {
            key: "objectives",
            title: "Objectives",
            bullets:
              "• Establish governance\n• Deliver baseline plan\n• Enable reporting\n• Support approvals workflow",
          },
          {
            key: "scope",
            title: "Scope",
            table: {
              columns: 2,
              rows: [
                { type: "header", cells: ["In Scope", "Out of Scope"] },
                { type: "data", cells: ["Core delivery milestones", "Unfunded enhancements"] },
                { type: "data", cells: ["RAID + approvals workflow", "New vendor onboarding"] },
              ],
            },
          },
          {
            key: "milestones",
            title: "Milestones",
            table: {
              columns: 3,
              rows: [
                { type: "header", cells: ["Milestone", "Target Date", "Owner"] },
                { type: "data", cells: ["Kickoff", "2026-01-05", "PMO"] },
                { type: "data", cells: ["Design Complete", "2026-02-15", "Engineering"] },
                { type: "data", cells: ["Go Live", "2026-06-15", "Programme Lead"] },
              ],
            },
          },
          {
            key: "risks",
            title: "Key Risks",
            bullets:
              "• Dependency delays\n• Scope creep\n• Resource constraints\n• Environment readiness",
          },
        ],
      },
      null,
      2
    );
  }

  // Default plain text output
  return [
    "MOCK AI OUTPUT",
    "",
    "Here’s a project charter outline you can use to complete the build:",
    "1) Overview",
    "2) Objectives",
    "3) Scope (In/Out)",
    "4) Stakeholders & RACI",
    "5) Milestones",
    "6) Risks, Assumptions, Dependencies",
    "7) Budget & Benefits",
    "8) Approvals",
  ].join("\n");
}
