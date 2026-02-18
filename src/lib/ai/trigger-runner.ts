import { createClient } from "@/utils/supabase/server";

export type TriggerMatch = {
  trigger_id: string;
  severity: "info" | "warning" | "critical";
  ai_intent: string;
  ai_steps: string[];
  affected_artifacts: string[];
  explain_why: string;
  explain_data_used: string[];
  auto_execute: boolean;
};

/**
 * Matches enabled AI triggers for a given artifact + event.
 * Returns GOVERNANCE-SAFE jobs (no model calls here).
 */
export async function runAiTriggers(params: {
  projectId: string;
  artifact: string;
  eventType: string;
}) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("ai_triggers")
    .select(
      [
        "id",
        "trigger_artifact",
        "event_type",
        "ai_intent",
        "ai_steps",
        "affected_artifacts",
        "severity",
        "auto_execute",
        "explain_why",
        "explain_data_used",
        "project_id",
        "is_enabled",
      ].join(",")
    )
    .eq("is_enabled", true)
    .eq("trigger_artifact", params.artifact)
    .eq("event_type", params.eventType)
    .or(`project_id.is.null,project_id.eq.${params.projectId}`);

  if (error) throw error;

  return (data ?? []).map((t: any) => ({
    trigger_id: String(t.id),
    severity: (t.severity ?? "info") as TriggerMatch["severity"],
    ai_intent: String(t.ai_intent ?? ""),
    ai_steps: Array.isArray(t.ai_steps) ? t.ai_steps.map((x: any) => String(x)) : [],
    affected_artifacts: Array.isArray(t.affected_artifacts)
      ? t.affected_artifacts.map((x: any) => String(x))
      : [],
    explain_why: String(t.explain_why ?? ""),
    explain_data_used: Array.isArray(t.explain_data_used)
      ? t.explain_data_used.map((x: any) => String(x))
      : [],
    auto_execute: Boolean(t.auto_execute ?? false),
  })) as TriggerMatch[];
}
