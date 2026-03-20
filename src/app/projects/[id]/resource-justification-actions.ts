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

async function fetchOrgRateCard(supabase: any, projectId: string): Promise<Record<string, number>> {
  // Uses the existing v_resource_rates_latest view — single source of truth
  // with the settings page rate card (resource_rates table)
  try {
    const { data: project } = await supabase
      .from("projects")
      .select("organisation_id")
      .eq("id", projectId)
      .maybeSingle();

    const orgId = (project as any)?.organisation_id;
    if (!orgId) return {};

    // Query the view that already surfaces the latest effective rate per role
    const { data } = await supabase
      .from("v_resource_rates_latest")
      .select("role_label, rate, rate_type, resource_type, user_id")
      .eq("organisation_id", orgId);

    const map: Record<string, number> = {};

    // Build lookup — role-based rates (no user_id) take priority as defaults
    // Person-specific rates (user_id set) are available for individual overrides
    for (const row of data ?? []) {
      const label = safeStr(row.role_label).trim();
      if (!label) continue;
      const rate = Number(row.rate);
      if (!rate || rate <= 0) continue;

      // Convert monthly to daily if needed (÷ 20 working days)
      const dailyRate = safeStr(row.rate_type).toLowerCase() === "monthly"
        ? Math.round(rate / 20)
        : rate;

      // Role-based entry (no specific person) — use as default for that role
      if (!row.user_id) {
        map[label] = dailyRate;
        // Also try partial match keys e.g. "Project Manager" from "Senior Project Manager"
        const parts = label.split(" ");
        if (parts.length > 1) {
          const shortKey = parts.slice(1).join(" ");
          if (!map[shortKey]) map[shortKey] = dailyRate;
        }
      }
    }

    return map;
  } catch {
    return {};
  }
}

export async function loadOrgRateCardRoles(projectId: string): Promise<string[]> {
  // Returns role labels from the org rate card for use in role picker dropdowns
  try {
    const supabase = await createClient();
    const { data: project } = await supabase
      .from("projects")
      .select("organisation_id")
      .eq("id", projectId)
      .maybeSingle();
    const orgId = (project as any)?.organisation_id;
    if (!orgId) return [];
    const { data } = await supabase
      .from("v_resource_rates_latest")
      .select("role_label")
      .eq("organisation_id", orgId)
      .eq("rate_type", "day_rate")
      .order("role_label");
    return [...new Set((data ?? []).map((r: any) => safeStr(r.role_label)).filter(Boolean))].sort();
  } catch { return []; }
}

export async function loadResourceJustificationData(projectId: string): Promise<{
  justification: ResourceJustification | null;
  budgetSummary: ResourceBudgetSummary | null;
  openCRs: OpenCR[];
  roleRequirements: Array<{ id: string; role: string; required_days: number | null; filled_days: number | null }>;
} & { rateCard: Record<string, number> } | null> {
  try {
    const supabase = await createClient();

    const [justificationResult, crsResult, rolesResult] = await Promise.allSettled([
      supabase
        .from("project_resource_justifications")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("change_requests")
        .select("id, title, status, change_type, estimated_cost, requested_days")
        .eq("project_id", projectId)
        .in("status", ["open", "pending", "submitted", "draft", "approved"])
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("role_requirements")
        .select("id, role_title, seniority_level, required_days_per_week, start_date, end_date, filled_by_person_id")
        .eq("project_id", projectId)
        .limit(50),
    ]);

    const justification =
      justificationResult.status === "fulfilled" && !justificationResult.value.error
        ? ((justificationResult.value.data as ResourceJustification) ?? null)
        : null;

    const openCRs =
      crsResult.status === "fulfilled" && !crsResult.value.error
        ? ((crsResult.value.data ?? []) as OpenCR[])
        : [];

    const rolesRaw = rolesResult.status === "fulfilled" && !rolesResult.value.error
      ? (rolesResult.value.data ?? [])
      : [];

    // Map role_requirements schema to the shape the panel expects
    const roles = rolesRaw.map((r: any) => ({
      id:           safeStr(r.id),
      role:         `${safeStr(r.seniority_level)} ${safeStr(r.role_title)}`.trim(),
      required_days: r.required_days_per_week && r.start_date && r.end_date
        ? Math.round(Number(r.required_days_per_week) *
            Math.max(0, Math.ceil(
              (new Date(r.end_date).getTime() - new Date(r.start_date).getTime()) / (7 * 86400000)
            )))
        : null,
      filled_days:  r.filled_by_person_id ? null : 0, // 0 = unfilled
      role_title:   safeStr(r.role_title),
      seniority_level: safeStr(r.seniority_level),
    }));

    const rateCard = await fetchOrgRateCard(supabase, projectId);

    return {
      justification,
      budgetSummary: null,
      openCRs,
      roleRequirements: roles,
      rateCard,
    };
  } catch {
    // Table may not exist yet — return null so the panel simply doesn't render
    return null;
  }
}

export async function saveResourceJustification(formData: FormData): Promise<{ ok: boolean; id?: string | null; error?: string }> {
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

  // Upsert — one justification record per project, return the id
  const { data: upserted, error } = await supabase
    .from("project_resource_justifications")
    .upsert(
      { ...payload, created_at: now, created_by: auth.user.id },
      { onConflict: "project_id" }
    )
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, id: (upserted as any)?.id ?? null };
}

export async function sendJustificationToResourceTeam(
  projectId: string,
  justificationId: string,
  extraEmails?: string[]
): Promise<{ ok: boolean; error?: string; notifiedCount?: number; emailsSent?: number }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const now = new Date().toISOString();

  // 1. Mark as sent
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

  // 2. Load justification details for the notification
  const { data: justification } = await supabase
    .from("project_resource_justifications")
    .select("justification_text, requested_budget_uplift, currency")
    .eq("id", justificationId)
    .maybeSingle();

  // 3. Load project details
  const { data: project } = await supabase
    .from("projects")
    .select("title, organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  const orgId = (project as any)?.organisation_id;
  const projectTitle = safeStr((project as any)?.title || "a project");

  // 4. Find sender profile
  const { data: senderProfile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const senderName = safeStr((senderProfile as any)?.full_name || (senderProfile as any)?.email || "A project manager");

  // 5. Find resource team recipients — org admins + members with 'resource_manager' role
  let recipientIds: string[] = [];
  if (orgId) {
    const { data: orgMembers } = await supabase
      .from("organisation_members")
      .select("user_id, role")
      .eq("organisation_id", orgId)
      .is("removed_at", null)
      .in("role", ["admin", "owner", "resource_manager"]);

    recipientIds = (orgMembers ?? [])
      .map((m: any) => safeStr(m.user_id))
      .filter((id) => id && id !== auth.user.id); // exclude sender
  }

  // 6. Insert notifications for each recipient
  let notifiedCount = 0;
  if (recipientIds.length > 0) {
    const uplift = (justification as any)?.requested_budget_uplift;
    const currency = safeStr((justification as any)?.currency || "GBP");
    const upliftText = uplift ? ` — £${Number(uplift).toLocaleString("en-GB")} requested` : "";

    const notifications = recipientIds.map((userId) => ({
      user_id: userId,
      organisation_id: orgId,
      type: "resource_justification_submitted",
      title: `Resource justification submitted for ${projectTitle}`,
      body: `${senderName} has submitted a resource justification request for ${projectTitle}${upliftText}. Please review and approve.`,
      action_url: `/projects/${projectId}`,
      metadata: {
        project_id: projectId,
        justification_id: justificationId,
        sent_by: auth.user.id,
        sender_name: senderName,
      },
      is_read: false,
      created_at: now,
    }));

    const { error: notifError, data: inserted } = await supabase
      .from("notifications")
      .insert(notifications)
      .select("id");

    if (!notifError) notifiedCount = (inserted ?? []).length;
    // Silently ignore notification failures — the justification was still sent
  }

  // 7. Send emails to extra recipients if provided
  let emailsSent = 0;
  const validEmails = (extraEmails ?? []).map(e => safeStr(e).trim().toLowerCase()).filter(e => e.includes("@"));

  if (validEmails.length > 0) {
    const uplift = (justification as any)?.requested_budget_uplift;
    const currency = safeStr((justification as any)?.currency || "GBP");
    const upliftLine = uplift ? `\n\nBudget uplift requested: £${Number(uplift).toLocaleString("en-GB")}` : "";
    const justText = safeStr((justification as any)?.justification_text || "").slice(0, 500);
    const projectUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "https://aliena.co.uk"}/projects/${projectId}`;

    const emailBody = `${senderName} has submitted a resource justification request for ${projectTitle}.${upliftLine}

Justification:
${justText}${justText.length >= 500 ? "..." : ""}

Review and respond here: ${projectUrl}`;

    for (const email of validEmails) {
      try {
        // Use Resend if available, otherwise Supabase auth email
        if (process.env.RESEND_API_KEY) {
          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
            },
            body: JSON.stringify({
              from: process.env.RESEND_FROM_EMAIL ?? "noreply@aliena.co.uk",
              to: email,
              subject: `Resource justification: ${projectTitle}`,
              text: emailBody,
              html: `<p><strong>${senderName}</strong> has submitted a resource justification request for <strong>${projectTitle}</strong>.</p>${uplift ? `<p><strong>Budget uplift requested:</strong> £${Number(uplift).toLocaleString("en-GB")}</p>` : ""}<blockquote style="border-left:3px solid #e2e8f0;padding-left:12px;color:#475569">${justText.replace(/\n/g, "<br>")}${justText.length >= 500 ? "..." : ""}</blockquote><p><a href="${projectUrl}" style="background:#2563eb;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block;margin-top:8px">Review request →</a></p>`,
            }),
          });
          emailsSent++;
        }
        // If no email provider configured, silently skip — in-app notifications still sent
      } catch {
        // Never block the send flow on email failure
      }
    }
  }

  revalidatePath(`/projects/${projectId}`);
  return { ok: true, notifiedCount, emailsSent };
}

export async function reviseJustificationRequest(
  projectId: string,
  justificationId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: "Not authenticated" };

  const now = new Date().toISOString();

  const { error } = await supabase
    .from("project_resource_justifications")
    .update({
      status: "draft",
      sent_at: null,
      sent_by: null,
      updated_at: now,
      updated_by: auth.user.id,
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