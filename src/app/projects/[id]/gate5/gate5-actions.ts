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
  showBadge: boolean;
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
      .select("id, user_id, full_name, email")
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

  // ── Check: RAID all closed (queries raid_items table directly) ──
  const { data: raidItemsRaw } = await supabase
    .from("raid_items")
    .select("id, type, title, status")
    .eq("project_id", projectId);

  const raidItems = Array.isArray(raidItemsRaw) ? raidItemsRaw : [];
  const RAID_CLOSED_STATUSES = ["closed", "resolved", "done", "completed", "archived", "cancelled", "mitigated", "accepted"];
  const openRaidItems = raidItems.filter((r: any) => {
    const s = safeStr(r.status).toLowerCase().trim();
    return !RAID_CLOSED_STATUSES.includes(s);
  });

  let raidStatus: Gate5CheckStatus;
  let raidDetail: string;
  if (raidItems.length === 0) {
    raidStatus = "warn";
    raidDetail = "No RAID items found. Log and close all risks, issues, assumptions and dependencies before closure.";
  } else if (openRaidItems.length === 0) {
    raidStatus = "pass";
    raidDetail = `All ${raidItems.length} RAID item${raidItems.length > 1 ? "s" : ""} are closed or resolved.`;
  } else {
    const byType = openRaidItems.reduce((acc: any, r: any) => {
      const t = safeStr(r.type).toLowerCase() || "item";
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {});
    const typeBreakdown = Object.entries(byType).map(([t, n]) => `${n} ${t}${(n as number) > 1 ? "s" : ""}`).join(", ");
    raidStatus = "fail";
    raidDetail = `${openRaidItems.length} RAID item${openRaidItems.length > 1 ? "s" : ""} still open (${typeBreakdown}). All must be closed before project closure.`;
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

  // ── Check: WBS complete (queries wbs_items table directly) ──
  const { data: wbsItemsRaw } = await supabase
    .from("wbs_items")
    .select("id, title, status, progress_pct")
    .eq("project_id", projectId);

  const wbsItems = Array.isArray(wbsItemsRaw) ? wbsItemsRaw : [];
  const WBS_DONE_STATUSES = ["complete", "completed", "done", "closed", "delivered", "approved"];
  const openWbsItems = wbsItems.filter((w: any) => {
    const s = safeStr(w.status).toLowerCase().trim();
    const pct = Number(w.progress_pct ?? 0);
    return !WBS_DONE_STATUSES.includes(s) && pct < 100;
  });

  let wbsStatus: Gate5CheckStatus;
  let wbsDetail: string;
  const wbsArt = findArtifact(["wbs", "work_breakdown"]);
  if (wbsItems.length === 0 && !wbsArt) {
    wbsStatus = "fail";
    wbsDetail = "No WBS items found. Create and complete the Work Breakdown Structure before closure.";
  } else if (wbsItems.length === 0 && wbsArt) {
    wbsStatus = "warn";
    wbsDetail = "WBS artifact exists but no items are recorded. Populate the WBS and mark all items complete.";
  } else if (openWbsItems.length === 0) {
    wbsStatus = "pass";
    wbsDetail = `All ${wbsItems.length} WBS item${wbsItems.length > 1 ? "s" : ""} are complete.`;
  } else {
    wbsStatus = "fail";
    wbsDetail = `${openWbsItems.length} of ${wbsItems.length} WBS item${wbsItems.length > 1 ? "s" : ""} not yet complete. All deliverables must be done before closure.`;
  }

  // ── Check: Schedule milestones all complete ──
  const { data: milestonesRaw } = await supabase
    .from("schedule_milestones")
    .select("id, title, status, progress_pct, end_date, critical_path_flag")
    .eq("project_id", projectId);

  const milestones = Array.isArray(milestonesRaw) ? milestonesRaw : [];
  const MILESTONE_DONE_STATUSES = ["complete", "completed", "done", "closed", "delivered", "approved"];
  const openMilestones = milestones.filter((m: any) => {
    const s = safeStr(m.status).toLowerCase().trim();
    const pct = Number(m.progress_pct ?? 0);
    return !MILESTONE_DONE_STATUSES.includes(s) && pct < 100;
  });
  const criticalOpen = openMilestones.filter((m: any) => m.critical_path_flag === true);
  const scheduleArt = findArtifact(["schedule", "gantt", "timeline"]);

  let scheduleStatus: Gate5CheckStatus;
  let scheduleDetail: string;
  if (milestones.length === 0 && !scheduleArt) {
    scheduleStatus = "fail";
    scheduleDetail = "No schedule milestones found. Create the project schedule and mark all milestones complete before closure.";
  } else if (milestones.length === 0 && scheduleArt) {
    scheduleStatus = "warn";
    scheduleDetail = "Schedule artifact exists but no milestones are recorded. Add milestones and mark them complete.";
  } else if (openMilestones.length === 0) {
    scheduleStatus = "pass";
    scheduleDetail = `All ${milestones.length} milestone${milestones.length > 1 ? "s" : ""} are complete.`;
  } else if (criticalOpen.length > 0) {
    scheduleStatus = "fail";
    scheduleDetail = `${criticalOpen.length} critical path milestone${criticalOpen.length > 1 ? "s" : ""} still open (${openMilestones.length} total). All milestones must be complete before closure.`;
  } else {
    scheduleStatus = "warn";
    scheduleDetail = `${openMilestones.length} of ${milestones.length} milestone${milestones.length > 1 ? "s" : ""} not yet complete. Close all milestones before project closure.`;
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
      title: "All RAID items closed",
      description: "All risks, issues, assumptions and dependencies must be closed, resolved or mitigated before project closure.",
      category: "auto",
      mandatory: true,
      status: raidStatus,
      detail: raidDetail,
      actionLabel: openRaidItems.length > 0 ? `Close ${openRaidItems.length} open item${openRaidItems.length > 1 ? "s" : ""}` : "View RAID log",
      actionHref: `/projects/${projectId}/raid`,
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
      title: "WBS all items complete",
      description: "All Work Breakdown Structure items must be marked complete or delivered before closure.",
      category: "auto",
      mandatory: true,
      status: wbsStatus,
      detail: wbsDetail,
      actionLabel: wbsArt ? "Open WBS" : "Create WBS",
      actionHref: wbsArt ? `/projects/${projectId}/artifacts/${(wbsArt as any).id}` : `/projects/${projectId}/artifacts`,
    },
    {
      key: "schedule_complete",
      title: "All milestones complete",
      description: "All schedule milestones must be marked complete before the project can be closed.",
      category: "auto",
      mandatory: true,
      status: scheduleStatus,
      detail: scheduleDetail,
      actionLabel: openMilestones.length > 0 ? `Close ${openMilestones.length} milestone${openMilestones.length > 1 ? "s" : ""}` : "View schedule",
      actionHref: scheduleArt ? `/projects/${projectId}/artifacts/${(scheduleArt as any).id}` : `/projects/${projectId}/schedule`,
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

  // Compute whether badge should be shown (past 50% of project OR within 60 days of end)
  const { data: projectDates } = await supabase
    .from("projects")
    .select("start_date, finish_date, end_date")
    .eq("id", projectId)
    .maybeSingle();

  const startDateRaw = (projectDates as any)?.start_date ?? null;
  const finishDateRaw = (projectDates as any)?.finish_date ?? (projectDates as any)?.end_date ?? endDateRaw;
  let showBadge = false;
  if (daysToEndDate !== null && daysToEndDate <= 30) {
    showBadge = true;
  } else if (startDateRaw && finishDateRaw) {
    const start = new Date(startDateRaw).getTime();
    const finish = new Date(finishDateRaw).getTime();
    const now = Date.now();
    const totalDuration = finish - start;
    if (totalDuration > 0) {
      const elapsed = now - start;
      const pctElapsed = elapsed / totalDuration;
      showBadge = pctElapsed >= 0.5; // past halfway
    }
  } else if (mandatoryBlocked > 0 && daysToEndDate !== null && daysToEndDate <= 30) {
    showBadge = true; // only show within 30 days of end date
  }

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
    showBadge,
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
          content: "You are a senior PMO consultant. Give concise, practical, prioritised action plans for project closure. Plain text only, no markdown formatting.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return "AI guidance is temporarily unavailable. Please review the blocked items above.";

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return text.trim() || "No guidance available at this time.";
}