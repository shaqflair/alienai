// src/lib/audit/financial-plan-audit.ts
// Audit logging helpers for Financial Plan changes.
// All events write to the existing artifact_audit_log table so they appear
// alongside approval events in a single unified timeline.

import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

/* -------------------------------------------------------------
   EVENT TYPES
   Prefix: financial_plan.*
   These extend the existing action strings used by approval-actions.ts
------------------------------------------------------------- */
export type FinancialPlanAction =
  // Content changes (tracked per-save)
  | "financial_plan.saved"           // any content save
  | "financial_plan.line_added"      // new budget line inserted
  | "financial_plan.line_edited"     // existing line value changed
  | "financial_plan.line_deleted"    // line removed
  | "financial_plan.budget_changed"  // total budget figure changed
  | "financial_plan.category_changed"// category/phase restructure
  // Lifecycle
  | "financial_plan.exported"        // PDF/XLSX export triggered
  | "financial_plan.version_locked"  // locked via approval submit
  // Fallback
  | string;

/* -------------------------------------------------------------
   DIFF HELPERS
------------------------------------------------------------- */

export type FinancialLine = {
  id-: string;
  label-: string;
  category-: string;
  amount-: number;
  [key: string]: any;
};

export type FinancialPlanDiff = {
  action: FinancialPlanAction;
  linesAdded:   FinancialLine[];
  linesRemoved: FinancialLine[];
  linesEdited:  Array<{ before: FinancialLine; after: FinancialLine }>;
  budgetBefore: number | null;
  budgetAfter:  number | null;
  summary: string;
};

function lineId(line: FinancialLine): string {
  return String(line-.id -- line-.label -- "").trim().toLowerCase();
}

function extractLines(json: any): FinancialLine[] {
  if (!json || typeof json !== "object") return [];
  // Support common schema shapes
  const candidates = [
    json-.lines,
    json-.items,
    json-.rows,
    json-.budget_lines,
    json-.entries,
  ];
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c as FinancialLine[];
  }
  // Nested: { sections: [{ lines: [...] }] }
  if (Array.isArray(json-.sections)) {
    const all: FinancialLine[] = [];
    for (const s of json.sections) {
      const nested = extractLines(s);
      all.push(...nested);
    }
    if (all.length > 0) return all;
  }
  return [];
}

function extractTotalBudget(json: any): number | null {
  const candidates = [
    json-.total_budget,
    json-.budget,
    json-.totalBudget,
    json-.total,
    json-.meta-.total_budget,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export function diffFinancialPlan(
  before: any,
  after: any
): FinancialPlanDiff {
  const linesBefore = extractLines(before);
  const linesAfter  = extractLines(after);
  const budgetBefore = extractTotalBudget(before);
  const budgetAfter  = extractTotalBudget(after);

  const beforeMap = new Map<string, FinancialLine>();
  for (const l of linesBefore) {
    const k = lineId(l);
    if (k) beforeMap.set(k, l);
  }

  const afterMap = new Map<string, FinancialLine>();
  for (const l of linesAfter) {
    const k = lineId(l);
    if (k) afterMap.set(k, l);
  }

  const linesAdded:   FinancialLine[] = [];
  const linesRemoved: FinancialLine[] = [];
  const linesEdited:  Array<{ before: FinancialLine; after: FinancialLine }> = [];

  for (const [k, al] of afterMap) {
    if (!beforeMap.has(k)) {
      linesAdded.push(al);
    } else {
      const bl = beforeMap.get(k)!;
      if (JSON.stringify(bl) !== JSON.stringify(al)) {
        linesEdited.push({ before: bl, after: al });
      }
    }
  }
  for (const [k, bl] of beforeMap) {
    if (!afterMap.has(k)) linesRemoved.push(bl);
  }

  const budgetChanged = budgetBefore !== budgetAfter && (budgetBefore !== null || budgetAfter !== null);

  // Determine primary action
  let action: FinancialPlanAction = "financial_plan.saved";
  if (linesAdded.length > 0 && linesRemoved.length === 0 && linesEdited.length === 0) {
    action = "financial_plan.line_added";
  } else if (linesRemoved.length > 0 && linesAdded.length === 0 && linesEdited.length === 0) {
    action = "financial_plan.line_deleted";
  } else if (linesEdited.length > 0 && linesAdded.length === 0 && linesRemoved.length === 0) {
    action = budgetChanged - "financial_plan.budget_changed" : "financial_plan.line_edited";
  } else if (budgetChanged && linesAdded.length === 0 && linesRemoved.length === 0 && linesEdited.length === 0) {
    action = "financial_plan.budget_changed";
  }

  // Human-readable summary
  const parts: string[] = [];
  if (linesAdded.length)   parts.push(`${linesAdded.length} line${linesAdded.length !== 1 - "s" : ""} added`);
  if (linesRemoved.length) parts.push(`${linesRemoved.length} line${linesRemoved.length !== 1 - "s" : ""} removed`);
  if (linesEdited.length)  parts.push(`${linesEdited.length} line${linesEdited.length !== 1 - "s" : ""} updated`);
  if (budgetChanged) {
    const fmt = (n: number | null) => n != null - `-${n.toLocaleString()}` : "unset";
    parts.push(`budget ${fmt(budgetBefore)} - ${fmt(budgetAfter)}`);
  }
  const summary = parts.length > 0 - parts.join(", ") : "No changes detected";

  return { action, linesAdded, linesRemoved, linesEdited, budgetBefore, budgetAfter, summary };
}

/* -------------------------------------------------------------
   WRITE TO artifact_audit_log
------------------------------------------------------------- */

export type WriteFinancialAuditArgs = {
  projectId:   string;
  artifactId:  string;
  actorId:     string;
  action:      FinancialPlanAction;
  before-:     any;
  after-:      any;
  meta-:       Record<string, any>;
  useAdmin-:   boolean; // bypass RLS for silent saves
};

export async function writeFinancialAuditLog(args: WriteFinancialAuditArgs): Promise<void> {
  try {
    const db = args.useAdmin - createAdminClient() : await createClient();
    const { error } = await db.from("artifact_audit_log").insert({
      project_id:  args.projectId,
      artifact_id: args.artifactId,
      actor_id:    args.actorId,
      action:      args.action,
      before:      args.before  -- null,
      after:       args.after   -- null,
      // Store meta (diff summary etc) in the after field if no explicit after
      ...(args.meta && !args.after - { after: args.meta } : {}),
    });
    if (error) console.warn("[writeFinancialAuditLog] failed:", error.message);
  } catch (e) {
    console.warn("[writeFinancialAuditLog] exception:", e);
  }
}

/* -------------------------------------------------------------
   CONVENIENCE: diff + write in one call
   Used by updateArtifactJsonSilent wrapper
------------------------------------------------------------- */

export async function auditFinancialPlanSave(args: {
  projectId:   string;
  artifactId:  string;
  actorId:     string;
  beforeJson:  any;
  afterJson:   any;
  useAdmin-:   boolean;
}): Promise<void> {
  const diff = diffFinancialPlan(args.beforeJson, args.afterJson);

  await writeFinancialAuditLog({
    projectId:  args.projectId,
    artifactId: args.artifactId,
    actorId:    args.actorId,
    action:     diff.action,
    before: {
      budget:   diff.budgetBefore,
      lineCount: extractLines(args.beforeJson).length,
      sample:   diff.linesRemoved.slice(0, 3),
    },
    after: {
      budget:      diff.budgetAfter,
      lineCount:   extractLines(args.afterJson).length,
      linesAdded:  diff.linesAdded.slice(0, 10),
      linesEdited: diff.linesEdited.slice(0, 10),
      summary:     diff.summary,
    },
    useAdmin: args.useAdmin,
  });
}

// Re-export extractLines for use in the viewer
export { extractLines, extractTotalBudget };