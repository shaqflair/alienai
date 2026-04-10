import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import OrgApprovalsAdminPanel from "@/components/approvals/OrgApprovalsAdminPanel";
import HolidayCoverPanel from "@/components/approvals/HolidayCoverPanel";

export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default async function ApprovalsSettingsPage() {
  const supabase = await createClient();

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) redirect("/login?next=/settings/approvals");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/settings");

  const organisationId = String(orgId);

  const [orgRes, memRes] = await Promise.all([
    supabase.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
    supabase.from("organisation_members").select("role").eq("organisation_id", organisationId).eq("user_id", user.id).is("removed_at", null).maybeSingle(),
  ]);

  const orgName = safeStr(orgRes.data?.name || "Your organisation");
  const myRole  = safeStr(memRes.data?.role || "member").toLowerCase();
  const isAdmin = myRole === "admin" || myRole === "owner";

  return (
    <div style={{ maxWidth: 960, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.3px" }}>
          Approvals
        </h1>
        <p style={{ margin: "6px 0 0", fontSize: 13, color: "#64748b" }}>
          Configure approval rules, groups, and approvers. Manage holiday cover and delegate authority.
        </p>
        {!isAdmin && (
          <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 12px", borderRadius: 20, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)", fontSize: 11, fontWeight: 600, color: "#92400e" }}>
            Read-only -- contact a platform admin to make changes
          </div>
        )}
      </div>

      <section style={{ marginBottom: 32 }}>
        <OrgApprovalsAdminPanel
          organisationId={organisationId}
          organisationName={orgName}
          isAdmin={isAdmin}
        />
      </section>

      <section>
        <div style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "#0f172a" }}>Holiday Cover</h2>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
            Delegate approval authority to a cover person for a fixed date range.
          </p>
        </div>
        <HolidayCoverPanel projectId={organisationId} canEdit={isAdmin} />
      </section>
    </div>
  );
}