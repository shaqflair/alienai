// src/lib/ai/event-log.ts
import { createClient } from "@/utils/supabase/server";
import type { EventSeverity } from "./types";

export async function logProjectEvent(args: {
  projectId: string;
  artifactId?: string | null;
  sectionKey?: string | null;

  eventType: string;
  actorUserId?: string | null;
  severity?: EventSeverity;

  source?: "app" | "system" | "import" | "ai";
  payload?: any;
}) {
  const supabase = await createClient();

  const {
    projectId,
    artifactId = null,
    sectionKey = null,
    eventType,
    actorUserId = null,
    severity = "info",
    source = "app",
    payload = {},
  } = args;

  const { data, error } = await supabase
    .from("project_events")
    .insert({
      project_id: projectId,
      artifact_id: artifactId,
      section_key: sectionKey,
      event_type: eventType,
      actor_user_id: actorUserId,
      severity,
      source,
      payload,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}
