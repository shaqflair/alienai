// src/lib/events/publisher.ts
import "server-only";

import { createClient } from "@/utils/supabase/server";
import type { ArtifactEvent } from "./types";

function asUuid(x: unknown): string {
  if (typeof x !== "string") return "";
  return x.trim();
}

function baseUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

type AnyObj = Record<string, any>;

/**
 * ? Optional: forwards certain artifact events into AI pipeline triggers.
 * Never throws (audit log must remain reliable).
 */
async function forwardToAiPipeline(evt: ArtifactEvent) {
  try {
    const artifactType = String(evt.artifact_type ?? "").toLowerCase();
    const action = String(evt.action ?? "").toLowerCase();
    const payload = (evt.payload ?? {}) as AnyObj;

    // Only forward for charter updates
    if (artifactType !== "project_charter") return;
    if (action !== "updated") return;

    // Only forward when content_json changed (your actions set this consistently)
    const changed = Array.isArray(payload?.changed) ? payload.changed.map((x: any) => String(x)) : [];
    if (!changed.includes("content_json")) return;

    const projectId = asUuid(evt.project_id);
    const artifactId = asUuid(evt.artifact_id);
    if (!projectId || !artifactId) return;

    await fetch(`${baseUrl()}/api/ai/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId,
        artifactId,
        eventType: "charter_stakeholders_updated",
        severity: "info",
        source: "app",
        payload: {
          target_artifact_type: "stakeholder_register",
          charterArtifactId: artifactId,
          saveSource: String(payload?.source ?? "unknown"),
          previous_artifact_id: payload?.previous_artifact_id ?? undefined,
        },
      }),
    }).catch(() => null);
  } catch {
    // swallow: AI pipeline must never affect primary path
  }
}

/**
 * Writes an immutable event row to artifact_events.
 * Call this AFTER an artifact save/update/delete succeeds.
 */
export async function emitArtifactEvent(evt: ArtifactEvent) {
  const supabase = await createClient();

  const row = {
    project_id: asUuid(evt.project_id),
    artifact_id: asUuid(evt.artifact_id),
    artifact_type: String(evt.artifact_type),
    action: String(evt.action),
    payload: evt.payload ?? {},
    actor_user_id: evt.actor_user_id ?? null,
  };

  const { data, error } = await supabase.from("artifact_events").insert(row).select("id").single();

  if (error) {
    throw new Error(`emitArtifactEvent failed: ${error.message}`);
  }

  // ? Best-effort forward (never throws)
  forwardToAiPipeline(evt).catch(() => null);

  return (data as any).id as string;
}
