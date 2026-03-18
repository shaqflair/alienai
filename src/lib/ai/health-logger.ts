import { createAdminClient } from "@/utils/supabase/admin";

type LogParams = {
  projectId?: string;
  artifactId?: string;
  eventType: string;
  severity: "info" | "warning" | "critical";
  endpoint?: string;
  model?: string;
  latencyMs?: number;
  success?: boolean;
  errorMessage?: string;
  metadata?: any;
};

/**
 * Persists operational telemetry for AI interactions.
 * Uses Admin client to bypass RLS for system-level logging.
 */
export async function logAiHealthEvent(params: LogParams) {
  try {
    const supabase = createAdminClient();

    const { error } = await supabase.from("ai_health_events").insert({
      project_id: params.projectId ?? null,
      artifact_id: params.artifactId ?? null,
      event_type: params.eventType,
      severity: params.severity,
      endpoint: params.endpoint ?? null,
      model: params.model ?? null,
      latency_ms: params.latencyMs ?? null,
      success: params.success ?? true,
      error_message: params.errorMessage ?? null,
      metadata: {
        ...params.metadata,
        ts: new Date().toISOString(),
      },
    });

    if (error) throw error;
  } catch (err) {
    // We log to console but don't throw to avoid crashing the main AI flow
    console.error("[AI Health Logger] Failed to persist event:", err);
  }
}