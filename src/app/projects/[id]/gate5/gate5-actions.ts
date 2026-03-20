"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

export type Gate5Check = {
  key: string;
  category: "auto" | "manual";
  title: string;
  description: string;
  detail?: string;
  status: "pass" | "fail" | "warn" | "manual_pending" | "manual_done";
  mandatory: boolean;
  actionLabel?: string;
  actionHref?: string;
  notes?: string;
  completedBy?: string;
  completedAt?: string;
};

export type Gate5Result = {
  readinessScore: number;
  totalChecks: number;
  passedChecks: number;
  mandatoryBlocked: number;
  canClose: boolean;
  daysToEndDate: number | null;
  riskLevel: "green" | "amber" | "red";
  checks: Gate5Check[];
};

export async function loadGate5Status(projectId: string): Promise<Gate5Result> {
  const supabase = await createClient();

  // 1. Fetch Project Basics
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .single();

  // 2. Fetch Manual Confirmations
  const { data: manualEntries } = await supabase
    .from("project_closure_checks")
    .select("*")
    .eq("project_id", projectId);

  // 3. Automated Logic (Mocked logic for demo - replace with your actual DB queries)
  // Example: Check if all milestones are 100%
  const { data: milestones } = await supabase.from("milestones").select("progress").eq("project_id", projectId);
  const allMilestonesDone = milestones?.every(m => m.progress === 100) ?? false;

  const checks: Gate5Check[] = [
    {
      key: "milestones_complete",
      category: "auto",
      title: "All Milestones Finished",
      description: "Checks if every milestone progress is at 100%.",
      status: allMilestonesDone ? "pass" : "fail",
      mandatory: true,
      actionLabel: "View Schedule",
      actionHref: `/projects/${projectId}/schedule`
    },
    {
      key: "handover_doc",
      category: "manual",
      title: "Handover Documentation",
      description: "Technical debt registered and handover docs signed by Ops.",
      status: manualEntries?.find(e => e.check_key === "handover_doc")?.is_done ? "manual_done" : "manual_pending",
      mandatory: true,
      notes: manualEntries?.find(e => e.check_key === "handover_doc")?.notes,
      completedBy: "Project Lead"
    }
    // Add more checks here...
  ];

  const passed = checks.filter(c => c.status === "pass" || c.status === "manual_done").length;
  const mandatoryBlocked = checks.filter(c => c.mandatory && c.status !== "pass" && c.status !== "manual_done").length;
  
  return {
    readinessScore: Math.round((passed / checks.length) * 100),
    totalChecks: checks.length,
    passedChecks: passed,
    mandatoryBlocked,
    canClose: mandatoryBlocked === 0,
    daysToEndDate: 5, // Calculate from project.end_date
    riskLevel: "amber",
    checks
  };
}

export async function toggleManualCheck(projectId: string, key: string, done: boolean, notes?: string) {
  const supabase = await createClient();
  if (done) {
    await supabase.from("project_closure_checks").upsert({
      project_id: projectId,
      check_key: key,
      is_done: true,
      notes,
      completed_at: new Date().toISOString()
    });
  } else {
    await supabase.from("project_closure_checks").delete().match({ project_id: projectId, check_key: key });
  }
  revalidatePath(`/projects/${projectId}/gate5`);
}

export async function getAiGate5Guidance(projectId: string, blockedItems: any[]) {
  // Logic to call your AI provider (OpenAI/Anthropic/Gemini)
  return "Based on your blocked items, you should first finalize the Handover Documentation. Contact the Ops team for the template.";
}
