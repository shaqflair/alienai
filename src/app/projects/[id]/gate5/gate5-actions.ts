"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type Gate5CheckStatus = "pass" | "fail" | "warn" | "manual_pending" | "manual_done";

export type Gate5Check = {
  key: string;
  title: string;
  description: string;
  category: "auto" | "manual";
  mandatory: boolean;
  status: Gate5CheckStatus;
  detail?: string | null;
  actionLabel?: string | null;
  actionHref?: string | null;
  completedBy?: string | null;
  completedAt?: string | null;
  notes?: string | null;
};

export type Gate5Result = {
  checks: Gate5Check[];
  totalChecks: number;
  passedChecks: number;
  mandatoryBlocked: number;
  readinessScore: number;
  daysToEndDate: number | null;
  endDate: string | null;
  riskLevel: "green" | "amber" | "red";
  canClose: boolean;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function loadGate5Status(projectId: string): Promise<Gate5Result | null> {
  try {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return null;

  // Load project details
  const { data: project } = await supabase
    .from("projects")
    .select("id, title, finish_date, end_date, target_end_date, status")
    .eq("id", projectId)
    .maybeSingle();

  const endDateRaw =
    (project as any)?.finish_date ||
    (project as any)?.end_date ||
    (project as any)?.target_end_date ||
    null;

  const endDate = endDateRaw ? new Date(endDateRaw) : null;
  const daysToEndDate = endDate
    ? Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  // Load all artifacts for this project
  const { data: artifacts } = await supabase
    .from("artifacts")
    .select("id, type, approval_status, content_json, content, title, is_current, updated_at")
    .eq("project_id", projectId)
    .eq("is_current", true);

  const arts = Array.isArray(artifacts) ? artifacts : [];

  function findArtifact(types: string[]) {
    return arts.find((a) => {
      const t = safeStr((a as any).type).toLowerCase().trim();
      return types.some((type) => t.includes(type));
    });
  }

  function approvalStatus(artifact: any) {
    return safeStr((artifact as any)?.approval_status).toLowerCase();
  }

  // Load change requests
  const { data: changeRequests } = await supabase
    .from("change_requests")
    .select("id, status, title")
    .eq("project_id", projectId);

  const crs = Array.isArray(changeRequests) ? changeRequests : [];
  const openCRs = crs.filter((cr) => {
    const s = safeStr((cr as any).status).toLowerCase();
    return !["approved", "rejected", "closed", "cancelled", "withdrawn"].includes(s);
  });

  // Load manual check completions
  const { data: manualChecks } = await supabase
    .from("project_gate5_checks")
    .select("check_key, completed, completed_by, completed_at, notes")
    .eq("project_id", projectId);

  const manualMap = new Map<string, any>();
  for (const mc of Array.isArray(manualChecks) ? manualChecks : []) {
    manualMap.set(safeStr((mc as any).check_key), mc);
  }

  // Load profile names for manual check completors
  const completorIds = Array.from(manualMap.values())
    .map((m) => safeStr(m?.completed_by))
    .filter(Boolean);

  const profileMap = new Map<string, string>();
  if (completorIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, display_name, email")
      .or(completorIds.map((id) => `user_id.eq.${id}`).join(","));
    for (const p of Array.isArray(profiles) ? profiles : []) {
      const name =
        safeStr((p as any).full_name).trim() ||
        safeStr((p as any).display_name).trim() ||
        safeStr((p as any).email).trim();
      const uid = safeStr((p as any).user_id || (p as any).id);
      if (uid && name) profileMap.set(uid, name);
    }
  }

  function manualCheck(key: string): Gate5CheckStatus {
    const m = manualMap.get(key);
    return m?.completed ? "manual_done" : "manual_pending";
  }

  function manualMeta(key: string) {
    const m = manualMap.get(key);
    if (!m) return {};
    return {
      completedBy: m.completed_by ? profileMap.get(m.completed_by) || null : null,
      completedAt: m.completed_at || null,
      notes: m.notes || null,
    };
  }

  // ── Check: RAID all closed ──
  const charterArt = findArtifact(["charter", "pid"]);
  let raidStatus: Gate5CheckStatus = "warn";
  let raidDetail = "Charter not found — RAID status unknown.";

  if (charterArt) {
    const json = (charterArt as any).content_json;
    if (json && typeof json === "object" && Array.isArray(json.sections)) {
      const raidSections = json.sections.filter((s: any) =>
        ["risks", "issues", "assumptions", "dependencies"].includes(safeStr(s?.key).toLowerCase())
      );
      const hasContent = raidSections.some((s: any) => {
        const bullets = safeStr(s?.bullets).trim();
        return bullets.length > 10;
      });
      const hasTbcOrOpen = raidSections.some((s: any) => {
        const text = safeStr(s?.bullets).toLowerCase();
        return text.includes("[open]") || text.includes("tbc") || text.includes("[active]");
      });
      if (!hasContent) {
        raidStatus = "fail";
        raidDetail = "RAID sections appear empty. Please document risks, issues, assumptions and dependencies.";
      } else if (hasTbcOrOpen) {
        raidStatus = "warn";
        raidDetail = "Some RAID items are marked [TBC] or [OPEN]. Review and close before submission.";
      } else {
        raidStatus = "pass";
        raidDetail = "RAID sections have content and no open flags detected.";
      }
    } else {
      raidStatus = "warn";
      raidDetail = "Charter exists but RAID sections could not be parsed.";
    }
  }

  // ── Check: All CRs approved ──
  const crStatus: Gate5CheckStatus =
    crs.length === 0 ? "pass" : openCRs.length === 0 ? "pass" : "fail";
  const crDetail =
    crs.length === 0
      ? "No change requests recorded."
      : openCRs.length === 0
      ? `All ${crs.length} change request${crs.length > 1 ? "s" : ""} resolved.`
      : `${openCRs.length} change request${openCRs.length > 1 ? "s" : ""} still open: ${openCRs.slice(0, 3).map((c) => safeStr((c as any).title)).join(", ")}${openCRs.length > 3 ? "…" : ""}`;

  // ── Check: WBS complete ──
  const wbsArt = findArtifact(["wbs", "work_breakdown"]);
  let wbsStatus: Gate5CheckStatus = "fail";
  let wbsDetail = "No WBS artifact found. Create and complete the Work Breakdown Structure.";
  if (wbsArt) {
    const json = (wbsArt as any).content_json;
    const hasItems = json && (Array.isArray(json.items) ? json.items.length > 0 : !!json);
    if (hasItems) {
      wbsStatus = "pass";
      wbsDetail = `WBS artifact found and populated.`;
    } else {
      wbsStatus = "warn";
      wbsDetail = "WBS artifact exists but appears empty. Add work breakdown items.";
    }
  }

  // ── Check: Schedule marked complete ──
  const scheduleArt = findArtifact(["schedule", "gantt", "timeline"]);
  let scheduleStatus: Gate5CheckStatus = "fail";
  let scheduleDetail = "No schedule artifact found. Create and complete the project schedule.";
  if (scheduleArt) {
    const json = (scheduleArt as any).content_json;
    const isMarkedComplete =
      safeStr((json as any)?.status).toLowerCase() === "complete" ||
      safeStr((json as any)?.projectStatus).toLowerCase() === "complete" ||
      (scheduleArt as any).approval_status === "approved";
    if (isMarkedComplete) {
      scheduleStatus = "pass";
      scheduleDetail = "Schedule is marked as complete.";
    } else {
      scheduleStatus = "warn";
      scheduleDetail = "Schedule artifact exists. Mark it as complete when all tasks are done.";
    }
  }

  // ── Check: Financial Plan approved ──
  const finArt = findArtifact(["financial_plan", "financial plan", "budget"]);
  let finStatus: Gate5CheckStatus = "fail";
  let finDetail = "No Financial Plan artifact found.";
  if (finArt) {
    const s = approvalStatus(finArt);
    if (s === "approved") {
      finStatus = "pass";
      finDetail = "Financial Plan is approved.";
    } else if (s === "submitted") {
      finStatus = "warn";
      finDetail = "Financial Plan is submitted and awaiting approval.";
    } else {
      finStatus = "fail";
      finDetail = `Financial Plan is in '${s || "draft"}' status — it must be approved before closure.`;
    }
  }

  // ── Check: Lessons Learned captured ──
  const lessonsArt = findArtifact(["lessons", "lesson", "retrospective", "retro"]);
  let lessonsStatus: Gate5CheckStatus = "fail";
  let lessonsDetail = "No Lessons Learned artifact found. Capture project learnings before closing.";
  if (lessonsArt) {
    const content =
      safeStr((lessonsArt as any).content).trim() ||
      JSON.stringify((lessonsArt as any).content_json || "");
    if (content.length > 100) {
      lessonsStatus = "pass";
      lessonsDetail = "Lessons Learned artifact found and populated.";
    } else {
      lessonsStatus = "warn";
      lessonsDetail = "Lessons Learned artifact exists but appears sparse. Add more detail.";
    }
  }

  // ── Check: Project Closure Report submitted ──
  const closureArt = findArtifact(["closure", "closeout", "close_out", "project_closure"]);
  let closureStatus: Gate5CheckStatus = "fail";
  let closureDetail = "Project Closure Report not found. Create and submit it for approval.";
  if (closureArt) {
    const s = approvalStatus(closureArt);
    if (s === "approved") {
      closureStatus = "pass";
      closureDetail = "Project Closure Report is approved.";
    } else if (s === "submitted") {
      closureStatus = "pass";
      closureDetail = "Project Closure Report submitted — awaiting approval.";
    } else {
      closureStatus = "fail";
      closureDetail = `Closure Report is in '${s || "draft"}' status. Submit it for approval to complete Gate 5.`;
    }
  }

  const checks: Gate5Check[] = [
    {
      key: "raid_closed",
      title: "RAID items reviewed",
      description: "All risks, issues, assumptions and dependencies are documented and reviewed.",
      category: "auto",
      mandatory: true,
      status: raidStatus,
      detail: raidDetail,
      actionLabel: charterArt ? "Open charter" : "Create charter",
      actionHref: charterArt ? `/projects/${projectId}/artifacts/${(charterArt as any).id}` : `/projects/${projectId}/artifacts`,
    },
    {
      key: "crs_approved",
      title: "All change requests resolved",
      description: "No open change requests remain. All CRs are approved, rejected or closed.",
      category: "auto",
      mandatory: true,
      status: crStatus,
      detail: crDetail,
      actionLabel: openCRs.length > 0 ? "Review change requests" : undefined,
      actionHref: openCRs.length > 0 ? `/projects/${projectId}/change` : undefined,
    },
    {
      key: "wbs_complete",
      title: "WBS complete",
      description: "Work Breakdown Structure is fully built and all deliverables are captured.",
      category: "auto",
      mandatory: true,
      status: wbsStatus,
      detail: wbsDetail,
      actionLabel: wbsArt ? "Open WBS" : "Create WBS",
      actionHref: wbsArt ? `/projects/${projectId}/artifacts/${(wbsArt as any).id}` : `/projects/${projectId}/artifacts`,
    },
    {
      key: "schedule_complete",
      title: "Schedule marked complete",
      description: "Project schedule is finalised and marked as complete.",
      category: "auto",
      mandatory: true,
      status: scheduleStatus,
      detail: scheduleDetail,
      actionLabel: scheduleArt ? "Open schedule" : "Create schedule",
      actionHref: scheduleArt ? `/projects/${projectId}/schedule` : `/projects/${projectId}/artifacts`,
    },
    {
      key: "financials_approved",
      title: "Financial plan approved",
      description: "The financial plan has been reviewed and approved.",
      category: "auto",
      mandatory: true,
      status: finStatus,
      detail: finDetail,
      actionLabel: finArt ? "Open financial plan" : "Create financial plan",
      actionHref: finArt ? `/projects/${projectId}/artifacts/${(finArt as any).id}` : `/projects/${projectId}/financial-plan`,
    },
    {
      key: "lessons_learned",
      title: "Lessons learned captured",
      description: "Key learnings, what went well, and what to improve are documented.",
      category: "auto",
      mandatory: true,
      status: lessonsStatus,
      detail: lessonsDetail,
      actionLabel: "Capture lessons",
      actionHref: `/projects/${projectId}/artifacts`,
    },
    {
      key: "closure_submitted",
      title: "Closure report submitted",
      description: "The Project Closure Report is submitted for approval.",
      category: "auto",
      mandatory: true,
      status: closureStatus,
      detail: closureDetail,
      actionLabel: closureArt ? "Open closure report" : "Create closure report",
      actionHref: closureArt ? `/projects/${projectId}/artifacts/${(closureArt as any).id}` : `/projects/${projectId}/artifacts`,
    },
    {
      key: "billing_complete",
      title: "All billing completed",
      description: "All project invoices raised, purchase orders closed, and costs reconciled.",
      category: "manual",
      mandatory: true,
      status: manualCheck("billing_complete"),
      detail: manualCheck("billing_complete") === "manual_done" ? "Confirmed by team." : "Confirm all billing is finalised.",
      ...manualMeta("billing_complete"),
    },
    {
      key: "handover_complete",
      title: "Handover documentation signed",
      description: "Product/service has been handed over to operations with signed documentation.",
      category: "manual",
      mandatory: true,
      status: manualCheck("handover_complete"),
      detail: manualCheck("handover_complete") === "manual_done" ? "Handover confirmed." : "Confirm handover is complete and signed off.",
      ...manualMeta("handover_complete"),
    },
    {
      key: "team_released",
      title: "Team released and reallocated",
      description: "All project team members have been formally released and reallocated.",
      category: "manual",
      mandatory: false,
      status: manualCheck("team_released"),
      detail: manualCheck("team_released") === "manual_done" ? "Team release confirmed." : "Confirm team members have been released.",
      ...manualMeta("team_released"),
    },
  ];

  const passed = checks.filter((c) => c.status === "pass" || c.status === "manual_done").length;
  const mandatoryBlocked = checks.filter(
    (c) => c.mandatory && c.status !== "pass" && c.status !== "manual_done"
  ).length;
  const readinessScore = Math.round((passed / checks.length) * 100);
  const canClose = mandatoryBlocked === 0;
  const riskLevel =
    daysToEndDate !== null && daysToEndDate <= 7 && !canClose
      ? "red"
      : daysToEndDate !== null && daysToEndDate <= 14 && mandatoryBlocked > 2
      ? "amber"
      : canClose
      ? "green"
      : mandatoryBlocked <= 2
      ? "amber"
      : "red";

  return {
    checks,
    totalChecks: checks.length,
    passedChecks: passed,
    mandatoryBlocked,
    readinessScore,
    daysToEndDate,
    endDate: endDateRaw,
    riskLevel,
    canClose,
  };
  } catch {
    return null;
  }
}

export async function toggleManualCheck(
  projectId: string,
  checkKey: string,
  completed: boolean,
  notes?: string
) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("Unauthenticated");

  const now = new Date().toISOString();

  const { error } = await supabase.from("project_gate5_checks").upsert(
    {
      project_id: projectId,
      check_key: checkKey,
      completed,
      completed_by: completed ? auth.user.id : null,
      completed_at: completed ? now : null,
      notes: notes || null,
      updated_at: now,
    },
    { onConflict: "project_id,check_key" }
  );

  if (error) throw new Error(`Gate5 check update failed: ${error.message}`);

  revalidatePath(`/projects/${projectId}/gate5`);
}

export async function getAiGate5Guidance(
  projectId: string,
  blockedChecks: Array<{ key: string; title: string; detail: string }>
): Promise<string> {
  if (!blockedChecks.length) {
    return "All Gate 5 checks are passing — the project is ready for closure. Well done!";
  }

  const itemList = blockedChecks
    .map((c, i) => `${i + 1}. **${c.title}**: ${c.detail}`)
    .join("\n");

  const prompt = `You are a senior PMO consultant helping a project manager close their project.

The following Gate 5 closure checks are currently blocked:

${itemList}

Provide a concise, practical action plan (max 200 words) to resolve these items quickly. Be specific and prioritise the most critical items first. Use a pragmatic, supportive tone — the PM needs to get this done.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) return "AI guidance is temporarily unavailable. Please review the blocked items above.";

  const data = await res.json();
  const text = (data?.content || []).find((b: any) => b.type === "text")?.text || "";
  return text.trim() || "No guidance available at this time.";
}