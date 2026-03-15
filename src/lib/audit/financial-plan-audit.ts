// src/lib/audit/financial-plan-audit.ts
// Audit logging for financial plan artifact changes.
// Writes to artifact_audit_log via admin client (bypasses RLS).
import "server-only";
import { createAdminClient } from "@/utils/supabase/admin";

/* ACTION TYPES */
export type FinancialPlanAction =
  | "financial_plan.saved"
  | "financial_plan.line_added"
  | "financial_plan.line_edited"
  | "financial_plan.line_deleted"
  | "financial_plan.budget_changed"
  | "financial_plan.category_changed"
  | "financial_plan.exported"
  | "financial_plan.version_locked"
  | string;

/* TYPES */
export type FinancialLine = {
  id: string;
  label: string;
  category: string;
  budgetTotal?: number;
  forecastTotal?: number;
};

export type FinancialPlanSnapshot = {
  lines: FinancialLine[];
  totalBudget: number;
  currency?: string;
};

/* WRITE */
export async function writeFinancialAuditLog(args: {
  projectId: string;
  artifactId: string;
  actorId: string;
  action: FinancialPlanAction;
  before?: Record<string, any> | null;
  after?: Record<string, any> | null;
  requestId?: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("artifact_audit_log").insert({
      project_id:   args.projectId,
      artifact_id:  args.artifactId,
      actor_id:     args.actorId,
      action:       args.action,
      before:       args.before  ?? null,
      after:        args.after   ?? null,
      request_id:   args.requestId ?? null,
    });
    if (error) console.warn("[writeFinancialAuditLog] failed:", error.message);
  } catch (e) {
    console.warn("[writeFinancialAuditLog] exception:", e);
  }
}

/* HELPERS */
export function extractLines(json: any): FinancialLine[] {
  try {
    const lines = json?.cost_lines ?? json?.lines ?? [];
    return Array.isArray(lines) ? lines.map((l: any) => ({
      id:            String(l.id ?? ""),
      label:         String(l.description ?? l.label ?? l.name ?? ""),
      category:      String(l.category ?? ""),
      budgetTotal:   Number(l.budget_total ?? l.budget ?? 0) || 0,
      forecastTotal: Number(l.forecast_total ?? l.forecast ?? 0) || 0,
    })) : [];
  } catch { return []; }
}

export function extractTotalBudget(json: any): number {
  try {
    const lines = extractLines(json);
    return lines.reduce((s, l) => s + (l.budgetTotal ?? 0), 0);
  } catch { return 0; }
}

export function diffFinancialPlan(before: any, after: any): {
  linesAdded:   FinancialLine[];
  linesDeleted: FinancialLine[];
  linesEdited:  { before: FinancialLine; after: FinancialLine }[];
  budgetBefore: number;
  budgetAfter:  number;
  budgetChanged: boolean;
} {
  const bLines = extractLines(before);
  const aLines = extractLines(after);

  const bMap = new Map(bLines.map(l => [l.id, l]));
  const aMap = new Map(aLines.map(l => [l.id, l]));

  const linesAdded   = aLines.filter(l => !bMap.has(l.id));
  const linesDeleted = bLines.filter(l => !aMap.has(l.id));
  const linesEdited: { before: FinancialLine; after: FinancialLine }[] = [];

  for (const al of aLines) {
    const bl = bMap.get(al.id);
    if (!bl) continue;
    if (bl.label !== al.label || bl.category !== al.category ||
        bl.budgetTotal !== al.budgetTotal || bl.forecastTotal !== al.forecastTotal) {
      linesEdited.push({ before: bl, after: al });
    }
  }

  const budgetBefore = extractTotalBudget(before);
  const budgetAfter  = extractTotalBudget(after);

  return {
    linesAdded,
    linesDeleted,
    linesEdited,
    budgetBefore,
    budgetAfter,
    budgetChanged: Math.abs(budgetBefore - budgetAfter) > 0.01,
  };
}

export async function auditFinancialPlanSave(args: {
  projectId:   string;
  artifactId:  string;
  actorId:     string;
  beforeJson:  any;
  afterJson:   any;
  useAdmin?:   boolean;
}): Promise<void> {
  try {
    const diff = diffFinancialPlan(args.beforeJson, args.afterJson);
    const requestId = `fp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const base = {
      projectId:  args.projectId,
      artifactId: args.artifactId,
      actorId:    args.actorId,
      requestId,
    };

    const writes: Promise<void>[] = [];

    writes.push(writeFinancialAuditLog({
      ...base,
      action: "financial_plan.saved",
      after: {
        lines_count:   extractLines(args.afterJson).length,
        total_budget:  diff.budgetAfter,
        lines_added:   diff.linesAdded.length,
        lines_deleted: diff.linesDeleted.length,
        lines_edited:  diff.linesEdited.length,
        currency:      args.afterJson?.currency ?? null,
      },
    }));

    for (const l of diff.linesAdded) {
      writes.push(writeFinancialAuditLog({
        ...base,
        action: "financial_plan.line_added",
        after:  { id: l.id, label: l.label, category: l.category, budget: l.budgetTotal },
      }));
    }

    for (const l of diff.linesDeleted) {
      writes.push(writeFinancialAuditLog({
        ...base,
        action: "financial_plan.line_deleted",
        before: { id: l.id, label: l.label, category: l.category, budget: l.budgetTotal },
      }));
    }

    for (const { before, after } of diff.linesEdited) {
      writes.push(writeFinancialAuditLog({
        ...base,
        action: "financial_plan.line_edited",
        before: { id: before.id, label: before.label, category: before.category, budget: before.budgetTotal, forecast: before.forecastTotal },
        after:  { id: after.id,  label: after.label,  category: after.category,  budget: after.budgetTotal,  forecast: after.forecastTotal },
      }));
    }

    if (diff.budgetChanged) {
      writes.push(writeFinancialAuditLog({
        ...base,
        action: "financial_plan.budget_changed",
        before: { total_budget: diff.budgetBefore },
        after:  { total_budget: diff.budgetAfter, delta: diff.budgetAfter - diff.budgetBefore },
      }));
    }

    await Promise.allSettled(writes);
  } catch (e) {
    console.warn("[auditFinancialPlanSave] exception:", e);
  }
}