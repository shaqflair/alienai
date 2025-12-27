// src/components/editors/charter-template.ts

type JSONDoc = any;

/* ------------------------------
   Legacy (v1) Table Template
   (Used for Classic view / export fallback)
------------------------------ */

function p(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function cell(text: string, attrs: any = undefined) {
  const base: any = { type: "tableCell", content: [p(text)] };
  if (attrs) base.attrs = attrs;
  return base;
}

function th(text: string, attrs: any = undefined) {
  const base: any = { type: "tableHeader", content: [p(text)] };
  if (attrs) base.attrs = attrs;
  return base;
}

function row(cells: any[]) {
  return { type: "tableRow", content: cells };
}

/**
 * v1: Tiptap doc/table
 * Keep this for:
 * - Classic preview renderer (table look)
 * - Export fallback if needed
 */
export const PROJECT_CHARTER_TEMPLATE_V1: JSONDoc = {
  type: "doc",
  content: [
    {
      type: "table",
      content: [
        row([cell("PROJECT CHARTER", { colspan: 4 })]),
        row([th("Project Title"), cell(""), th("Project Manager"), cell("")]),
        row([th("Project Start Date"), cell(""), th("Project End Date"), cell("")]),
        row([th("Project Sponsor"), cell(""), th("Customer / Account"), cell("")]),
        row([th("Business Need", { colspan: 4 })]),
        row([cell("", { colspan: 4 })]),
        row([th("Project Scope", { colspan: 2 }), th("Deliverables", { colspan: 2 })]),
        row([cell("", { colspan: 2 }), cell("1.", { colspan: 2 })]),
        row([cell("", { colspan: 2 }), cell("2.", { colspan: 2 })]),
        row([th("Risks & Issues", { colspan: 2 }), th("Assumptions / Dependencies", { colspan: 2 })]),
        row([cell("1.", { colspan: 2 }), cell("1.", { colspan: 2 })]),
        row([cell("2.", { colspan: 2 }), cell("2.", { colspan: 2 })]),
        row([th("Financials", { colspan: 4 })]),
        row([cell("Budget to complete this project:", { colspan: 2 }), cell("", { colspan: 2 })]),
        row([th("Milestones Schedule", { colspan: 4 })]),
        row([th("Milestone"), th("Target Completion Date"), th("Actual Date"), th("Notes")]),
        row([cell("Milestone 1"), cell(""), cell(""), cell("")]),
        row([cell("Milestone 2"), cell(""), cell(""), cell("")]),
        row([th("Approval / Review Committee", { colspan: 4 })]),
        row([th("Role"), th("Name"), th("Date"), th("Signature")]),
        row([cell("Project Manager"), cell(""), cell(""), cell("")]),
        row([cell("Sponsor"), cell(""), cell(""), cell("")]),
      ],
    },
  ],
};

/* ------------------------------
   Canonical (v2) Section Template
   (Used by the new Section editor)
------------------------------ */

/**
 * v2 shape expected by the new UI:
 * - sections[] drives the tabs + headers + slide mapping
 * - each section has either bullets or rows (table-like)
 */
export const PROJECT_CHARTER_TEMPLATE_V2: any = {
  version: 2,
  type: "project_charter",
  meta: {
    project_title: "",
    project_manager: "",
    project_start_date: "",
    project_end_date: "",
    project_sponsor: "",
    customer_account: "",
  },
  sections: [
    {
      key: "business_need",
      title: "Business Need",
      bullets: "",
    },
    {
      key: "scope_assumptions",
      title: "Scope & Assumptions",
      bullets: "",
    },
    {
      key: "key_milestones",
      title: "Key Milestones",
      // rows/table style for milestones
      columns: ["Milestone", "Target Completion Date", "Actual Date", "Notes"],
      rows: [
        ["Milestone 1", "", "", ""],
        ["Milestone 2", "", "", ""],
      ],
    },
    {
      key: "financials",
      title: "Financials",
      bullets: "Budget to complete this project: ",
    },
    {
      key: "top_risks_issues",
      title: "Top Risks & Issues",
      bullets: "1.\n2.",
    },
    {
      key: "dependencies",
      title: "Dependencies",
      bullets: "1.\n2.",
    },
    {
      key: "decision_ask",
      title: "Decision / Ask",
      bullets: "",
    },
    {
      key: "approval",
      title: "Approval / Review Committee",
      columns: ["Role", "Name", "Date", "Signature"],
      rows: [
        ["Project Manager", "", "", ""],
        ["Sponsor", "", "", ""],
      ],
    },
  ],
};

// Keep backward compatibility for existing imports
// (Editor should now use V2; legacy exports/classic can use V1)
export const PROJECT_CHARTER_TEMPLATE = PROJECT_CHARTER_TEMPLATE_V2;
