import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { buildAssistantContext } from "./_lib/build-context";
import AssistantClient from "./_components/AssistantClient";

export const dynamic  = "force-dynamic";
export const metadata = { title: "AI Assistant | ResForce" };

export default async function AssistantPage() {
  const supabase = await createClient();
  
  // 1. Security Check: Ensure user is logged in
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    redirect("/login?next=/assistant");
  }

  // 2. Context Check: Ensure an active organisation is selected
  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) {
    redirect("/?err=no_org");
  }

  const hasOpenAI = !!process.env.OPENAI_API_KEY;

  // 3. Initialize default stats
  let stats = {
    peopleCount:    0,
    projectCount:   0,
    overAllocCount: 0,
    freeCount:      0,
    orgName:        "Your organisation",
  };

  // 4. Populate Stats Snapshot
  // We fetch the context used by the AI to show real numbers in the UI headers.
  try {
    const ctx = await buildAssistantContext(String(orgId));
    const today = new Date().toISOString().slice(0, 10);
    const fourWeeksLater = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
    
    const upcomingAllocations = ctx.allocations.filter(
      a => a.weekStart >= today && a.weekStart <= fourWeeksLater
    );
    const allocatedPersonNames = new Set(upcomingAllocations.map(a => a.personName));

    stats = {
      peopleCount:    ctx.people.length,
      projectCount:   ctx.projects.filter(p => p.status === "confirmed").length,
      overAllocCount: ctx.utilisation.filter(u => u.peakUtil > 100).length,
      freeCount:      ctx.people.filter(p => !allocatedPersonNames.has(p.name)).length,
      orgName:        ctx.orgName,
    };
  } catch (err) {
    console.error("Assistant data pre-load failed:", err);
  }

  // 5. Pass data to the Client Component
  return (
    <AssistantClient
      stats={stats}
      hasOpenAI={hasOpenAI}
      userEmail={user.email ?? ""}
    />
  );
}
