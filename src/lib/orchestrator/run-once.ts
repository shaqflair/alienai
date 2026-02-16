import "server-only";

import { createClient } from "@/utils/supabase/server";
import type { OrchestratorOptions, OrchestratorRunResult, ArtifactEventRow } from "./types";
import { routeEventToSuggestions } from "./router";

export async function runOrchestratorOnce(opts: OrchestratorOptions = {}): Promise<OrchestratorRunResult> {
  const supabase = await createClient();
  const limit = Math.max(1, Math.min(50, Number(opts.limit ?? 10)));
  const dryRun = Boolean(opts.dryRun);

  const { data: events, error: evErr } = await supabase
    .from("artifact_events")
    .select("id, project_id, artifact_id, artifact_type, action, payload, created_at, processed_at")
    .is("processed_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (evErr) {
    throw new Error(`Orchestrator: failed to fetch events: ${evErr.message}`);
  }

  let processed = 0;
  let failed = 0;
  let last_event_id: string | null = null;

  for (const evt of (events ?? []) as ArtifactEventRow[]) {
    last_event_id = evt.id;

    try {
      const suggestions = routeEventToSuggestions({
        id: evt.id,
        project_id: evt.project_id,
        artifact_id: evt.artifact_id,
        artifact_type: evt.artifact_type,
        action: evt.action,
        payload: evt.payload,
      });

      if (!dryRun && suggestions.length) {
        const { error: sugErr } = await supabase.from("ai_suggestions").insert(
          suggestions.map((s: any) => ({
            project_id: s.project_id,
            source_event_id: s.source_event_id,
            target_artifact_id: s.target_artifact_id ?? null,
            target_artifact_type: s.target_artifact_type,
            suggestion_type: s.suggestion_type,
            patch: s.patch ?? null,
            rationale: s.rationale ?? null,
            confidence: s.confidence ?? null,
            status: "proposed",
          }))
        );

        if (sugErr) throw new Error(`insert ai_suggestions failed: ${sugErr.message}`);
      }

      if (!dryRun) {
        const { error: markErr } = await supabase
          .from("artifact_events")
          .update({ processed_at: new Date().toISOString(), process_error: null })
          .eq("id", evt.id);

        if (markErr) throw new Error(`mark processed failed: ${markErr.message}`);
      }

      processed += 1;
    } catch (e: any) {
      failed += 1;

      if (!dryRun) {
        await supabase
          .from("artifact_events")
          .update({ process_error: String(e?.message ?? e) })
          .eq("id", evt.id);
      }
    }
  }

  return { processed, failed, last_event_id };
}
