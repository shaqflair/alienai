// src/app/projects/[id]/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { fetchProjectResourceData, projectWeekPeriods } from "./_lib/resource-data";
import ProjectResourcePanel from "./_components/ProjectResourcePanel";
import AssignPmButton from "./_components/AssignPmButton";
import ProjectRaidRaiseButton from "./_components/ProjectRaidRaiseButton";
import { computeHealthFromData, type HealthResult } from "@/lib/server/project-health";
import { getCachedBriefing } from "./briefing-actions";
import ProjectDailyBriefing from "@/components/projects/ProjectDailyBriefing";
import ProjectDateEditor from "@/components/projects/ProjectDateEditor";
import Gate1Modal from "@/components/projects/Gate1Modal";
import GateStatusPanel from "@/components/projects/GateStatusPanel";
import WinProbabilityEditor from "@/components/projects/WinProbabilityEditor";
import { loadGate5Status } from "./gate5/gate5-actions";
import { loadResourceJustificationData, loadOrgRateCardRoles } from "./resource-justification-actions";
import ResourceJustificationPanel from "@/components/projects/ResourceJustificationPanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "";
}
function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim(),
  );
}
function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = String(col || "").toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}
function isInvalidInputSyntaxError(err: any) {
  return String(err?.code || "").trim() === "22P02";
}

const RESERVED = new Set([
  "artifacts", "changes", "change", "members", "approvals",
  "lessons", "raid", "schedule", "wbs",
]);

function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try { v = decodeURIComponent(v); } catch {}
  v = v.trim();
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];
  return v;
}

const HUMAN_COL_CANDIDATES = [
  "project_human_id", "human_id", "project_code",
  "code", "slug", "reference", "ref",
] as const;

async function resolveProjectUuidFast(supabase: any, identifier: string, organisationId: string) {
  const raw = safeStr(identifier).trim();
  if (!raw) return { projectUuid: null as string | null, project: null as any };
  if (looksLikeUuid(raw)) return { projectUuid: raw, project: null as any };

  const normalized = normalizeProjectIdentifier(raw);

  for (const col of HUMAN_COL_CANDIDATES) {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq(col, normalized)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      if (isInvalidInputSyntaxError(error)) continue;
      throw error;
    }
    if (data?.id) return { projectUuid: String(data.id), project: data };
  }

  return { projectUuid: null as string | null, project: null as any };
}

function bestProjectRole(rows: Array<{ role?: string | null }> | null | undefined) {
  const roles = (rows ?? []).map((r) => String(r?.role ?? "").toLowerCase()).filter(Boolean);
  if (!roles.length) return "";
  if (roles.includes("owner")) return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return roles[0] || "";
}

function flashText(msg: string | undefined, conflicts: string | undefined) {
  if (!msg) return null;
  if (msg === "allocated") {
    const c = conflicts ? parseInt(conflicts) : 0;
    return c > 0 ? `Allocated  ${c} conflict week${c > 1 ? "s" : ""} flagged` : "Resource allocated successfully";
  }
  if (msg === "allocation_removed") return "Allocation removed.";
  if (msg === "week_removed") return "Week removed.";
  if (msg === "week_updated") return "Week updated.";
  if (msg === "converted_to_confirmed") return "Project converted to Confirmed -- now live on the capacity heatmap.";
  if (msg === "pid_created") return "PID artifact created.";
  if (msg === "roles_saved") return "Role requirements saved.";
  if (msg === "pm_assigned") return "Project manager updated.";
  return null;
}

function formatDateShort(d: string | null | undefined) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch { return d as string; }
}

function formatCurrency(amount: number, fallback = "-"): string {
  if (!Number.isFinite(amount)) return fallback;
  return new Intl.NumberFormat("en-GB", {
    style: "currency", currency: "GBP",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(amount);
}

async function getOrgMembership(supabase: any, organisationId: string, userId: string) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) {
    if (String(error?.message || "").toLowerCase().includes("does not exist")) {
      return { isMember: false, isAdmin: false, role: "" };
    }
    throw error;
  }

  const role = String(data?.role ?? "").toLowerCase();
  return { isMember: Boolean(role), isAdmin: role === "admin" || role === "owner", role };
}

async function assignPmAction(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!user) redirect("/login");

  const projectId = safeStr(formData.get("project_id")).trim();
  const pmUserId  = safeStr(formData.get("pm_user_id")).trim();
  const returnTo  = safeStr(formData.get("return_to")).trim() || "/projects";
  if (!projectId) redirect(`${returnTo}?err=missing_project_id`);

  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) redirect(`${returnTo}?err=no_active_org`);

  const org = await getOrgMembership(supabase, activeOrgId, user.id);
  const { data: memRows } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .is("removed_at", null);

  const myRole = bestProjectRole(memRows as any);
  if (!(org.isAdmin || myRole === "owner" || myRole === "editor"))
    redirect(`${returnTo}?err=forbidden`);

  let pmName: string | null = null;
  if (pmUserId) {
    const { data: pmByUserId } = await supabase
      .from("profiles").select("full_name, email").eq("user_id", pmUserId).maybeSingle();
    let pmProfile: any = pmByUserId;
    if (!safeStr(pmProfile?.full_name).trim() && !safeStr(pmProfile?.email).trim()) {
      const { data: pmById } = await supabase
        .from("profiles").select("full_name, email").eq("id", pmUserId).maybeSingle();
      if (pmById) pmProfile = pmById;
    }
    pmName = safeStr(pmProfile?.full_name).trim() || safeStr(pmProfile?.email).trim() || null;
  }

  const { error } = await supabase
    .from("projects")
    .update({ pm_user_id: pmUserId || null, project_manager_id: pmUserId || null, pm_name: pmName })
    .eq("id", projectId)
    .eq("organisation_id", activeOrgId);

  if (error) throw new Error(error.message);
  redirect(`${returnTo}?msg=pm_assigned`);
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string }>;
  searchParams?: Promise<{ msg?: string; conflicts?: string; err?: string; tab?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id: _paramId } = await params;
  const rawId = safeParam(_paramId).trim();
  const sp = (await searchParams) ?? {};

  let activeOrgId = await getActiveOrgId();
  if (!activeOrgId) {
    if (looksLikeUuid(rawId)) {
      const { data: proj } = await supabase
        .from("projects").select("organisation_id").eq("id", rawId).maybeSingle();
      if (proj?.organisation_id) activeOrgId = String(proj.organisation_id);
    }
    if (!activeOrgId) notFound();
  }

  if (!rawId) notFound();
  if (RESERVED.has(rawId.toLowerCase())) redirect("/projects");

  const resolved = await resolveProjectUuidFast(supabase, rawId, activeOrgId);
  if (!resolved?.projectUuid) notFound();

  const projectUuid = String(resolved.projectUuid);

  let project = resolved.project ?? null;
  if (!project) {
    const { data: p, error: pErr } = await supabase
      .from("projects")
      .select(
        "id, organisation_id, title, project_code, colour, start_date, finish_date, " +
        "resource_status, status, created_at, project_manager_id, pm_user_id, pm_name, " +
        "budget_amount, budget_days, win_probability"
      )
      .eq("id", projectUuid)
      .eq("organisation_id", activeOrgId)
      .maybeSingle();

    if (pErr) throw pErr;
    if (!p?.id) notFound();
    project = p;
  } else {
    if (String(project?.organisation_id ?? "") !== activeOrgId) notFound();
  }

  const org = await getOrgMembership(supabase, activeOrgId, auth.user.id);

  const { data: memRows, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at, is_active")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .is("removed_at", null);

  if (memErr) throw memErr;

  const projectRole   = bestProjectRole(memRows as any);
  const canSeeProject = org.isMember || Boolean(projectRole);
  if (!canSeeProject) notFound();

  const myRole   = org.isAdmin && !projectRole ? "admin" : projectRole || (org.role || "viewer");
  const canEdit  = org.isAdmin || myRole === "owner" || myRole === "editor";
  const canRegenerate = projectRole === "owner" || projectRole === "editor" || org.isAdmin;

  const [
    resourceData,
    changesResult,
    approvalsResult,
    membersResult,
    raidResult,
    myProjectMembershipsResult,
    scheduleMilestonesResult,
    changeRequestsResult,
    keyArtifactsResult,
    orgMembersBaseResult,
    spendResult,
    finPlanResult,
    briefingResult,
    gateQueryResult,
    gate5Result,
    justificationResult,
    rateCardRolesResult,
  ] = await Promise.allSettled([
    fetchProjectResourceData(projectUuid),
    supabase
      .from("changes")
      .select("id, title, status, created_at, change_type")
      .eq("project_id", projectUuid)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("approvals")
      .select("id, title, status, created_at")
      .eq("project_id", projectUuid)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("project_members")
      .select("id, role, removed_at, is_active, user_id")
      .eq("project_id", projectUuid)
      .is("removed_at", null),
    supabase
      .from("raid_items")
      .select("id, type, title, status, priority, due_date, probability, severity")
      .eq("project_id", projectUuid)
      .not("status", "in", '("closed","resolved","done","completed","archived")')
      .order("priority", { ascending: false })
      .limit(100),
    supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", auth.user.id)
      .is("removed_at", null),
    supabase
      .from("schedule_milestones")
      .select("id, status, end_date, baseline_end, critical_path_flag, ai_delay_prob, progress_pct, risk_score")
      .eq("project_id", projectUuid)
      .limit(500),
    supabase
      .from("change_requests")
      .select("id, status")
      .eq("project_id", projectUuid)
      .limit(100),
    // Include status + charter/stakeholder types for governance scoring
    supabase
      .from("artifacts")
      .select("id, type, status")
      .eq("project_id", projectUuid)
      .in("type", [
        "SCHEDULE", "WBS", "FINANCIAL_PLAN", "WEEKLY_REPORT",
        "PROJECT_CHARTER", "CHARTER", "STAKEHOLDER_REGISTER", "STAKEHOLDERS",
      ])
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("organisation_members")
      .select("user_id, job_title, role")
      .eq("organisation_id", activeOrgId)
      .is("removed_at", null)
      .limit(200),
    supabase
      .from("project_spend")
      .select("amount")
      .eq("project_id", projectUuid)
      .is("deleted_at", null)
      .limit(100000),
    // Financial plan content_json for actual spend from cost_lines
    supabase
      .from("artifacts")
      .select("content_json")
      .eq("project_id", projectUuid)
      .eq("type", "FINANCIAL_PLAN")
      .eq("is_current", true)
      .maybeSingle(),
    getCachedBriefing(projectUuid),
    (async () => {
      try {
        return await supabase
          .from("project_gates")
          .select("id, gate_number, gate_name, status, passed_at, passed_by, override, override_reason, pass_count, warn_count, fail_count, criteria_snapshot")
          .eq("project_id", projectUuid)
          .eq("gate_number", 1)
          .maybeSingle();
      } catch {
        return { data: null, error: null };
      }
    })(),
    (async () => { try { return await loadGate5Status(projectUuid); } catch { return null; } })(),
    (async () => { try { return await loadResourceJustificationData(projectUuid); } catch { return null; } })(),
    (async () => { try { return await loadOrgRateCardRoles(projectUuid); } catch { return null; } })(),
  ]);

  const resource         = resourceData.status === "fulfilled" ? resourceData.value : null;
  const periods          = resource ? projectWeekPeriods(resource.project.start_date, resource.project.finish_date) : [];
  const changes          = changesResult.status === "fulfilled" ? changesResult.value.data ?? [] : [];
  const pendingApprovals = approvalsResult.status === "fulfilled" ? approvalsResult.value.data ?? [] : [];
  const members          = membersResult.status === "fulfilled" ? membersResult.value.data ?? [] : [];
  const raidItems        = raidResult.status === "fulfilled" ? raidResult.value.data ?? [] : [];
  const milestones       = scheduleMilestonesResult.status === "fulfilled" ? scheduleMilestonesResult.value.data ?? [] : [];
  const changeReqs       = changeRequestsResult.status === "fulfilled" ? changeRequestsResult.value.data ?? [] : [];
  const keyArtifacts     = keyArtifactsResult.status === "fulfilled" ? keyArtifactsResult.value.data ?? [] : [];
  const orgMembersBase   = orgMembersBaseResult.status === "fulfilled" ? orgMembersBaseResult.value.data ?? [] : [];
  const cachedBriefing   = briefingResult.status === "fulfilled" ? briefingResult.value.briefing : null;
  const gateRecord        = gateQueryResult.status === "fulfilled" ? (gateQueryResult.value as any)?.data ?? null : null;
  const gate5Data         = gate5Result.status === "fulfilled" ? (gate5Result.value as any) : null;
  const justificationData = justificationResult.status === "fulfilled" ? (justificationResult.value as any) : null;
  const rateCardRoles    = rateCardRolesResult.status === "fulfilled" ? (rateCardRolesResult.value as string[] ?? []) : [];

  const spendRows   = spendResult.status === "fulfilled" ? spendResult.value.data ?? [] : [];
  const finPlanJson = finPlanResult.status === "fulfilled" ? (finPlanResult.value as any)?.data?.content_json : null;

  const spentAmount = (() => {
    // Primary: project_spend table rows
    const dbSpend = (spendRows as any[]).reduce((s, r) => s + Number(r.amount ?? 0), 0);
    if (dbSpend > 0) return dbSpend;
    // Fallback: sum actual values from financial plan cost_lines
    // (covers licence fees, tools, vendors entered directly in the financial plan)
    if (finPlanJson) {
      const lines = Array.isArray(finPlanJson?.cost_lines) ? finPlanJson.cost_lines : [];
      const lineTotal = lines.reduce((sum: number, line: any) => {
        const actual = Number(line?.actual ?? 0);
        return sum + (Number.isFinite(actual) && actual > 0 ? actual : 0);
      }, 0);
      if (lineTotal > 0) return lineTotal;
    }
    return 0;
  })();
  const budgetAmount = project?.budget_amount != null ? Number(project.budget_amount) : null;
  const budgetDays   = project?.budget_days   != null ? Number(project.budget_days)   : null;

  // ── Governance flags ───────────────────────────────────────────────────────
  const APPROVED_ART_STATUSES = new Set([
    "approved", "active", "current", "published", "signed_off", "signed off",
  ]);
  const artApproved = (types: string[]) =>
    (keyArtifacts as any[]).some((a: any) => {
      if (!types.includes(String(a.type || "").toUpperCase())) return false;
      const s = String(a.status || "").toLowerCase().replace(/\s+/g, "_");
      return APPROVED_ART_STATUSES.has(s) || s.includes("approv") || s.includes("publish");
    });

  const charterApproved            = artApproved(["PROJECT_CHARTER", "CHARTER"]);
  const budgetApproved             = artApproved(["FINANCIAL_PLAN"]);
  const stakeholderRegisterPresent = (keyArtifacts as any[]).some((a: any) =>
    ["STAKEHOLDER_REGISTER", "STAKEHOLDERS"].includes(String(a.type || "").toUpperCase()),
  );
  const gate1Complete = !!(
    gateRecord?.passed_at ||
    gateRecord?.status === "passed" ||
    gateRecord?.status === "complete"
  );
  const _todayStr = new Date().toISOString().slice(0, 10);
  const _in60Str  = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const _endStr   = project?.finish_date ? String(project.finish_date).slice(0, 10) : null;
  const gate5Applicable = !!(_endStr && _endStr <= _in60Str && _endStr >= _todayStr);

  // ── Profile map ────────────────────────────────────────────────────────────
  let profileMap = new Map<string, any>();
  if (orgMembersBase.length > 0) {
    const userIds = (orgMembersBase as any[]).map((m: any) => m.user_id).filter(Boolean);
    const [{ data: profilesByUserId }, { data: profilesById }] = await Promise.all([
      supabase.from("profiles").select("id, user_id, full_name, email, avatar_url, department, job_title").in("user_id", userIds),
      supabase.from("profiles").select("id, user_id, full_name, email, avatar_url, department, job_title").in("id", userIds),
    ]);
    for (const p of [...(profilesByUserId ?? []), ...(profilesById ?? [])]) {
      const pid  = safeStr((p as any)?.id).trim();
      const puid = safeStr((p as any)?.user_id).trim();
      if (pid)  profileMap.set(pid, p);
      if (puid) profileMap.set(puid, p);
    }
  }

  const orgMembers = (orgMembersBase as any[]).map((m: any) => ({
    ...m,
    _profile: profileMap.get(m.user_id) ?? {},
  }));

  // ── Switcher projects ──────────────────────────────────────────────────────
  let switcherProjects: { id: string; title: string; project_code: string | null; colour: string | null }[] = [];
  if (myProjectMembershipsResult.status === "fulfilled") {
    const myIds = (myProjectMembershipsResult.value.data ?? []).map((r: any) => String(r.project_id));
    if (myIds.length > 0) {
      const { data: switcherData } = await supabase
        .from("projects")
        .select("id, title, project_code, colour, status, deleted_at")
        .in("id", myIds)
        .eq("organisation_id", activeOrgId)
        .is("deleted_at", null)
        .order("title", { ascending: true })
        .limit(200);
      switcherProjects = (switcherData ?? []).filter(
        (p: any) => (p.status ?? "active").toLowerCase() !== "closed",
      );
    }
  }

  // ── PM resolution ──────────────────────────────────────────────────────────
  const pmUserId         = safeStr((project as any)?.pm_user_id ?? (project as any)?.project_manager_id ?? "").trim();
  const storedPmName     = safeStr((project as any)?.pm_name).trim();
  let resolvedPmName     = storedPmName;
  let resolvedPmJobTitle = "";

  if (pmUserId) {
    const { data: pmByUserId } = await supabase
      .from("profiles").select("full_name, email").eq("user_id", pmUserId).maybeSingle();
    let pmProfile: any = pmByUserId;
    if (!safeStr(pmProfile?.full_name).trim() && !safeStr(pmProfile?.email).trim()) {
      const { data: pmById } = await supabase
        .from("profiles").select("full_name, email").eq("id", pmUserId).maybeSingle();
      if (pmById) pmProfile = pmById;
    }
    if (!resolvedPmName) {
      resolvedPmName =
        safeStr(pmProfile?.full_name).trim() ||
        safeStr(pmProfile?.email).trim() || "";
    }
    if (!resolvedPmName) {
      const fromOrg = orgMembers.find((m: any) => safeStr(m.user_id) === pmUserId);
      const p = fromOrg?._profile ?? {};
      resolvedPmName = safeStr(p?.full_name).trim() || safeStr(p?.email).trim() || "";
    }
    const { data: orgPm } = await supabase
      .from("organisation_members")
      .select("job_title")
      .eq("organisation_id", activeOrgId)
      .eq("user_id", pmUserId)
      .is("removed_at", null)
      .maybeSingle();
    resolvedPmJobTitle = safeStr((orgPm as any)?.job_title).trim();
  }

  // ── Health ─────────────────────────────────────────────────────────────────
  const health: HealthResult = computeHealthFromData({
    milestones:                 milestones as any[],
    raidItems:                  raidItems as any[],
    budgetAmount,
    spentAmount,
    allocatedDays:              resource?.budgetSummary?.allocatedDays ?? null,
    budgetDays:                 budgetDays,
    pendingApprovalCount:       pendingApprovals.length,
    openChangeRequests:         (changeReqs as any[]).filter((c) =>
      ["pending", "open", "submitted", "draft"].includes(String(c.status ?? "").toLowerCase()),
    ).length,
    charterApproved,
    budgetApproved,
    stakeholderRegisterPresent,
    gate1Complete,
    gate5Applicable,
    gate5Ready: false,
  });

  const healthScore      = health.score;
  const scheduleHealth   = health.parts.schedule;
  const raidHealth       = health.parts.raid;
  const budgetHealth     = health.parts.budget;
  const governanceHealth = health.parts.governance;
  const scheduleDetail   = health.detail.schedule;
  const raidDetail       = health.detail.raid;
  const budgetDetail     = health.detail.budget;
  const govDetail        = health.detail.governance;

  // ── RAG colour helpers ─────────────────────────────────────────────────────
  const ragFromScore = (s: number | null) =>
    s == null ? "unknown" : s >= 85 ? "green" : s >= 70 ? "amber" : "red";

  const overallRag = ragFromScore(healthScore);

  // Icon background & colour for the health score stat card — tracks live RAG
  const healthIconStyle = {
    green:   { bg: "rgba(34,197,94,0.12)",  icon: "#16a34a" },
    amber:   { bg: "rgba(245,158,11,0.12)", icon: "#d97706" },
    red:     { bg: "rgba(239,68,68,0.12)",  icon: "#dc2626" },
    unknown: { bg: "rgba(148,163,184,0.12)", icon: "#64748b" },
  }[overallRag];

  // ── Derived values ─────────────────────────────────────────────────────────
  const projectTitle      = safeStr(project?.title ?? "Project") || "Project";
  const projectCode       = safeStr(project?.project_code ?? "").trim();
  const projectColour     = safeStr(project?.colour ?? "#22c55e");
  const projectStatus     = safeStr(project?.status ?? "active");
  const isActive          = projectStatus.toLowerCase() !== "closed";
  const projectRefForUrls = projectUuid;
  const winProbability    = (project as any)?.win_probability ?? null;
  const isPipeline        = safeStr(project?.resource_status).toLowerCase() === "pipeline";

  const flash    = flashText(sp?.msg, sp?.conflicts);
  const flashErr = sp?.err ? `Error: ${sp.err}` : null;

  const artifactHref = (type: string) => {
    const a = (keyArtifacts as any[]).find((x) => x.type === type);
    return a?.id
      ? `/projects/${projectRefForUrls}/artifacts/${a.id}`
      : `/projects/${projectRefForUrls}/artifacts`;
  };

  function raidType(r: any, type: string) {
    return String(r.type ?? "").toLowerCase().trim() === type;
  }

  const risks        = raidItems.filter((r: any) => raidType(r, "risk"));
  const assumptions  = raidItems.filter((r: any) => raidType(r, "assumption"));
  const issues       = raidItems.filter((r: any) => raidType(r, "issue"));
  const dependencies = raidItems.filter((r: any) => raidType(r, "dependency"));
  const totalMembers = members.length;
  const pmName       = resolvedPmName || "Unassigned";
  const pmJobTitle   = resolvedPmJobTitle || "";

  const budgetTooltip = budgetDetail.budgetAmount != null
    ? budgetDetail.spentAmount > 0
      ? `${formatCurrency(budgetDetail.spentAmount)} spent of ${formatCurrency(budgetDetail.budgetAmount!)} approved budget` +
        ` (${budgetDetail.utilisationPct}% used).` +
        (budgetDetail.forecastOverrun
          ? ` Over budget by ${formatCurrency(Math.abs(budgetDetail.variance!))}.`
          : ` ${formatCurrency(budgetDetail.variance!)} remaining.`) +
        (budgetDetail.overAllocated ? ` Resource over-allocated.` : "")
      : `Approved budget: ${formatCurrency(budgetDetail.budgetAmount!)}. No spend logged in project_spend — actual costs tracked via Financial Plan tab.` +
        (budgetDetail.overAllocated ? ` Resource days over-allocated vs budget days.` : "")
    : "No approved budget set on this project.";

  const governanceTooltip = [
    govDetail.charterApproved            ? "Charter: approved ✓"              : "Charter: not yet approved",
    govDetail.budgetApproved             ? "Financial plan: approved ✓"       : "Financial plan: not yet approved",
    govDetail.stakeholderRegisterPresent ? "Stakeholder register: present ✓"  : "Stakeholder register: missing",
    govDetail.gate1Complete              ? "Gate 1: complete ✓"               : "Gate 1: not complete",
    gate5Applicable
      ? (govDetail.gate5Ready ? "Gate 5: ready ✓" : "Gate 5: readiness check needed")
      : "",
    govDetail.pendingApprovalCount > 0 ? `${govDetail.pendingApprovalCount} pending approval${govDetail.pendingApprovalCount !== 1 ? "s" : ""}` : "",
    govDetail.openChangeRequests   > 0 ? `${govDetail.openChangeRequests} open change request${govDetail.openChangeRequests !== 1 ? "s" : ""}` : "",
  ].filter(Boolean).join(" · ");

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", width: "100%" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        :root {
          --accent:    ${projectColour};
          --surface:   #ffffff;
          --surface-2: #f6f8fa;
          --border:    #e8ecf0;
          --border-2:  #d0d7de;
          --text-1:    #0d1117;
          --text-2:    #57606a;
          --text-3:    #8b949e;
          --green:     #22c55e;
          --amber:     #f59e0b;
          --red:       #ef4444;
          --blue:      #3b82f6;
          --r:         12px;
        }
        body { font-family: 'Geist', -apple-system, sans-serif; }
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); }
        .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 20px; transition: box-shadow 0.15s; }
        .stat-card:hover { box-shadow: 0 2px 14px rgba(0,0,0,0.07); }
        .stat-icon { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; font-size: 18px; }
        .hbar-track { height: 6px; background: var(--border); border-radius: 99px; overflow: hidden; margin-top: 5px; }
        .hbar-fill  { height: 100%; border-radius: 99px; transition: width 0.6s cubic-bezier(0.16,1,0.3,1); }
        .hs-tip-trigger { position: relative; }
        .hs-tip-box {
          display: none; position: absolute; left: 50%; bottom: calc(100% + 8px);
          transform: translateX(-50%);
          background: #0a0e17; color: #e2e8f0;
          font-size: 11px; font-weight: 400; line-height: 1.5;
          padding: 8px 12px; border-radius: 8px;
          width: 260px; white-space: normal; text-align: left;
          box-shadow: 0 4px 20px rgba(0,0,0,0.4);
          z-index: 100; pointer-events: none;
        }
        .hs-tip-box::after {
          content: ''; position: absolute; top: 100%; left: 50%;
          transform: translateX(-50%);
          border: 5px solid transparent; border-top-color: #0a0e17;
        }
        .hs-tip-trigger:hover .hs-tip-box { display: block; }
        .health-row:hover { opacity: 1; }
        .raid-quad  { background: var(--surface-2); border-radius: 10px; border: 1px solid var(--border); padding: 14px; }
        .raid-item  { font-size: 12px; color: var(--text-2); padding: 5px 0; border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .raid-item:last-child { border-bottom: none; }
        .act-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--surface-2); }
        .act-item:last-child { border-bottom: none; }
        .action-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 13px; border-radius: 8px; font-size: 12px; font-weight: 600;
          text-decoration: none; border: 1px solid var(--border); color: var(--text-2);
          font-family: 'Geist', sans-serif; background: var(--surface);
          transition: border-color 0.15s, background 0.15s; white-space: nowrap; cursor: pointer;
        }
        .action-btn:hover { border-color: var(--border-2); background: var(--surface-2); }
        .action-btn.primary { background: var(--accent); border-color: var(--accent); color: white; }
        .action-btn.primary:hover { opacity: 0.9; }
        .flash-ok  { padding: 10px 16px; border-radius: 9px; background: rgba(34,197,94,0.07); border: 1px solid rgba(34,197,94,0.22); font-size: 13px; color: #15803d; font-weight: 500; }
        .flash-err { padding: 10px 16px; border-radius: 9px; background: #fef2f2; border: 1px solid #fecaca; font-size: 13px; color: #dc2626; font-weight: 500; }
        .pm-select {
          border: 1px solid var(--border); border-radius: 7px; padding: 3px 8px;
          font-size: 13px; font-family: 'Geist', sans-serif; color: var(--text-1);
          background: var(--surface); cursor: pointer; outline: none; transition: border-color 0.15s;
        }
        .pm-select:focus { border-color: var(--blue); }
        @media (max-width: 960px) {
          .stat-grid { grid-template-columns: repeat(2,1fr) !important; }
          .two-col   { grid-template-columns: 1fr !important; }
          .raid-grid { grid-template-columns: repeat(2,1fr) !important; }
        }
        @media (max-width: 520px) {
          .stat-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {flash    && <div className="flash-ok"  style={{ marginBottom: 14 }}>{flash}</div>}
      {flashErr && <div className="flash-err" style={{ marginBottom: 14 }}>{flashErr}</div>}

      <ProjectDailyBriefing
        projectId={projectUuid}
        initialBriefing={cachedBriefing}
        canRegenerate={canRegenerate}
      />

      {canEdit && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
          <a href={`/allocations/new?project_id=${projectUuid}&return_to=/projects/${projectRefForUrls}`} className="action-btn primary">
            + Allocate resource
          </a>
          <ProjectRaidRaiseButton projectId={projectUuid} projectTitle={projectTitle} projectCode={projectCode || null} />
          <Link href={`/projects/${projectRefForUrls}/artifacts`} className="action-btn">+ New artifact</Link>
          <Link href={`/projects/${projectRefForUrls}/artifacts`} className="action-btn">Project Charter</Link>
          {isPipeline && (
            <Gate1Modal
              projectId={projectUuid}
              isAdmin={org.isAdmin}
              returnTo={`/projects/${projectRefForUrls}`}
            />
          )}
          {isPipeline && (
            <WinProbabilityEditor
              projectId={projectUuid}
              winProbability={winProbability}
              canEdit={canEdit}
            />
          )}
        </div>
      )}

      {!canEdit && isPipeline && winProbability != null && (
        <div style={{ marginBottom: 16 }}>
          <WinProbabilityEditor
            projectId={projectUuid}
            winProbability={winProbability}
            canEdit={false}
          />
        </div>
      )}

      {!isPipeline && (
        <GateStatusPanel
          projectId={projectUuid}
          projectTitle={projectTitle}
          isAdmin={org.isAdmin}
          gateRecord={gateRecord}
          returnTo={`/projects/${projectRefForUrls}`}
        />
      )}

      {!isPipeline && isActive && gate5Data && gate5Data.showBadge && (() => {
        const g5 = gate5Data;
        const c = g5.riskLevel === "green"
          ? { bg: "#f0fdf4", border: "#bbf7d0", text: "#15803d", accent: "#16a34a" }
          : g5.riskLevel === "amber"
          ? { bg: "#fffbeb", border: "#fde68a", text: "#92400e", accent: "#d97706" }
          : { bg: "#fef2f2", border: "#fecaca", text: "#b91c1c", accent: "#dc2626" };
        const urgencyLabel = g5.daysToEndDate !== null && g5.daysToEndDate < 0
          ? `End date passed ${Math.abs(g5.daysToEndDate)}d ago`
          : g5.daysToEndDate !== null && g5.daysToEndDate <= 30
          ? `${g5.daysToEndDate}d to end date` : null;
        return (
          <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 12, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
              <div style={{ width: 36, height: 36, borderRadius: 8, background: c.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: "monospace" }}>G5</span>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: c.text }}>Gate 5 — Closure Readiness</div>
                <div style={{ fontSize: 11, color: c.text, opacity: 0.8, marginTop: 1 }}>
                  {g5.canClose ? "All mandatory checks passed — ready to close" : `${g5.mandatoryBlocked} mandatory item${g5.mandatoryBlocked > 1 ? "s" : ""} blocking closure`}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 180 }}>
              <div style={{ height: 5, background: "#e2e8f0", borderRadius: 99, overflow: "hidden", flex: 1 }}>
                <div style={{ height: "100%", width: `${g5.readinessScore}%`, background: c.accent, borderRadius: 99 }} />
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: c.text, fontFamily: "monospace", minWidth: 42, textAlign: "right" }}>{g5.readinessScore}%</span>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: "#dcfce7", color: "#15803d", border: "1px solid #bbf7d0" }}>{g5.passedChecks} passed</span>
              {g5.mandatoryBlocked > 0 && <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" }}>{g5.mandatoryBlocked} blocked</span>}
              {urgencyLabel && <span style={{ fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 20, background: c.bg, color: c.text, border: `1px solid ${c.border}` }}>{urgencyLabel}</span>}
            </div>
            <a href={`/projects/${projectRefForUrls}/gate5`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: c.accent, color: "#fff", textDecoration: "none", flexShrink: 0 }}>
              {g5.canClose ? "View Gate 5 ✓" : "View & resolve →"}
            </a>
          </div>
        );
      })()}

      {/* ── Stat cards ─────────────────────────────────────────────────────── */}
      <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 16 }}>

        {/* Health Score — icon colour tracks RAG */}
        <div className="stat-card">
          <div
            className="stat-icon"
            style={{ background: healthIconStyle.bg }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={healthIconStyle.icon} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500, marginBottom: 4 }}>Health Score</div>
          <div style={{
            fontSize: 28, fontWeight: 700, lineHeight: 1,
            color: overallRag === "green" ? "#16a34a" : overallRag === "amber" ? "#d97706" : overallRag === "red" ? "#dc2626" : "var(--text-1)",
          }}>
            {healthScore != null ? `${healthScore}%` : "—"}
          </div>
          <div style={{ fontSize: 12, marginTop: 4, fontWeight: 600,
            color: overallRag === "green" ? "#16a34a" : overallRag === "amber" ? "#d97706" : overallRag === "red" ? "#dc2626" : "var(--text-3)",
          }}>
            {overallRag === "green" ? "Green — on track" : overallRag === "amber" ? "Amber — monitor" : overallRag === "red" ? "Red — action required" : "Overall RAG"}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon" style={{ background: "#ede9fe" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500, marginBottom: 4 }}>Project Manager</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", lineHeight: 1.2 }}>
            {canEdit ? (
              <AssignPmButton projectId={projectUuid} currentPmName={pmName} currentPmUserId={pmUserId || null} orgId={activeOrgId!} />
            ) : (
              pmName
            )}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
            {pmName === "Unassigned" ? "Not assigned" : (pmJobTitle || "Assigned")}
          </div>
        </div>

        <div className="stat-card" style={{ gridColumn: "span 2" }}>
          <ProjectDateEditor
            projectId={projectUuid}
            projectTitle={projectTitle}
            startDate={project?.start_date ?? null}
            finishDate={project?.finish_date ?? null}
            resourceStatus={safeStr(project?.resource_status)}
            canEdit={canEdit}
          />
        </div>
      </div>

      {/* ── Description + health panel ─────────────────────────────────────── */}
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 14, marginBottom: 16 }}>
        <div className="card" style={{ padding: "24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 12 }}>Project Description</h3>
          <p style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.7, margin: 0 }}>
            {`${projectTitle} is currently ${isActive ? "active" : "closed"}.${
              healthScore != null
                ? ` Project health is ${healthScore}% (${overallRag === "green" ? "on track" : overallRag === "amber" ? "needs monitoring" : "requires attention"}).`
                : ""
            }${project?.finish_date ? ` Delivery deadline: ${formatDateShort(project?.finish_date)}.` : ""}`}
          </p>
          <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
            {[
              { href: `/projects/${projectRefForUrls}/artifacts`, label: "Artifacts" },
              { href: `/projects/${projectRefForUrls}/members`,   label: `Members (${totalMembers})` },
              { href: `/projects/${projectRefForUrls}/approvals`, label: "Approvals", badge: pendingApprovals.length },
              { href: `/projects/${projectRefForUrls}/raid`,      label: "RAID" },
            ].map((l) => (
              <Link key={l.href} href={l.href} className="action-btn">
                {l.label}
                {(l.badge ?? 0) > 0 && (
                  <span style={{ background: "var(--red)", color: "white", borderRadius: 20, fontSize: 10, fontWeight: 800, padding: "1px 5px", marginLeft: 2 }}>{l.badge}</span>
                )}
              </Link>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: "24px" }}>
          <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 4 }}>Health Score</h3>
          <p style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 20 }}>Computed from live project data</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {([
              {
                label: "Schedule", value: scheduleHealth, weight: 35,
                tooltip: scheduleHealth != null
                  ? `Based on ${scheduleDetail.total} milestone${scheduleDetail.total !== 1 ? "s" : ""}. ` +
                    `${scheduleDetail.overdue} overdue${scheduleDetail.critical > 0 ? ` (${scheduleDetail.critical} on critical path)` : ""}. ` +
                    `Avg slip: ${scheduleDetail.avgSlipDays}d. WBS: ${scheduleDetail.wbsComplete}/${scheduleDetail.wbsTotal} items complete.`
                  : "No schedule milestones found.",
                empty: "No milestones — add schedule milestones to track.",
              },
              {
                label: "RAID Risk", value: raidHealth, weight: 30,
                tooltip: raidHealth != null
                  ? `${raidDetail.total} open items. Issues: ${raidDetail.openIssues} (${raidDetail.highSeverityIssues} high). ` +
                    `Risks: ${raidDetail.highRisks} high. ` +
                    `Dependencies: ${raidDetail.openDependencies}. Assumptions: ${raidDetail.openAssumptions}. ` +
                    `${raidDetail.overdue} past due.`
                  : "No open RAID items.",
                empty: "No open RAID items — log risks and issues to track.",
              },
              {
                label: "Budget", value: budgetHealth, weight: 20,
                tooltip: budgetTooltip,
                empty: "Set an approved budget and log spend to track.",
              },
              {
                label: "Governance", value: governanceHealth, weight: 15,
                tooltip: governanceTooltip,
                empty: "",
              },
            ] as { label: string; value: number | null; weight: number; tooltip: string; empty: string }[]).map(
              ({ label, value, weight, tooltip, empty }) => {
                const barColor = value == null
                  ? "var(--border)"
                  : value >= 85 ? "var(--green)"
                  : value >= 70 ? "var(--amber)"
                  : "var(--red)";
                const ragLabel = value == null ? null : value >= 85 ? "Green" : value >= 70 ? "Amber" : "Red";
                return (
                  <div key={label} style={{ position: "relative" }} className="health-row">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 600 }}>{label}</span>
                        <span style={{ fontSize: 10, color: "var(--text-3)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", fontWeight: 500 }}>{weight}%</span>
                        <span className="hs-tip-trigger" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 14, height: 14, borderRadius: "50%", background: "var(--surface-2)", border: "1px solid var(--border)", fontSize: 9, color: "var(--text-3)", cursor: "default", fontWeight: 700, flexShrink: 0 }}>
                          ?<span className="hs-tip-box">{tooltip}</span>
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        {ragLabel && (
                          <span style={{
                            fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 20,
                            background: ragLabel === "Green" ? "rgba(22,163,74,0.1)" : ragLabel === "Amber" ? "rgba(217,119,6,0.1)" : "rgba(220,38,38,0.1)",
                            color: ragLabel === "Green" ? "var(--green)" : ragLabel === "Amber" ? "var(--amber)" : "var(--red)",
                          }}>
                            {ragLabel}
                          </span>
                        )}
                        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)", minWidth: 32, textAlign: "right" }}>
                          {value != null ? `${value}%` : "—"}
                        </span>
                      </div>
                    </div>
                    <div className="hbar-track">
                      <div className="hbar-fill" style={{ width: `${value ?? 0}%`, background: barColor }} />
                    </div>
                    {value == null && empty && (
                      <p style={{ fontSize: 10, color: "var(--text-3)", margin: "4px 0 0", fontStyle: "italic" }}>{empty}</p>
                    )}
                  </div>
                );
              }
            )}
          </div>

          {healthScore != null && (
            <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 600 }}>Overall RAG</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {[{ t: "Red", min: 0, max: 69 }, { t: "Amber", min: 70, max: 84 }, { t: "Green", min: 85, max: 100 }].map(({ t, min, max }) => {
                  const active = healthScore >= min && healthScore <= max;
                  return (
                    <span key={t} style={{
                      fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20,
                      background: active
                        ? (t === "Green" ? "rgba(22,163,74,0.12)" : t === "Amber" ? "rgba(217,119,6,0.12)" : "rgba(220,38,38,0.12)")
                        : "var(--surface-2)",
                      color: active
                        ? (t === "Green" ? "var(--green)" : t === "Amber" ? "var(--amber)" : "var(--red)")
                        : "var(--text-3)",
                      border: active
                        ? `1px solid ${t === "Green" ? "rgba(22,163,74,0.25)" : t === "Amber" ? "rgba(217,119,6,0.25)" : "rgba(220,38,38,0.25)"}`
                        : "1px solid var(--border)",
                    }}>
                      {t}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Resource panel ─────────────────────────────────────────────────── */}
      {resource && (
        <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
            Resource planning
            <span style={{ flex: 1, height: 1, background: "var(--border)", display: "block" }}/>
          </div>
          <ProjectResourcePanel data={resource} periods={periods} rateCardRoles={rateCardRoles}/>
          {justificationData && (
            <div style={{ marginTop: 16 }}>
              <ResourceJustificationPanel
                projectId={projectUuid}
                projectTitle={projectTitle}
                initialJustification={justificationData.justification ?? null}
                budgetSummary={justificationData.budgetSummary ?? null}
                openCRs={justificationData.openCRs ?? []}
                roleRequirements={justificationData.roleRequirements ?? []}
                allocatedDays={resource?.budgetSummary?.allocatedDays ?? 0}
                budgetDays={resource?.budgetSummary?.budgetDays ?? 0}
                weeklyBurnRate={resource?.budgetSummary?.weeklyBurnRate ?? 0}
                canEdit={canEdit}
                rateCard={(justificationData as any).rateCard ?? {}}
              />
            </div>
          )}
        </div>
      )}

      {/* ── RAID + activity ────────────────────────────────────────────────── */}
      <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14 }}>
        <div className="card" style={{ padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>RAID log</span>
            <Link href={`/projects/${projectRefForUrls}/raid`} style={{ fontSize: 12, color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}>View full RAID</Link>
          </div>
          <div className="raid-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
            {[
              { label: "Risks",        items: risks,        color: risks.length > 0 ? "var(--red)"    : "var(--text-3)", border: risks.length > 0 ? "rgba(239,68,68,0.2)"  : "var(--border)" },
              { label: "Assumptions",  items: assumptions,  color: "var(--blue)",                                        border: "var(--border)" },
              { label: "Issues",       items: issues,       color: issues.length > 0 ? "var(--amber)" : "var(--text-3)", border: issues.length > 0 ? "rgba(245,158,11,0.2)" : "var(--border)" },
              { label: "Dependencies", items: dependencies, color: "#8b5cf6",                                             border: "var(--border)" },
            ].map(({ label, items, color, border }) => (
              <div key={label} className="raid-quad" style={{ borderColor: border }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color, marginBottom: 8 }}>
                  {label} <span style={{ fontWeight: 400, opacity: 0.6 }}>({items.length})</span>
                </div>
                {items.length === 0
                  ? <p style={{ fontSize: 12, color: "#d0d7de", margin: 0 }}>None open</p>
                  : (items as any[]).slice(0, 3).map((item) => (
                      <div key={item.id} className="raid-item">{item.title}</div>
                    ))
                }
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: "24px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 14 }}>Recent activity</div>
          <div>
            {changes.length === 0 && pendingApprovals.length === 0 ? (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>No recent activity</div>
            ) : (
              <>
                {pendingApprovals.slice(0, 2).map((a: any) => (
                  <div key={a.id} className="act-item">
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>!</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{a.title}</p>
                      <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, margin: 0 }}>Approval pending</p>
                    </div>
                  </div>
                ))}
                {changes.slice(0, 4).map((c: any) => {
                  const col = ({ approved: "#22c55e", rejected: "#ef4444", pending: "#f59e0b", draft: "#94a3b8" } as any)[c.status] ?? "#64748b";
                  return (
                    <div key={c.id} className="act-item">
                      <div style={{ width: 28, height: 28, borderRadius: 8, background: `${col}18`, border: `1px solid ${col}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>~</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{c.title}</p>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: `${col}18`, color: col }}>{c.status}</span>
                          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                            {new Date(c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
            <Link href={`/projects/${projectRefForUrls}/change`} style={{ fontSize: 12, color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}>View change board</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
