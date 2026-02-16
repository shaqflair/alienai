// src/lib/ai/trigger-engine.ts
import { createClient } from "@/utils/supabase/server";
import type { TriggerContext, TriggerResult } from "./types";

/**
 * ✅ Dedupe rule:
 * For a given (project_id + trigger_key), we only keep one active suggestion in "proposed".
 * If it already exists, we do nothing (unless you later want "refresh" behavior).
 */
async function upsertSuggestion(ctx: TriggerContext, r: TriggerResult) {
  const supabase = await createClient();

  // do we already have an active proposed suggestion for this trigger?
  const { data: existing, error: exErr } = await supabase
    .from("ai_suggestions")
    .select("id,status")
    .eq("project_id", ctx.projectId)
    .eq("trigger_key", r.trigger_key)
    .eq("status", "proposed")
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) return existing;

  const { data, error } = await supabase
    .from("ai_suggestions")
    .insert({
      project_id: ctx.projectId,
      artifact_id: ctx.artifactId ?? null,
      section_key: ctx.sectionKey ?? null,

      suggestion_type: r.suggestion_type,
      severity: r.severity,

      title: r.title,
      body: r.body,
      rationale: r.rationale,

      evidence: r.evidence ?? {},
      recommended_patch: r.recommended_patch ?? null,

      status: "proposed",
      triggered_by_event_id: ctx.event.id,
      trigger_key: r.trigger_key,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function parseIsoDate(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

async function loadArtifactJson(artifactId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("artifacts")
    .select("id, project_id, type, json, approval_status, updated_at")
    .eq("id", artifactId)
    .single();

  if (error) throw new Error(error.message);
  return data as any;
}

/**
 * 🔥 Core rules: keep them deterministic + explainable.
 * Later you can add LLM enhancement, but the base engine should work without it.
 */
function runRules(args: { ctx: TriggerContext; artifact?: any | null }): TriggerResult[] {
  const { ctx, artifact } = args;
  const out: TriggerResult[] = [];

  // Rule 1: Charter milestones missing dates (compliance)
  if (ctx.event.event_type === "artifact_submitted" && safeStr(artifact?.type) === "project_charter") {
    const sections = artifact?.json?.sections ?? [];
    const milestones = sections.find((s: any) => s?.key === "milestones");
    const rows = milestones?.table?.rows ?? [];
    const hasAnyDate = rows.some((r: any) => (r?.cells ?? []).some((c: any) => /\d{4}-\d{2}-\d{2}/.test(String(c))));
    if (!hasAnyDate) {
      out.push({
        trigger_key: "charter.milestones.missing_dates",
        suggestion_type: "compliance",
        severity: "high",
        title: "Milestones section has no dates",
        body: "Add milestone dates before Gate approval. Use UK format (DD/MM/YYYY) in the UI.",
        rationale: "Triggered because the Charter was submitted but the Milestones table contains no valid dates.",
        evidence: { section_key: "milestones", rows_count: rows.length },
      });
    }
  }

  // Rule 2: Approval delayed (risk)
  if (ctx.event.event_type === "approval_delayed") {
    const days = Number(ctx.event.payload?.days_waiting ?? 0);
    if (days >= 7) {
      out.push({
        trigger_key: "approval.delay.7_days",
        suggestion_type: "risk",
        severity: "medium",
        title: "Approval delay detected",
        body: `Approval has been pending for ${days} days. Consider escalating to Sponsor / Approver or setting a decision deadline.`,
        rationale: "Triggered by an approval delay event crossing the 7-day threshold.",
        evidence: { days_waiting: days, artifact_id: ctx.artifactId },
      });
    }
  }

  // Rule 3: Scope changed after lock/submission (consistency)
  if (ctx.event.event_type === "artifact_saved" && safeStr(artifact?.approval_status).toLowerCase() === "submitted") {
    const changed = Boolean(ctx.event.payload?.diff?.length);
    if (changed) {
      out.push({
        trigger_key: "artifact.change.after_submission",
        suggestion_type: "consistency",
        severity: "high",
        title: "Changes detected after submission",
        body: "This artifact is submitted/locked. Consider requesting changes formally or reverting edits to preserve audit integrity.",
        rationale: "Triggered because edits were saved while the artifact was in a submitted state.",
        evidence: { diff: ctx.event.payload?.diff ?? [] },
      });
    }
  }

  return out;
}

export async function processEventAndGenerateSuggestions(eventId: string) {
  const supabase = await createClient();

  const { data: event, error } = await supabase
    .from("project_events")
    .select("*")
    .eq("id", eventId)
    .single();

  if (error) throw new Error(error.message);

  const ctx: TriggerContext = {
    projectId: event.project_id,
    artifactId: event.artifact_id,
    sectionKey: event.section_key,
    event,
  };

  const artifact = ctx.artifactId ? await loadArtifactJson(ctx.artifactId) : null;
  const results = runRules({ ctx, artifact });

  const created: any[] = [];
  for (const r of results) {
    const row = await upsertSuggestion(ctx, r);
    created.push(row);
  }

  return { created_count: created.length, created };
}
