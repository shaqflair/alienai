// src/lib/agent/tools.ts
// Tool definitions for the Aliena agent.
// Each tool maps directly to a Supabase query or existing API.
// The LLM picks tools based on intent; the executor runs them.

export type ToolName =
  | "get_portfolio_health"
  | "get_project_detail"
  | "list_raid_items"
  | "list_milestones_due"
  | "get_budget_summary"
  | "get_governance_status"
  | "get_quarterly_forecast"
  | "create_raid_draft"
  | "send_notification";

export const AGENT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "get_portfolio_health",
      description:
        "Get the current health scores and RAG status for all active projects in the organisation. " +
        "Use this when the user asks about overall portfolio status, which projects are at risk, " +
        "or how the portfolio is performing.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Lookback window in days for milestone/RAID signals. Default 30.",
            enum: [7, 14, 30, 60],
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_project_detail",
      description:
        "Get detailed health breakdown, RAID items, milestones, budget and governance status " +
        "for a single project. Use when the user asks about a specific project by name or code.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "The UUID of the project.",
          },
          project_name: {
            type: "string",
            description:
              "The name or code of the project (e.g. 'Project Comfort', 'PRJ-100'). " +
              "Use this if you don't have the UUID yet — the executor will resolve it.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_raid_items",
      description:
        "List open RAID items across the portfolio or for a specific project. " +
        "Filter by type (Risk, Issue, Dependency, Assumption), severity, or due date. " +
        "Use when the user asks about risks, issues, or items needing attention.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Filter to a single project UUID. Omit for all projects.",
          },
          type: {
            type: "string",
            enum: ["Risk", "Issue", "Dependency", "Assumption"],
            description: "Filter by RAID item type.",
          },
          severity: {
            type: "string",
            enum: ["High", "Medium", "Low"],
            description: "Filter by severity level.",
          },
          overdue_only: {
            type: "boolean",
            description: "If true, only return items past their due date.",
          },
          limit: {
            type: "number",
            description: "Max items to return. Default 20.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_milestones_due",
      description:
        "List milestones and WBS items due within the next N days across all active projects. " +
        "Use when the user asks what's coming up, what's overdue, or what needs attention this week.",
      parameters: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Look-ahead window in days. Default 14.",
          },
          project_id: {
            type: "string",
            description: "Filter to a single project. Omit for all projects.",
          },
          overdue_only: {
            type: "boolean",
            description: "If true, return only overdue items.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_budget_summary",
      description:
        "Get budget vs actual spend, quarterly forecast breakdown, and variance across the portfolio or a specific project. " +
        "Returns: total budget, total spent (from project_spend or financial plan cost_lines), " +
        "current quarter forecast vs budget by month, forecast items moving in/out of quarter, " +
        "and overall variance. Use when the user asks about budget health, overspend, " +
        "financial exposure, quarterly forecast, or revenue/cost movements.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Filter to a single project. Omit for portfolio view.",
          },
          include_quarterly_breakdown: {
            type: "boolean",
            description: "If true, return month-by-month budget/forecast/actual for the current quarter.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_governance_status",
      description:
        "Get gate readiness, charter approval, budget approval, and stakeholder register status " +
        "for projects. Use when the user asks about governance, gate reviews, or closure readiness.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Filter to a single project. Omit for all projects.",
          },
          gate_number: {
            type: "number",
            description: "Filter to a specific gate (1-5).",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_raid_draft",
      description:
        "Draft a new RAID item for a project. This does NOT write to the database immediately — " +
        "it returns a draft for the user to review and confirm. Use when the user asks to raise, " +
        "log, or create a risk, issue, dependency, or assumption.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "The project UUID to raise the RAID item against.",
          },
          type: {
            type: "string",
            enum: ["Risk", "Issue", "Dependency", "Assumption"],
            description: "The type of RAID item.",
          },
          title: {
            type: "string",
            description: "A concise title for the RAID item.",
          },
          description: {
            type: "string",
            description: "A clear description of the risk, issue, or dependency.",
          },
          priority: {
            type: "string",
            enum: ["High", "Medium", "Low"],
            description: "The priority/severity level.",
          },
          owner_label: {
            type: "string",
            description: "Name of the person who should own this item.",
          },
          due_date: {
            type: "string",
            description: "ISO date string (YYYY-MM-DD) for when this item should be resolved.",
          },
        },
        required: ["project_id", "type", "title", "priority"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_quarterly_forecast",
      description:
        "Get detailed quarterly financial intelligence from financial plan artifacts. " +
        "Returns: current quarter forecast vs budget, actual spend to date, items moved out of the quarter, " +
        "new spend added to the quarter, and month-by-month breakdown. " +
        "Use when the user asks about quarterly forecast, pipeline changes, revenue, spend movement, or financial variance by quarter.",
      parameters: {
        type: "object",
        properties: {
          project_id: {
            type: "string",
            description: "Filter to a single project UUID. Omit for portfolio-wide view.",
          },
          quarter: {
            type: "string",
            description:
              "The quarter to analyse, e.g. 'Q1 2026', 'Q2 2026'. Defaults to the current quarter if omitted.",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_notification",
      description:
        "Send an in-app and/or email notification to a user or the portfolio team. " +
        "Use when the agent needs to alert someone about an urgent issue or action required.",
      parameters: {
        type: "object",
        properties: {
          recipient_user_id: {
            type: "string",
            description: "The UUID of the user to notify. Omit to notify all org admins.",
          },
          title: {
            type: "string",
            description: "Short notification title.",
          },
          body: {
            type: "string",
            description: "The notification message body.",
          },
          link: {
            type: "string",
            description: "Optional URL path to link to (e.g. /projects/[id]/raid).",
          },
          type: {
            type: "string",
            enum: ["alert", "digest", "action_required", "info"],
            description: "The notification category.",
          },
        },
        required: ["title", "body", "type"],
      },
    },
  },
] as const;

export type AgentTool = (typeof AGENT_TOOLS)[number];