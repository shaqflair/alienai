"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type ResourceJustification = {
  id: string;
  project_id: string;
  justification_text: string;
  contingency_notes: string;
  requested_budget_uplift: number | null;
  currency: string;
  linked_cr_ids: string[];
  status: "draft" | "sent" | "acknowledged" | "approved" | "rejected";
  sent_at: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ResourceBudgetSummary = {
  totalBudgetDays: number;
  allocatedDays: number;
  remainingDays: number;
  overBudget: boolean;
  weeklyBurnRate: number;
  budgetGbp: number | null;
  spentGbp: number | null;
  remainingGbp: number | null;
  utilisationPct: number;
};

export type OpenCR = {
  id: string;
  title: string;
  status: string;
  change_type: string | null;
  estimated_cost: number | null;
  requested_days: number | null;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function loadResourceJustificationData(projectId: string): Promise<{
  justification: ResourceJustification | null;
  budgetSummary: ResourceBudgetSummary | null;
  openCRs: OpenCR[];
  roleRequirements: Array<{ id: string; role: string; required_days: number | null; filled_days: number | null }>;
}> {
  const supabase = await createClient();

  const [justificationResult, projectResult, crsResult, rolesResult] = await Promise.allSettled([
    supabase
      .from("project_resource_justifications")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("projects")
      .select("id, budget_amount, finish_date, start_date")
      .eq("id", projectId)
      .maybeSingle(),
    supabase
      .from("change_requests")
      .select("id, title, status, change_type, estimated_cost, requested_days")
      .eq("project_id", projectId)
      .in("status", ["open", "pending", "submitted", "draft", "approved"])
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("project_role_requirements")
      .select("id, role, required_days, filled_days")
      .eq("project_id", projectId)
      .limit(50),
  ]);

  const justification =
    justificationResult.status === "fulfilled"
      ? ((justificationResult.value.data as ResourceJustification) ?? null)
      : null;

  const project =
    projectResult.status === "fulfilled" ? projectResult.value.data : null;

  const openCRs =
    crsResult.status === "fulfilled"
      ? ((crsResult.value.data ?? []) as OpenCR[])
      : [];

  const roles =
    rolesResult.status === "fulfilled"
      ? (rolesResult.value.data ?? []) as Array<{ id: string; role: string; required_days: number | null; filled_days: number | null }>
      : [];

  // Compute budget summary from project
  const budgetGbp = (project as any)?.budget_amount
    ? Number((project as any).budget_amount)
    : null;

  return {
    justification,
    budgetSummary: budgetGbp
      ? {
          totalBudgetDays: 0,
          allocatedDays: 0,
          remainingDays: 0,
          overBudget: false,
          weeklyBurnRate: 0,
          budgetGbp,
          spentGbp: null,
          remainingGbp: null,
          utilisationPct: 0,
        }
      : null,
    openCRs,
    roleRequirements: roles,
  };
}

export async function saveResourceJustification(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const projectId = safeStr(formData.get("project_id")).trim();
  const justificationText = safeStr(formData.get("justification_text")).trim();
  const contingencyNotes = safeStr(formData.get("contingency_notes")).trim();
  const requestedBudgetUplift = formData.get("requested_budget_uplift");
  const linkedCrIds = safeStr(formData.get("linked_cr_ids")).trim();
  const currency = safeStr(formData.get("currency") || "GBP").trim();

  if (!projectId) return { ok: false, error: "Project ID required." };

  const uplift =
    requestedBudgetUplift && String(requestedBudgetUplift).trim()
      ? Number(requestedBudgetUplift)
      : null;

  const crIds = linkedCrIds
    ? linkedCrIds
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  const now = new Date().toISOString();

  const payload = {
    project_id: projectId,
    justification_text: justificationText,
    contingency_notes: contingencyNotes,
    requested_budget_uplift: uplift,
    currency,
    linked_cr_ids: crIds,
    status: "draft",
    updated_at: now,
    updated_by: auth.user.id,
  };

  const { error } = await supabase
    .from("project_resource_justifications")
    .upsert(
      { ...payload, created_at: now, created_by: auth.user.id },
      { onConflict: "project_id" }
    );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function sendJustificationToResourceTeam(
  projectId: string,
  justificationId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("project_resource_justifications")
    .update({
      status: "sent",
      sent_at: now,
      sent_by: auth.user.id,
      updated_at: now,
    })
    .eq("id", justificationId)
    .eq("project_id", projectId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true };
}

export async function generateAiJustification(
  projectId: string,
  context: {
    roleRequirements: Array<{ role: string; required_days: number | null; filled_days: number | null }>;
    allocatedDays: number;
    budgetDays: number;
    remainingBudgetGbp: number | null;
    budgetGbp: number | null;
    openCRs: Array<{ title: string; status: string; estimated_cost: number | null }>;
    projectTitle: string;
    weeklyBurnRate: number;
  }
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const unfilledRoles = context.roleRequirements.filter(
    (r) => (r.required_days ?? 0) > (r.filled_days ?? 0)
  );

  const shortfall = context.budgetDays > 0
    ? context.budgetDays - context.allocatedDays
    : null;

  const prompt = `You are a senior PMO analyst writing a resource justification for a project.

Project: ${context.projectTitle}
Current allocation: ${context.allocatedDays} days allocated
Budget capacity: ${context.budgetDays > 0 ? context.budgetDays + " days" : "not set"}
${shortfall !== null ? `Shortfall: ${Math.abs(shortfall)} days ${shortfall < 0 ? "OVER budget" : "remaining"}` : ""}
${context.budgetGbp ? `Approved budget: £${context.budgetGbp.toLocaleString()}` : ""}
${context.remainingBudgetGbp !== null ? `Remaining budget: £${context.remainingBudgetGbp.toLocaleString()}` : ""}
Weekly burn rate: ${context.weeklyBurnRate} days/week

Unfilled roles:
${unfilledRoles.length > 0 ? unfilledRoles.map((r) => `- ${r.role}: needs ${(r.required_days ?? 0) - (r.filled_days ?? 0)} more days`).join("\n") : "None"}

Open change requests:
${context.openCRs.length > 0 ? context.openCRs.map((cr) => `- ${cr.title} (${cr.status})${cr.estimated_cost ? ` — £${cr.estimated_cost.toLocaleString()}` : ""}`).join("\n") : "None"}

Write a concise (150-200 word) professional resource justification that:
1. States why additional resources are needed based on the data above
2. References the current plan gap and burn rate
3. Explains the business risk of not filling the roles
4. Recommends a specific course of action

Use plain professional language. No bullet points — write in paragraphs. Do not use markdown.`;

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o",
        max_tokens: 1000,
        messages: [
          {
            role: "system",
            content: "You are a senior PMO analyst. Write concise, professional resource justifications based on project data provided. Write in plain paragraphs, no bullet points, no markdown.",
          },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!res.ok) return { ok: false, error: "AI service unavailable." };

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || "";
    return { ok: true, text: text.trim() };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? "AI generation failed") };
  }
}
