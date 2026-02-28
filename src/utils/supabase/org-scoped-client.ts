//
// OrgScopedClient wraps the Supabase client and automatically injects
// .eq("organisation_id", orgId) on every query for the listed tables.
//
// This means existing call sites like:
//   supabase.from("artifacts").select("*").eq("project_id", id)
//
// Become automatically org-scoped WITHOUT changing 300 files.
// The org filter is injected transparently at the query layer.
//
// Usage (in server actions / routes):
//   import { createOrgScopedClient } from "@/utils/supabase/org-scoped-client";
//   const db = await createOrgScopedClient();
//   const { data } = await db.from("artifacts").select("*").eq("project_id", id);
//   // ↑ automatically includes .eq("organisation_id", orgId)

import { createClient } from "@/utils/supabase/server";
import { requireOrgId } from "@/utils/org/active-org";

// Tables that MUST be scoped by organisation_id on every query.
// Add to this list as you add new tables.
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
  // projects already has organisation_id — include for consistency
  "projects",
]);

// ── Proxy factory ─────────────────────────────────────────────────────────────

function createScopedFrom(
  supabase: any,
  orgId: string
) {
  return function scopedFrom(table: string) {
    const builder = supabase.from(table);

    if (!ORG_SCOPED_TABLES.has(table)) {
      // Not a scoped table — return builder unchanged
      return builder;
    }

    // Wrap the builder so that select/insert/update/delete
    // all inject organisation_id automatically.
    return new Proxy(builder, {
      get(target, prop: string) {
        const original = target[prop];

        if (prop === "select") {
          return (...args: any[]) =>
            target.select(...args).eq("organisation_id", orgId);
        }

        if (prop === "insert") {
          return (rows: any | any[]) => {
            // Inject organisation_id into every row being inserted
            const inject = (row: any) => ({
              ...row,
              organisation_id: row.organisation_id ?? orgId,
            });
            const patched = Array.isArray(rows) ? rows.map(inject) : inject(rows);
            return target.insert(patched);
          };
        }

        if (prop === "upsert") {
          return (rows: any | any[], opts?: any) => {
            const inject = (row: any) => ({
              ...row,
              organisation_id: row.organisation_id ?? orgId,
            });
            const patched = Array.isArray(rows) ? rows.map(inject) : inject(rows);
            return target.upsert(patched, opts);
          };
        }

        if (prop === "update") {
          // update doesn't need org injected into payload, but we
          // append an eq filter so cross-org updates are impossible
          return (patch: any) =>
            target.update(patch).eq("organisation_id", orgId);
        }

        if (prop === "delete") {
          return () => target.delete().eq("organisation_id", orgId);
        }

        // Everything else (eq, order, limit, maybeSingle, etc.) — pass through
        if (typeof original === "function") {
          return original.bind(target);
        }
        return original;
      },
    });
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export type OrgScopedClient = Awaited<ReturnType<typeof createOrgScopedClient>>;

/**
 * Creates a Supabase client where .from() on any org-scoped table
 * automatically injects organisation_id into every query.
 *
 * Drop-in replacement for `createClient()` in server actions.
 */
export async function createOrgScopedClient() {
  const [supabase, orgId] = await Promise.all([
    createClient(),
    requireOrgId(),
  ]);

  return {
    // Org-scoped .from()
    // Explicitly casting here helps with TS completion if using a specific type schema
    from: createScopedFrom(supabase, orgId) as typeof supabase.from,

    // Expose orgId so callers don't need to fetch it separately
    orgId,

    // Expose raw supabase for auth, rpc, storage, etc.
    auth:    supabase.auth,
    rpc:      supabase.rpc.bind(supabase),
    storage: supabase.storage,

    // Escape hatch: raw unscoped client for the rare case you need it.
    // Name is intentionally verbose to make misuse visible in code review.
    unscopedDangerously: supabase,
  };
}

/**
 * Same as createOrgScopedClient but also verifies the user is authed.
 * Returns userId alongside the scoped client.
 */
export async function createOrgScopedClientWithUser() {
  const db = await createOrgScopedClient();

  const {
    data: { user },
    error,
  } = await db.auth.getUser();

  if (error) throw new Error(error.message);
  if (!user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }

  return { ...db, userId: user!.id };
}