import { createAdminClient } from "@/utils/supabase/admin";

export async function applyPatch(patch: any, projectId: string) {
  const supabase = createAdminClient();

  switch (patch?.type) {
    case "raid.add": {
      const { error } = await supabase.from("raid_items").insert({
        project_id: projectId,
        category: patch.data.category,
        description: patch.data.description,
        impact: patch.data.impact,
        probability: patch.data.probability,
        mitigation: patch.data.mitigation,
        owner: patch.data.owner,
        status: "open",
      });

      if (error) throw error;
      return;
    }

    case "dashboard.narrative": {
      const { error } = await supabase.from("status_narratives").insert({
        project_id: projectId,
        message: patch.data.message,
        severity: patch.data.severity ?? "info",
      });

      if (error) throw error;
      return;
    }

    default:
      throw new Error(`Unknown patch type: ${patch?.type}`);
  }
}
