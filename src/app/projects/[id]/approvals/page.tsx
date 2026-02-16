import "server-only";

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

import OrgApprovalsAdminPanel from "@/components/approvals/OrgApprovalsAdminPanel";

export const runtime = "nodejs";

function asUuidOrEmpty(x: any) {
  const s = String(x ?? "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
    ? s
    : "";
}

export default async function ApprovalsPage(props: {
  params: Promise<{ id: string }> | { id: string };
}) {
  const params = await Promise.resolve(props.params);
  const projectId = asUuidOrEmpty(params?.id);
  if (!projectId) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Validate project + get organisation_id
  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .select("id, organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projErr) {
    return (
      <main className="px-6 py-6">
        <h1 className="text-xl font-semibold text-slate-100">Approvals</h1>
        <p className="mt-3 text-sm text-rose-300">{projErr.message}</p>
      </main>
    );
  }
  if (!proj) notFound();

  // Project membership check
  const { data: pm } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (!pm) {
    return (
      <main className="px-6 py-6">
        <h1 className="text-xl font-semibold text-slate-100">Approvals</h1>
        <p className="mt-3 text-sm text-slate-300">You do not have access to this project.</p>
      </main>
    );
  }

  const cookieOrgId = asUuidOrEmpty(await getActiveOrgId());
  const projectOrgId = asUuidOrEmpty((proj as any).organisation_id);

  // Prefer cookie if valid, else fall back to project’s org
  const organisationId = cookieOrgId || projectOrgId;

  if (!organisationId) {
    return (
      <main className="px-6 py-6">
        <h1 className="text-xl font-semibold text-slate-100">Approvals</h1>
        <p className="mt-3 text-sm text-amber-200">
          No organisation found (cookie missing and project has no organisation_id).
        </p>
      </main>
    );
  }

  // Fetch org name
  const { data: orgRow } = await supabase
    .from("organisations")
    .select("id, name")
    .eq("id", organisationId)
    .maybeSingle();

  const organisationName = (orgRow as any)?.name ?? undefined;

  // Determine admin (org membership role)
  const { data: memRow } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .maybeSingle();

  const isAdmin = String((memRow as any)?.role ?? "").toLowerCase() === "admin";

  return (
    <main className="px-6 py-6">
      {/* ✅ FIX: pass the correct prop names expected by OrgApprovalsAdminPanel */}
      <OrgApprovalsAdminPanel
        organisationId={organisationId}
        organisationName={organisationName}
        isAdmin={isAdmin}
      />
    </main>
  );
}
