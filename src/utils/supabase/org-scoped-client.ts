import { createClient } from "@/utils/supabase/server";
import { requireOrgId } from "@/utils/org/active-org";

const ORG_SCOPED_TABLES = new Set([
  "artifacts","raid_items","raid_log","change_requests","change_comments",
  "change_events","change_attachments","stakeholders","notifications",
  "notification_outbox","ai_suggestions","ai_triggers","ai_usage_events",
  "lessons_learned","charter_milestones","project_charters","project_milestones",
  "schedule_milestones","artifact_comments","artifact_audit","artifact_audit_log",
  "artifact_events","artifact_suggestions","artifact_links","raid_ai_runs",
  "raid_digests","raid_item_scores","raid_financials","raid_weekly_scores",
  "raid_weekly_snapshots","project_events","project_member_audit",
  "approval_audit_log","governance_articles","governance_categories",
  "doa_rules","resource_rates","projects",
]);

function createScopedFrom(supabase: any, orgId: string) {
  return function scopedFrom(table: string) {
    const builder = supabase.from(table);
    if (!ORG_SCOPED_TABLES.has(table)) return builder;

    return new Proxy(builder, {
      get(target, prop: string) {
        if (prop === "select") {
          return (...args: any[]) => target.select(...args).eq("organisation_id", orgId);
        }
        if (prop === "insert") {
          return (rows: any | any[]) => {
            const inject = (row: any) => ({ ...row, organisation_id: row.organisation_id ?? orgId });
            return target.insert(Array.isArray(rows) ? rows.map(inject) : inject(rows));
          };
        }
        if (prop === "upsert") {
          return (rows: any | any[], opts?: any) => {
            const inject = (row: any) => ({ ...row, organisation_id: row.organisation_id ?? orgId });
            return target.upsert(Array.isArray(rows) ? rows.map(inject) : inject(rows), opts);
          };
        }
        if (prop === "update") {
          return (patch: any) => target.update(patch).eq("organisation_id", orgId);
        }
        if (prop === "delete") {
          return () => target.delete().eq("organisation_id", orgId);
        }
        const original = target[prop];
        return typeof original === "function" ? original.bind(target) : original;
      },
    });
  };
}

export type OrgScopedClient = Awaited<ReturnType<typeof createOrgScopedClient>>;

export async function createOrgScopedClient() {
  const [supabase, orgId] = await Promise.all([createClient(), requireOrgId()]);
  return {
    from: createScopedFrom(supabase, orgId),
    orgId,
    auth: supabase.auth,
    rpc: supabase.rpc.bind(supabase),
    storage: supabase.storage,
    unscopedDangerously: supabase,
  };
}

export async function createOrgScopedClientWithUser() {
  const db = await createOrgScopedClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error) throw new Error(error.message);
  if (!user) {
    const { redirect } = await import("next/navigation");
    redirect("/login");
  }
  return { ...db, userId: user!.id };
}
