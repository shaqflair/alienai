// eslint-rules/no-unscoped-supabase-query.js
"use strict";

const ORG_SCOPED_TABLES = new Set([
  "artifacts",
  "raid_items",
  "raid_log",
  "change_requests",
  "change_comments",
  "change_events",
  "change_attachments",
  "stakeholders",
  "notifications",
  "notification_outbox",
  "ai_suggestions",
  "ai_triggers",
  "ai_usage_events",
  "lessons_learned",
  "charter_milestones",
  "project_charters",
  "project_milestones",
  "schedule_milestones",
  "artifact_comments",
  "artifact_audit",
  "artifact_audit_log",
  "artifact_events",
  "artifact_suggestions",
  "artifact_links",
  "raid_ai_runs",
  "raid_digests",
  "raid_item_scores",
  "raid_financials",
  "raid_weekly_scores",
  "raid_weekly_snapshots",
  "project_events",
  "project_member_audit",
  "approval_audit_log",
  "governance_articles",
  "governance_categories",
  "doa_rules",
  "resource_rates",
  "projects",
]);

function collectChainCalls(node) {
  const calls = [];
  let current = node;
  while (
    current.type === "CallExpression" &&
    current.callee.type === "MemberExpression"
  ) {
    calls.push({ method: current.callee.property.name, args: current.arguments });
    current = current.callee.object;
  }
  return calls;
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Require organisation_id filter on Supabase queries for org-scoped tables.",
      recommended: true,
    },
    messages: {
      missingOrgScope:
        'Supabase query on "{{table}}" is missing .eq("organisation_id", ...). ' +
        "Use createOrgScopedClient() from @/utils/supabase/org-scoped-client, " +
        'or add .eq("organisation_id", orgId) explicitly.',
    },
    schema: [
      {
        type: "object",
        properties: {
          ignore: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    const options      = context.options[0] ?? {};
    const ignoreTables = new Set(options.ignore ?? []);

    return {
      CallExpression(node) {
        if (
          node.callee.type !== "MemberExpression" ||
          node.callee.property.name !== "from"
        ) return;

        const tableArg = node.arguments[0];
        if (!tableArg || tableArg.type !== "Literal") return;

        const table = String(tableArg.value);
        if (!ORG_SCOPED_TABLES.has(table) || ignoreTables.has(table)) return;

        const chain = collectChainCalls(node.parent?.parent ?? node);
        const hasOrgScope = chain.some(({ method, args }) => {
          if (method !== "eq") return false;
          const firstArg = args[0];
          return firstArg?.type === "Literal" && firstArg.value === "organisation_id";
        });

        if (!hasOrgScope) {
          context.report({ node, messageId: "missingOrgScope", data: { table } });
        }
      },
    };
  },
};
