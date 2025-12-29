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

        row([th("Business Case", { colspan: 4 })]),
        row([cell("", { colspan: 4 })]),

        row([th("Objectives", { colspan: 4 })]),
        row([cell("1.", { colspan: 4 })]),
        row([cell("2.", { colspan: 4 })]),

        row([th("Scope", { colspan: 4 })]),
        row([cell("In Scope:\n- ", { colspan: 4 })]),
        row([cell("Out of Scope:\n- ", { colspan: 4 })]),

        row([th("Key Deliverables", { colspan: 4 })]),
        row([cell("1.", { colspan: 4 })]),
        row([cell("2.", { colspan: 4 })]),

        row([th("Milestones & Timeline", { colspan: 4 })]),
        row([th("Milestone"), th("Target Date"), th("Actual Date"), th("Notes")]),
        row([cell("Milestone 1"), cell(""), cell(""), cell("")]),
        row([cell("Milestone 2"), cell(""), cell(""), cell("")]),

        row([th("Financials", { colspan: 4 })]),
        row([th("Item"), th("Baseline (£)"), th("Forecast (£)"), th("Notes")]),
        row([cell("Budget"), cell(""), cell(""), cell("")]),
        row([cell("Contingency"), cell(""), cell(""), cell("")]),

        row([th("Risks", { colspan: 4 })]),
        row([cell("1.", { colspan: 4 })]),
        row([cell("2.", { colspan: 4 })]),

        row([th("Issues", { colspan: 4 })]),
        row([cell("1.", { colspan: 4 })]),
        row([cell("2.", { colspan: 4 })]),

        row([th("Assumptions", { colspan: 4 })]),
        row([cell("1.", { colspan: 4 })]),
        row([cell("2.", { colspan: 4 })]),

        row([th("Dependencies", { colspan: 4 })]),
        row([cell("1.", { colspan: 4 })]),
        row([cell("2.", { colspan: 4 })]),

        row([th("Project Team", { colspan: 4 })]),
        row([th("Role"), th("Name"), th("Organisation"), th("Responsibility")]),
        row([cell("Project Manager"), cell(""), cell(""), cell("")]),
        row([cell("Technical Lead"), cell(""), cell(""), cell("")]),

        row([th("Stakeholders", { colspan: 4 })]),
        row([th("Stakeholder"), th("Role"), th("Interest"), th("Influence")]),
        row([cell(""), cell(""), cell(""), cell("")]),
        row([cell(""), cell(""), cell(""), cell("")]),

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
   (Used by the current Section editor)
   ✅ SAME STRUCTURE, just new sections
------------------------------ */

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
    { key: "business_case", title: "Business Case", bullets: "" },

    { key: "objectives", title: "Objectives", bullets: "1.\n2.\n3." },

    {
      key: "scope",
      title: "Scope",
      bullets: "In Scope:\n- \n\nOut of Scope:\n- ",
    },

    { key: "key_deliverables", title: "Key Deliverables", bullets: "1.\n2.\n3." },

    {
      key: "milestones_timeline",
      title: "Milestones & Timeline",
      columns: ["Milestone", "Target Date", "Actual Date", "Notes"],
      rows: [
        ["Milestone 1", "", "", ""],
        ["Milestone 2", "", "", ""],
      ],
    },

    {
      key: "financials",
      title: "Financials",
      columns: ["Item", "Baseline (£)", "Forecast (£)", "Notes"],
      rows: [
        ["Budget", "", "", ""],
        ["Contingency", "", "", ""],
      ],
    },

    { key: "risks", title: "Risks", bullets: "1.\n2." },

    { key: "issues", title: "Issues", bullets: "1.\n2." },

    { key: "assumptions", title: "Assumptions", bullets: "1.\n2." },

    { key: "dependencies", title: "Dependencies", bullets: "1.\n2." },

    {
      key: "project_team",
      title: "Project Team",
      columns: ["Role", "Name", "Organisation", "Responsibility"],
      rows: [
        ["Project Manager", "", "", ""],
        ["Technical Lead", "", "", ""],
      ],
    },

    {
      key: "stakeholders",
      title: "Stakeholders",
      columns: ["Stakeholder", "Role", "Interest", "Influence"],
      rows: [
        ["", "", "", ""],
        ["", "", "", ""],
      ],
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
export const PROJECT_CHARTER_TEMPLATE = PROJECT_CHARTER_TEMPLATE_V2;
