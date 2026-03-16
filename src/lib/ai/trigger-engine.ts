// src/lib/ai/trigger-engine.ts
import { createClient } from "@/utils/supabase/server";
import type { TriggerContext, TriggerResult } from "./types";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function asObj<T extends Record<string, any> = Record<string, any>>(x: unknown): T {
  return x && typeof x === "object" && !Array.isArray(x) ? (x as T) : ({} as T);
}

function asArr<T = any>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

function parseIsoDate(s: string) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function deepClone<T>(x: T): T {
  try {
    return JSON.parse(JSON.stringify(x));
  } catch {
    return x;
  }
}

function normalizeStatusForInsert(status: unknown) {
  const s = safeLower(status);
  if (s === "suggested") return "proposed";
  if (s === "rejected") return "dismissed";
  if (s === "applied" || s === "dismissed" || s === "proposed") return s;
  return "proposed";
}

function getPatchCompat(r: TriggerResult) {
  return r.patch ?? r.recommended_patch ?? null;
}

function normalizeArtifactType(input: unknown) {
  const t = safeLower(input)
    .replace(/[-\s]+/g, "_")
    .replace(/__+/g, "_")
    .trim();
  return t;
}

function looksLikeClosureType(input: unknown) {
  const t = normalizeArtifactType(input);
  return (
    t === "closure_report" ||
    t === "project_closure_report" ||
    t === "closure" ||
    t.includes("closure_report") ||
    t.includes("closure")
  );
}

function truthyText(input: unknown) {
  return safeStr(input).trim().length > 0;
}

function numberOrNull(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function findSection(artifactJson: any, candidateKeys: string[]) {
  const sections = asArr<any>(artifactJson?.sections);
  const wanted = candidateKeys.map((k) => normalizeArtifactType(k));
  return (
    sections.find((s) => wanted.includes(normalizeArtifactType(s?.key))) ??
    sections.find((s) => {
      const k = normalizeArtifactType(s?.key);
      const title = normalizeArtifactType(s?.title);
      return wanted.includes(k) || wanted.includes(title);
    }) ??
    null
  );
}

function extractTableRows(sectionOrArtifact: any): any[] {
  const rows =
    sectionOrArtifact?.table?.rows ??
    sectionOrArtifact?.rows ??
    sectionOrArtifact?.data?.rows ??
    [];
  return asArr(rows);
}

function extractRowCells(row: any): string[] {
  if (Array.isArray(row)) return row.map((x) => safeStr(x));
  if (Array.isArray(row?.cells)) return row.cells.map((x: any) => safeStr(x));
  return [];
}

function flattenText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => flattenText(v)).join(" ").trim();
  if (typeof value === "object") {
    return Object.values(value as Record<string, any>)
      .map((v) => flattenText(v))
      .join(" ")
      .trim();
  }
  return "";
}

function countOpenRaidItems(input: any, wantedKinds: string[]) {
  const items = asArr<any>(input);
  const wanted = wantedKinds.map((x) => normalizeArtifactType(x));
  return items.filter((item) => {
    const type = normalizeArtifactType(item?.type ?? item?.kind ?? item?.category);
    const status = normalizeArtifactType(item?.status ?? item?.state);
    const closed =
      item?.closed === true ||
      item?.is_closed === true ||
      ["closed", "resolved", "complete", "completed", "done", "cancelled", "canceled"].includes(status);
    return wanted.includes(type) && !closed;
  }).length;
}

function countPendingChanges(input: any) {
  const items = asArr<any>(input);
  return items.filter((item) => {
    const status = normalizeArtifactType(item?.status ?? item?.state);
    return ["draft", "submitted", "in_review", "review", "pending", "awaiting_approval", "open"].includes(status);
  }).length;
}

function countOverdueMilestones(input: any) {
  const rows = asArr<any>(input);
  const now = new Date();

  let count = 0;
  for (const row of rows) {
    const cells = extractRowCells(row);
    const textBlob = cells.join(" ").trim();

    const status = normalizeArtifactType(
      row?.status ??
        row?.state ??
        cells.find((c) => /complete|completed|done|closed|open|late|overdue|in progress/i.test(String(c))) ??
        ""
    );

    const completed = ["complete", "completed", "done", "closed"].includes(status);
    if (completed) continue;

    const dateCandidate =
      safeStr(row?.due_date || row?.date || row?.target_date || row?.planned_date).trim() ||
      cells.find((c) => /\d{4}-\d{2}-\d{2}/.test(String(c))) ||
      "";

    const d = parseIsoDate(dateCandidate);
    if (d && d.getTime() < now.getTime()) {
      count += 1;
      continue;
    }

    if (/overdue/i.test(textBlob) || /\blate\b/i.test(textBlob)) {
      count += 1;
    }
  }

  return count;
}

async function loadArtifactJson(artifactId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("artifacts")
    .select("id, project_id, type, content_json, json, approval_status, updated_at")
    .eq("id", artifactId)
    .single();

  if (error) throw new Error(error.message);

  const row = (data ?? {}) as any;
  return {
    ...row,
    content_json: row?.content_json ?? row?.json ?? {},
    json: row?.json ?? row?.content_json ?? {},
  };
}

/**
 * ✅ Dedupe rule:
 * For a given (project_id + trigger_key), we only keep one active suggestion in "proposed".
 * If it already exists, we do nothing.
 */
async function upsertSuggestion(ctx: TriggerContext, r: TriggerResult) {
  const supabase = await createClient();

  const { data: existing, error: exErr } = await supabase
    .from("ai_suggestions")
    .select("id,status")
    .eq("project_id", ctx.projectId)
    .eq("trigger_key", r.trigger_key)
    .in("status", ["proposed", "suggested"])
    .maybeSingle();

  if (exErr) throw new Error(exErr.message);
  if (existing?.id) return existing;

  const patchCompat = getPatchCompat(r);

  const insertRow: Record<string, any> = {
    project_id: ctx.projectId,
    artifact_id: ctx.artifactId ?? null,
    section_key: ctx.sectionKey ?? null,

    target_artifact_type: r.target_artifact_type ?? null,
    suggestion_type: r.suggestion_type,
    severity: r.severity,

    title: r.title,
    body: r.body,
    rationale: r.rationale,

    evidence: r.evidence ?? {},
    recommended_patch: r.recommended_patch ?? patchCompat,
    patch: patchCompat,

    status: normalizeStatusForInsert("proposed"),
    triggered_by_event_id: ctx.event.id,
    trigger_key: r.trigger_key,
  };

  const { data, error } = await supabase.from("ai_suggestions").insert(insertRow).select().single();

  if (error) throw new Error(error.message);
  return data;
}

function buildClosureRules(ctx: TriggerContext, artifact: any): TriggerResult[] {
  const out: TriggerResult[] = [];
  const artifactType = normalizeArtifactType(artifact?.type);
  if (!looksLikeClosureType(artifactType)) return out;

  const json = artifact?.content_json ?? artifact?.json ?? {};
  const sectionSummary = findSection(json, ["closure_summary", "summary", "executive_summary"]);
  const sectionLessons = findSection(json, ["lessons_learned", "lessons", "lessons_log"]);
  const sectionAcceptance = findSection(json, ["customer_acceptance", "acceptance", "client_acceptance"]);
  const sectionFinalCost = findSection(json, ["final_cost", "financial_close", "cost_summary", "final_costs"]);
  const sectionRaid = findSection(json, ["raid", "risk_issue_dependency", "risk_issue_assumption_dependency"]);
  const sectionChanges = findSection(json, ["change_requests", "changes", "change_control"]);
  const sectionMilestones = findSection(json, ["milestones", "schedule", "timeline"]);

  const summaryText =
    safeStr(sectionSummary?.summary).trim() ||
    safeStr(sectionSummary?.body).trim() ||
    safeStr(sectionSummary?.content).trim() ||
    flattenText(sectionSummary).trim();

  if (!summaryText) {
    out.push({
      trigger_key: "closure.summary.missing",
      target_artifact_type: artifactType || "closure_report",
      suggestion_type: "compliance",
      severity: "high",
      title: "Closure summary is missing",
      body: "Add a concise closure summary covering delivery outcome, objectives achieved, and final project position.",
      rationale: "Triggered because the closure report does not contain a usable summary section.",
      evidence: { section_key: sectionSummary?.key ?? null, artifact_type: artifactType },
      recommended_patch: {
        kind: "replace_text",
        mode: "replace",
        sectionKey: sectionSummary?.key ?? "summary",
        bullets:
          "- Delivery outcome\n- Objectives achieved\n- Final schedule position\n- Final financial position\n- Key closure decisions",
      },
      patch: {
        kind: "replace_text",
        mode: "replace",
        sectionKey: sectionSummary?.key ?? "summary",
        bullets:
          "- Delivery outcome\n- Objectives achieved\n- Final schedule position\n- Final financial position\n- Key closure decisions",
      },
    });
  }

  const lessonsRows = extractTableRows(sectionLessons);
  const lessonsText = flattenText(sectionLessons);
  if (!lessonsRows.length && !truthyText(lessonsText)) {
    out.push({
      trigger_key: "closure.lessons_learned.missing",
      target_artifact_type: artifactType || "closure_report",
      suggestion_type: "improve",
      severity: "high",
      title: "Lessons learned are missing",
      body: "Capture delivery lessons learned before final closure so future projects can reuse them.",
      rationale: "Triggered because the closure report has no populated lessons learned content.",
      evidence: { section_key: sectionLessons?.key ?? null, rows_count: lessonsRows.length },
      recommended_patch: {
        kind: "add_rows",
        mode: "append",
        sectionKey: sectionLessons?.key ?? "lessons_learned",
        rows: [
          ["What worked well", "", "", ""],
          ["What did not work well", "", "", ""],
          ["Recommendation for future projects", "", "", ""],
        ],
      },
      patch: {
        kind: "add_rows",
        mode: "append",
        sectionKey: sectionLessons?.key ?? "lessons_learned",
        rows: [
          ["What worked well", "", "", ""],
          ["What did not work well", "", "", ""],
          ["Recommendation for future projects", "", "", ""],
        ],
      },
    });
  }

  const acceptanceText = flattenText(sectionAcceptance).trim();
  if (!acceptanceText) {
    out.push({
      trigger_key: "closure.customer_acceptance.missing",
      target_artifact_type: artifactType || "closure_report",
      suggestion_type: "compliance",
      severity: "high",
      title: "Customer acceptance evidence is missing",
      body: "Record the customer acceptance decision or sign-off reference before closing the project.",
      rationale: "Triggered because the closure report does not show customer acceptance evidence.",
      evidence: { section_key: sectionAcceptance?.key ?? null },
      recommended_patch: {
        kind: "replace_text",
        mode: "replace",
        sectionKey: sectionAcceptance?.key ?? "customer_acceptance",
        bullets:
          "- Acceptance status\n- Customer approver name\n- Date of acceptance\n- Reference / evidence link\n- Outstanding conditions (if any)",
      },
      patch: {
        kind: "replace_text",
        mode: "replace",
        sectionKey: sectionAcceptance?.key ?? "customer_acceptance",
        bullets:
          "- Acceptance status\n- Customer approver name\n- Date of acceptance\n- Reference / evidence link\n- Outstanding conditions (if any)",
      },
    });
  }

  const finalCostText = flattenText(sectionFinalCost).trim();
  const finalCostValue =
    numberOrNull(sectionFinalCost?.final_cost) ??
    numberOrNull(sectionFinalCost?.actual_cost) ??
    numberOrNull(sectionFinalCost?.value);
  if (!truthyText(finalCostText) && finalCostValue == null) {
    out.push({
      trigger_key: "closure.final_cost.missing",
      target_artifact_type: artifactType || "closure_report",
      suggestion_type: "financial",
      severity: "high",
      title: "Final cost is missing",
      body: "Add the final project cost and closing financial position before approving closure.",
      rationale: "Triggered because no final cost information could be found in the closure report.",
      evidence: { section_key: sectionFinalCost?.key ?? null },
      recommended_patch: {
        kind: "replace_text",
        mode: "replace",
        sectionKey: sectionFinalCost?.key ?? "final_cost",
        bullets:
          "- Approved budget\n- Final actual cost\n- Variance\n- Reason for variance\n- Remaining accruals / liabilities",
      },
      patch: {
        kind: "replace_text",
        mode: "replace",
        sectionKey: sectionFinalCost?.key ?? "final_cost",
        bullets:
          "- Approved budget\n- Final actual cost\n- Variance\n- Reason for variance\n- Remaining accruals / liabilities",
      },
    });
  }

  const openRisks = countOpenRaidItems(
    sectionRaid?.items ?? sectionRaid?.risks ?? sectionRaid?.rows ?? sectionRaid?.table?.rows ?? [],
    ["risk"]
  );
  if (openRisks > 0) {
    out.push({
      trigger_key: "closure.open_risks.remaining",
      target_artifact_type: artifactType || "closure_report",
      suggestion_type: "risk",
      severity: "high",
      title: "Open risks remain at closure",
      body: `The closure report still indicates ${openRisks} open risk${openRisks === 1 ? "" : "s"}. Confirm treatment, transfer, or acceptance before closure.`,
      rationale: "Triggered because open risks were detected in the closure evidence.",
      evidence: { open_risks: openRisks, section_key: sectionRaid?.key ?? null },
    });
  }

  const openIssues = countOpenRaidItems(
    sectionRaid?.items ?? sectionRaid?.issues ?? sectionRaid?.rows ?? sectionRaid?.table?.rows ?? [],
    ["issue"]
  );
  if (openIssues > 0) {
    out.push({
      trigger_key: "closure.open_issues.remaining",
      target_artifact_type: artifactType || "closure_report",
      suggestion_type: "risk",
      severity: "high",
      title: "Open issues remain at closure",
      body: `The closure report still indicates ${openIssues} open issue${openIssues === 1 ? "" : "s"}. Resolve or formally hand over these items before closure.`,
      rationale: "Triggered because unresolved issues were detected in the closure evidence.",
      evidence: { open_issues: openIssues, section_key: sectionRaid?.key ?? null },
    });
  }

  const pendingChanges = countPendingChanges(
    sectionChanges?.items ?? sectionChanges?.change_requests ?? sectionChanges?.rows ?? sectionChanges?.table?.rows ?? []
  );
  if (pendingChanges > 0) {
    out.push({
      trigger_key: "closure.pending_changes.remaining",
      target_artifact_type: artifactType || "closure_report",
      suggestion_type: "consistency",
      severity: "medium",
      title: "Pending changes remain at closure",
      body: `There ${pendingChanges === 1 ? "is" : "are"} still ${pendingChanges} pending change request${
        pendingChanges === 1 ? "" : "s"
      }. Confirm approval, rejection, or carry-forward before final closure.`,
      rationale: "Triggered because change requests appear to remain open while closure is being prepared.",
      evidence: { pending_changes: pendingChanges, section_key: sectionChanges?.key ?? null },
    });
  }

  const overdueMilestones = countOverdueMilestones(
    sectionMilestones?.items ?? sectionMilestones?.milestones ?? sectionMilestones?.rows ?? sectionMilestones?.table?.rows ?? []
  );
  if (overdueMilestones > 0) {
    out.push({
      trigger_key: "closure.overdue_milestones.remaining",
      target_artifact_type: artifactType || "closure_report",
      suggestion_type: "consistency",
      severity: "medium",
      title: "Overdue milestones remain in closure evidence",
      body: `The closure data still shows ${overdueMilestones} overdue milestone${
        overdueMilestones === 1 ? "" : "s"
      }. Confirm whether these are complete, waived, or intentionally excluded from closure.`,
      rationale: "Triggered because schedule evidence still suggests overdue milestones at closure.",
      evidence: { overdue_milestones: overdueMilestones, section_key: sectionMilestones?.key ?? null },
    });
  }

  return out;
}

/**
 * 🔥 Core rules: deterministic + explainable.
 */
function runRules(args: { ctx: TriggerContext; artifact?: any | null }): TriggerResult[] {
  const { ctx, artifact } = args;
  const out: TriggerResult[] = [];

  // Rule 1: Charter milestones missing dates (compliance)
  if (ctx.event.event_type === "artifact_submitted" && safeStr(artifact?.type) === "project_charter") {
    const artifactJson = artifact?.content_json ?? artifact?.json ?? {};
    const sections = artifactJson?.sections ?? [];
    const milestones = sections.find((s: any) => s?.key === "milestones");
    const rows = milestones?.table?.rows ?? [];
    const hasAnyDate = rows.some((r: any) =>
      (r?.cells ?? []).some((c: any) => /\d{4}-\d{2}-\d{2}/.test(String(c)))
    );

    if (!hasAnyDate) {
      out.push({
        trigger_key: "charter.milestones.missing_dates",
        target_artifact_type: normalizeArtifactType(artifact?.type) || "project_charter",
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
        target_artifact_type: normalizeArtifactType(artifact?.type) || null,
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
  if (ctx.event.event_type === "artifact_saved" && safeLower(artifact?.approval_status) === "submitted") {
    const changed = Boolean(ctx.event.payload?.diff?.length);
    if (changed) {
      out.push({
        trigger_key: "artifact.change.after_submission",
        target_artifact_type: normalizeArtifactType(artifact?.type) || null,
        suggestion_type: "consistency",
        severity: "high",
        title: "Changes detected after submission",
        body: "This artifact is submitted/locked. Consider requesting changes formally or reverting edits to preserve audit integrity.",
        rationale: "Triggered because edits were saved while the artifact was in a submitted state.",
        evidence: { diff: ctx.event.payload?.diff ?? [] },
      });
    }
  }

  // Rule 4+: Closure governance rules
  if (artifact) {
    out.push(...buildClosureRules(ctx, artifact));
  }

  return out;
}

export async function processEventAndGenerateSuggestions(eventId: string) {
  const supabase = await createClient();

  const { data: event, error } = await supabase.from("project_events").select("*").eq("id", eventId).single();

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