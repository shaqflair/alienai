// src/app/api/ai/events/route.ts — REBUILT v6 (org-wide portfolio scope via resolvePortfolioScope)
// ✅ Uses shared resolvePortfolioScope(supabase, userId)
// ✅ Active-only filtering via filterActiveProjectIds
// ✅ Fail-open only within scoped candidates
// ✅ All responses remain no-store
// ✅ Project-detail branches remain org-member/project-access controlled

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { buildPmImpactAssessment, safeNum as safeNumAi } from "@/lib/ai/change-ai";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import OpenAI from "openai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ── utils ─────────────────────────────────────────────────────────────── */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function jsonNoStore(payload: any, init?: ResponseInit) {
  const res = NextResponse.json(payload, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}
function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}
function parseWindowDays(raw: any, fallback: number): number {
  const s = safeStr(raw).trim().toLowerCase();
  if (s === "all") return 60;
  return clampInt(raw, 1, 90, fallback);
}
function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}
function startOfUtcDay(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0));
}
function endOfUtcWindow(from: Date, windowDays: number) {
  return new Date(from.getTime() + windowDays * 24 * 60 * 60 * 1000);
}
function inWindow(d: Date, from: Date, to: Date) {
  const t = d.getTime();
  return t >= from.getTime() && t <= to.getTime();
}
function parseDueToUtcDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = safeStr(value).trim();
  if (!s || s === "—" || s.toLowerCase() === "na" || s.toLowerCase() === "n/a") return null;
  const isoTry = new Date(s);
  if (!isNaN(isoTry.getTime())) return isoTry;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    return new Date(
      Date.UTC(
        clampInt(m[3], 1900, 3000, 2000),
        clampInt(m[2], 1, 12, 1) - 1,
        clampInt(m[1], 1, 31, 1),
        0,
        0,
        0
      )
    );
  }
  return null;
}
function mergeBits(parts: Array<string | null | undefined>) {
  return parts
    .map((x) => safeStr(x).trim())
    .filter(Boolean)
    .join("\n\n");
}
function normalizeProjectHumanId(projectCode: string | null | undefined, fallback: string) {
  const v = safeStr(projectCode).trim();
  return v || safeStr(fallback).trim();
}
function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];
  return v;
}
function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    m.includes("unknown column")
  );
}
function normalizeArtifactLink(href: string | null | undefined) {
  const raw = safeStr(href).trim();
  if (!raw) return null;
  const hashIdx = raw.indexOf("#");
  const qIdx = raw.indexOf("?");
  const cutIdx =
    qIdx >= 0 && hashIdx >= 0 ? Math.min(qIdx, hashIdx) : qIdx >= 0 ? qIdx : hashIdx >= 0 ? hashIdx : -1;
  const path = cutIdx >= 0 ? raw.slice(0, cutIdx) : raw;
  const tail = cutIdx >= 0 ? raw.slice(cutIdx) : "";
  const fixedPath = path
    .replace(/\/RAID(\/|$)/g, "/raid$1")
    .replace(/\/WBS(\/|$)/g, "/wbs$1")
    .replace(/\/SCHEDULE(\/|$)/g, "/schedule$1")
    .replace(/\/CHANGE(\/|$)/g, "/change$1")
    .replace(/\/CHANGES(\/|$)/g, "/change$1")
    .replace(/\/CHANGE_REQUESTS(\/|$)/g, "/change$1")
    .replace(/\/ARTIFACTS(\/|$)/g, "/artifacts$1");
  return `${fixedPath}${tail}`;
}
function isNumericLike(s: string) {
  return /^\d+$/.test(String(s || "").trim());
}
function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values.map((x) => safeStr(x).trim()).filter(Boolean)
    )
  );
}

/* ── auth error classifier ──────────────────────────────────────────────── */

function isAuthError(e: any): boolean {
  const msg = safeStr(e?.message).toLowerCase();
  return (
    msg === "unauthorized" ||
    msg === "forbidden" ||
    msg.includes("jwt") ||
    msg.includes("not authenticated") ||
    msg.includes("invalid token") ||
    msg.includes("token expired") ||
    msg.includes("refresh_token_not_found") ||
    msg.includes("user not found") ||
    msg.includes("session_not_found") ||
    msg.includes("auth session missing") ||
    (msg.includes("auth") && msg.includes("error"))
  );
}

/* ── canonical DueSoonItem shape ─────────────────────────────────────────── */

type DueSoonItem = {
  type: "milestone" | "work_item" | "raid" | "change_request";
  due_date: string;
  title: string;
  project_id: string;
  project_code: string;
  project_name?: string;
  href: string;
  status?: string;
  owner_label?: string;
  severity?: string;
  rag?: "G" | "A" | "R";
  source?: {
    artifact_id?: string;
    milestone_id?: string;
    work_item_id?: string;
    raid_item_id?: string;
    change_request_id?: string;
  };
};

function buildHref(input: {
  type: DueSoonItem["type"];
  projectUuid: string;
  artifactId?: string | null;
  milestoneId?: string | null;
  workItemId?: string | null;
  raidItemId?: string | null;
  raidPublicId?: string | null;
  changeRequestId?: string | null;
}) {
  const pid = safeStr(input.projectUuid).trim();

  if (input.type === "work_item") {
    const qs = new URLSearchParams();
    qs.set("panel", "wbs");
    if (input.artifactId) qs.set("artifactId", String(input.artifactId));
    if (input.workItemId) qs.set("focus", String(input.workItemId));
    return `/projects/${pid}/artifacts?${qs.toString()}`;
  }

  if (input.type === "milestone") {
    const qs = new URLSearchParams();
    qs.set("panel", "schedule");
    if (input.artifactId) qs.set("artifactId", String(input.artifactId));
    if (input.milestoneId) qs.set("milestone", String(input.milestoneId));
    return `/projects/${pid}/artifacts?${qs.toString()}`;
  }

  if (input.type === "raid") {
    const qs = new URLSearchParams();
    if (input.raidItemId) qs.set("focus", String(input.raidItemId));
    else if (input.raidPublicId) qs.set("focus", String(input.raidPublicId));
    return qs.toString() ? `/projects/${pid}/raid?${qs.toString()}` : `/projects/${pid}/raid`;
  }

  const qs = new URLSearchParams();
  if (input.artifactId) {
    qs.set("artifactId", String(input.artifactId));
    qs.set("panel", "change");
  }
  if (input.changeRequestId) qs.set("focus", String(input.changeRequestId));
  return qs.toString() ? `/projects/${pid}/change?${qs.toString()}` : `/projects/${pid}/change`;
}

/* ── auth ──────────────────────────────────────────────────────────────── */

async function requireAuth(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function requireProjectAccessViaOrg(supabase: any, projectUuid: string, userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id,organisation_id,deleted_at")
    .eq("id", projectUuid)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id || data.deleted_at != null) throw new Error("Project not found");

  const orgId = safeStr(data.organisation_id).trim();
  if (!orgId) throw new Error("Forbidden");

  const { data: mem, error: memErr } = await supabase
    .from("organisation_members")
    .select("role,removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Forbidden");

  return { organisation_id: orgId, role: safeStr(mem.role).trim() || "member" };
}

/* ── shared org-wide portfolio scope loader ────────────────────────────── */

type ScopedPortfolioProject = {
  id: string;
  title: string | null;
  project_code: string | null;
  created_at?: string | null;
};

function extractScopedProjectIds(scope: any): string[] {
  const fromProjectIds = Array.isArray(scope?.projectIds) ? scope.projectIds : [];
  const fromProjectIdsSnake = Array.isArray(scope?.project_ids) ? scope.project_ids : [];
  const fromProjects = Array.isArray(scope?.projects)
    ? scope.projects.map((x: any) => x?.id ?? x?.project_id)
    : [];
  const fromItems = Array.isArray(scope?.items)
    ? scope.items.map((x: any) => x?.id ?? x?.project_id)
    : [];

  return uniqueStrings([...fromProjectIds, ...fromProjectIdsSnake, ...fromProjects, ...fromItems]);
}

async function loadScopedPortfolioProjects(
  supabase: any,
  userId: string
): Promise<{
  projects: ScopedPortfolioProject[];
  scopedProjectIds: string[];
  activeProjectIds: string[];
}> {
  const scope = await resolvePortfolioScope(supabase, userId);
  const scopedProjectIds = extractScopedProjectIds(scope);

  if (!scopedProjectIds.length) {
    return { projects: [], scopedProjectIds: [], activeProjectIds: [] };
  }

  let activeProjectIds = scopedProjectIds;

  try {
    const filtered = await filterActiveProjectIds(supabase, scopedProjectIds);
    const filteredIds = uniqueStrings(Array.isArray(filtered) ? filtered : []);
    if (filteredIds.length > 0) {
      activeProjectIds = filteredIds;
    }
  } catch {
    activeProjectIds = scopedProjectIds;
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id,title,project_code,created_at,deleted_at")
    .in("id", activeProjectIds)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);

  const rows = (Array.isArray(data) ? data : []) as any[];
  const projects = rows
    .map((row) => ({
      id: safeStr(row?.id).trim(),
      title: safeStr(row?.title).trim() || null,
      project_code: safeStr(row?.project_code).trim() || null,
      created_at: safeStr(row?.created_at).trim() || null,
    }))
    .filter((row) => row.id);

  return { projects, scopedProjectIds, activeProjectIds };
}

/* ── project resolver ───────────────────────────────────────────────────── */

const HUMAN_COL_CANDIDATES = [
  "project_code",
  "project_human_id",
  "human_id",
  "code",
  "slug",
  "reference",
  "ref",
] as const;

async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const raw = safeStr(identifier).trim();
  if (!raw) return null;
  if (looksLikeUuid(raw)) return raw;

  const id = normalizeProjectIdentifier(raw);

  for (const col of HUMAN_COL_CANDIDATES) {
    const likelyNumeric = col === "project_code" || col === "human_id" || col === "project_human_id";
    if (likelyNumeric && !isNumericLike(id)) continue;

    const { data, error } = await supabase.from("projects").select("id").eq(col as any, id).maybeSingle();
    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      throw new Error(error.message);
    }
    if (data?.id) return String(data.id);
  }

  for (const col of ["slug", "reference", "ref", "code"] as const) {
    const { data, error } = await supabase.from("projects").select("id").eq(col as any, raw).maybeSingle();
    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      throw new Error(error.message);
    }
    if (data?.id) return String(data.id);
  }

  return null;
}

/* ── project meta ───────────────────────────────────────────────────────── */

type ProjectMeta = {
  project_human_id: string | null;
  project_code: string | null;
  project_name: string | null;
  project_manager_user_id: string | null;
  project_manager_name: string | null;
  project_manager_email: string | null;
};

async function loadProjectMeta(supabase: any, projectUuid: string): Promise<ProjectMeta> {
  const { data: proj, error } = await supabase
    .from("projects")
    .select("id,title,project_code")
    .eq("id", projectUuid)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const project_code = safeStr((proj as any)?.project_code).trim() || null;
  const project_name = safeStr((proj as any)?.title).trim() || null;

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("user_id,created_at,role,removed_at")
    .eq("project_id", projectUuid)
    .in("role", ["project_manager", "owner"] as any)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(25);

  if (memErr) throw new Error(memErr.message);

  const rows = Array.isArray(mem) ? mem : [];
  const pmRow =
    rows.find((x: any) => safeLower(x?.role) === "project_manager" && x?.user_id) ||
    rows.find((x: any) => safeLower(x?.role) === "owner" && x?.user_id) ||
    rows.find((x: any) => x?.user_id);

  const pmUserId = pmRow?.user_id ? String(pmRow.user_id) : null;

  let project_manager_name: string | null = null;
  let project_manager_email: string | null = null;

  if (pmUserId) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name,email")
      .eq("user_id", pmUserId)
      .maybeSingle();

    project_manager_name = safeStr((prof as any)?.full_name).trim() || "Project Manager";
    project_manager_email = safeStr((prof as any)?.email).trim() || null;
  }

  return {
    project_human_id: project_code,
    project_code,
    project_name,
    project_manager_user_id: pmUserId,
    project_manager_name,
    project_manager_email,
  };
}

/* ── draft assist ───────────────────────────────────────────────────────── */

function buildDraftAssistAi(input: any) {
  const title = safeStr(input?.title).trim();
  const summary = safeStr(input?.summary).trim();
  const justification = safeStr(input?.justification).trim();
  const financial = safeStr(input?.financial).trim();
  const schedule = safeStr(input?.schedule).trim();
  const risks = safeStr(input?.risks).trim();
  const dependencies = safeStr(input?.dependencies).trim();
  const assumptions = safeStr(input?.assumptions).trim();
  const implementation = safeStr(input?.implementation).trim();
  const rollback = safeStr(input?.rollback).trim();
  const interview = input?.interview ?? {};

  const about = safeStr(interview?.about).trim();
  const why = safeStr(interview?.why).trim();
  const impacted = safeStr(interview?.impacted).trim();
  const when = safeStr(interview?.when).trim();
  const constraints = safeStr(interview?.constraints).trim();
  const costs = safeStr(interview?.costs).trim();
  const riskLevel = safeStr(interview?.riskLevel).trim() || "Medium";
  const rollbackInterview = safeStr(interview?.rollback).trim();

  const bestTitle = title || about;
  const bestSummary =
    summary ||
    mergeBits([
      about ? `Change: ${about}.` : "",
      why ? `Purpose: ${why}.` : "",
      impacted ? `Impact: ${impacted}.` : "",
      when ? `Timing: ${when}.` : "",
    ]);

  const bestJustification =
    justification ||
    mergeBits([
      why ? `Driver / value: ${why}` : "",
      constraints ? `Governance / constraints: ${constraints}` : "",
      bestTitle ? `Outcome: Deliver "${bestTitle}" with controlled risk and clear validation evidence.` : "",
    ]) ||
    "State why the change is required, business benefit, and risk of not proceeding.";

  const bestFinancial =
    financial ||
    (costs
      ? `Known costs / effort: ${costs}\nBudget/PO: TBC\nCommercial notes: confirm rate card / approvals.`
      : "") ||
    "Confirm cost, resource effort, and any commercial approvals required.";

  const bestSchedule =
    schedule ||
    mergeBits([
      when ? `Target window/milestone: ${when}` : "",
      "Plan: design → approvals → implement → validate → handover/close.",
      "Dependencies: confirm CAB/Change window and sequencing with release calendar.",
    ]) ||
    "Outline target window, milestones, and sequencing.";

  const bestRisks =
    risks ||
    mergeBits([
      `Risk level: ${riskLevel}`,
      "Risks: service disruption, access/security misconfiguration, rollback complexity.",
      "Mitigations: peer review, CAB approval, change window, comms plan, validation checklist.",
    ]) ||
    "Identify top risks and mitigations.";

  const bestDependencies =
    dependencies ||
    mergeBits([
      constraints ? `Approvals: ${constraints}` : "",
      "Dependencies: vendor availability, test environment readiness, access prerequisites, monitoring/alerting.",
    ]) ||
    "Capture approvals, vendors, prerequisites, and tooling.";

  const bestAssumptions =
    assumptions ||
    mergeBits([
      "Assumptions: stakeholder availability, change window access, environments stable, test accounts ready.",
      "Unknowns: confirm impacted services/users and acceptance criteria.",
    ]) ||
    "State assumptions and unknowns to validate.";

  const bestImplementation =
    implementation ||
    mergeBits([
      "Implementation steps:",
      "1) Pre-checks (access, backups/snapshots, approvals logged)",
      "2) Implement change (controlled / scripted where possible)",
      "3) Validate (functional + monitoring checks)",
      "4) Communicate completion + evidence",
      "5) Update docs / handover",
    ]) ||
    "Define pre-checks, controlled change steps, validation, and handover.";

  const bestRollback =
    rollback ||
    mergeBits([
      rollbackInterview
        ? `Rollback approach: ${rollbackInterview}`
        : "Rollback approach: revert configuration / disable new access; restore previous state.",
      "Validation evidence: screenshots/log extracts, monitoring green, stakeholder sign-off.",
    ]) ||
    "Define safe backout and validation evidence.";

  return {
    summary: bestSummary,
    justification: bestJustification,
    financial: bestFinancial,
    schedule: bestSchedule,
    risks: bestRisks,
    dependencies: bestDependencies,
    assumptions: bestAssumptions,
    implementation: bestImplementation,
    rollback: bestRollback,
    impact: { days: 1, cost: 0, risk: "Medium — validate in change window" },
  };
}

/* ── due digest helpers ─────────────────────────────────────────────────── */

type DueDigestItem = {
  itemType: "artifact" | "milestone" | "work_item" | "raid" | "change";
  title: string;
  dueDate: string | null;
  status?: string | null;
  ownerLabel?: string | null;
  ownerEmail?: string | null;
  link?: string | null;
  meta?: any;
};

function extractArtifactDueDate(row: any): Date | null {
  const d1 = parseDueToUtcDate(row?.due_date);
  if (d1) return d1;
  const cj = safeJson(row?.content_json);
  const d2 = parseDueToUtcDate(cj?.due_date ?? cj?.dueDate);
  if (d2) return d2;
  const d3 = parseDueToUtcDate(cj?.meta?.due_date ?? cj?.meta?.dueDate);
  if (d3) return d3;
  return null;
}

function attachProjectMeta(x: DueDigestItem, projectUuid: string, p: any): DueDigestItem {
  return {
    ...x,
    meta: {
      ...(x?.meta ?? {}),
      project_id: projectUuid,
      project_code: p.project_code ?? null,
      project_name: p.project_name ?? null,
      project_human_id: p.project_human_id ?? null,
      project_manager_name: p.project_manager_name ?? null,
      project_manager_email: p.project_manager_email ?? null,
      project_manager_user_id: p.project_manager_user_id ?? null,
    },
  };
}

function toCanonicalDueSoonItem(x: DueDigestItem): DueSoonItem | null {
  const m = x?.meta ?? {};
  const project_id = safeStr(m?.project_id).trim();
  if (!project_id) return null;

  const project_code = normalizeProjectHumanId(m?.project_code ?? null, project_id);
  const project_name = safeStr(m?.project_name).trim() || undefined;
  const due_date = safeStr(x?.dueDate).trim();
  if (!due_date) return null;

  const title = safeStr(x?.title).trim() || "Due item";

  if (x.itemType === "milestone") {
    const milestone_id = safeStr(m?.milestoneId).trim() || undefined;
    const artifact_id = safeStr(m?.sourceArtifactId).trim() || undefined;
    return {
      type: "milestone",
      due_date,
      title,
      project_id,
      project_code,
      project_name,
      href: buildHref({
        type: "milestone",
        projectUuid: project_id,
        artifactId: artifact_id,
        milestoneId: milestone_id,
      }),
      status: safeStr(x?.status).trim() || undefined,
      source: { artifact_id, milestone_id },
    };
  }

  if (x.itemType === "work_item") {
    const work_item_id = safeStr(m?.workItemId).trim() || undefined;
    const artifact_id = safeStr(m?.sourceArtifactId).trim() || undefined;
    return {
      type: "work_item",
      due_date,
      title,
      project_id,
      project_code,
      project_name,
      href: buildHref({
        type: "work_item",
        projectUuid: project_id,
        artifactId: artifact_id,
        workItemId: work_item_id,
      }),
      status: safeStr(x?.status).trim() || undefined,
      owner_label: safeStr(x?.ownerLabel).trim() || undefined,
      source: { artifact_id, work_item_id },
    };
  }

  if (x.itemType === "raid") {
    const raid_item_id = safeStr(m?.raidId ?? m?.raid_item_id).trim() || undefined;
    const raidPublicId = safeStr(m?.publicId).trim() || undefined;
    const ragRaw = safeStr(m?.rag).trim().toUpperCase();
    const rag =
      ragRaw === "G" || ragRaw === "A" || ragRaw === "R" ? (ragRaw as "G" | "A" | "R") : undefined;

    return {
      type: "raid",
      due_date,
      title,
      project_id,
      project_code,
      project_name,
      href: buildHref({
        type: "raid",
        projectUuid: project_id,
        raidItemId: raid_item_id,
        raidPublicId,
      }),
      status: safeStr(x?.status).trim() || undefined,
      owner_label: safeStr(x?.ownerLabel).trim() || undefined,
      severity: safeStr(m?.priority).trim() || safeStr(m?.severity).trim() || undefined,
      rag,
      source: { raid_item_id },
    };
  }

  if (x.itemType === "change") {
    const change_request_id = safeStr(m?.changeId ?? m?.change_request_id).trim() || undefined;
    const artifact_id = safeStr(m?.sourceArtifactId).trim() || undefined;
    return {
      type: "change_request",
      due_date,
      title,
      project_id,
      project_code,
      project_name,
      href: buildHref({
        type: "change_request",
        projectUuid: project_id,
        artifactId: artifact_id,
        changeRequestId: change_request_id,
      }),
      status: safeStr(x?.status).trim() || "review",
      owner_label: safeStr(x?.ownerLabel).trim() || undefined,
      source: { artifact_id, change_request_id },
    };
  }

  return null;
}

/* ── bulk PM loader ─────────────────────────────────────────────────────── */

async function bulkLoadProjectManagers(supabase: any, projectIds: string[]) {
  if (!projectIds.length) {
    return new Map<string, { user_id: string | null; name: string | null; email: string | null }>();
  }

  const { data: mem } = await supabase
    .from("project_members")
    .select("project_id,user_id,role,created_at,removed_at")
    .in("project_id", projectIds)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(50000);

  const rows = Array.isArray(mem) ? (mem as any[]) : [];
  const byProject = new Map<string, any[]>();

  for (const r of rows) {
    const pid = safeStr(r?.project_id).trim();
    if (!pid) continue;
    const arr = byProject.get(pid) ?? [];
    arr.push(r);
    byProject.set(pid, arr);
  }

  const pmUserIds: string[] = [];
  const pmUserByProject = new Map<string, string | null>();

  for (const pid of projectIds) {
    const arr = byProject.get(pid) ?? [];
    const pick = (role: string) => arr.find((x: any) => safeLower(x?.role) === role && x?.user_id)?.user_id;
    const pm = pick("project_manager") || pick("owner") || null;
    const pmId = pm ? String(pm) : null;
    pmUserByProject.set(pid, pmId);
    if (pmId) pmUserIds.push(pmId);
  }

  const uniqUserIds = Array.from(new Set(pmUserIds));
  const profByUser = new Map<string, { name: string | null; email: string | null }>();

  if (uniqUserIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id,full_name,email")
      .in("user_id", uniqUserIds)
      .limit(50000);

    for (const p of Array.isArray(profs) ? (profs as any[]) : []) {
      const uid = safeStr(p?.user_id).trim();
      if (!uid) continue;
      profByUser.set(uid, {
        name: safeStr(p?.full_name).trim() || "Project Manager",
        email: safeStr(p?.email).trim() || null,
      });
    }
  }

  const out = new Map<string, { user_id: string | null; name: string | null; email: string | null }>();
  for (const pid of projectIds) {
    const uid = pmUserByProject.get(pid) ?? null;
    const prof = uid ? profByUser.get(uid) : null;
    out.set(pid, {
      user_id: uid,
      name: prof?.name ?? (uid ? "Project Manager" : null),
      email: prof?.email ?? null,
    });
  }

  return out;
}

/* ── org-scope bulk due loader ──────────────────────────────────────────── */

async function buildDueDigestOrgBulk(args: {
  supabase: any;
  projects: Array<{ id: string; title: string | null; project_code: any }>;
  windowDays: number;
}) {
  const { supabase, projects, windowDays } = args;
  const from = startOfUtcDay(new Date());
  const to = endOfUtcWindow(from, windowDays);
  const projectIds = projects.map((p) => String(p.id)).filter(Boolean);

  const pmByProjectId = await bulkLoadProjectManagers(supabase, projectIds);
  const projectById = new Map<string, any>();

  for (const p of projects) {
    const uuid = String(p.id);
    const code = safeStr((p as any).project_code).trim() || null;
    const name = safeStr((p as any).title).trim() || null;
    const pm = pmByProjectId.get(uuid) || { user_id: null, name: null, email: null };

    projectById.set(uuid, {
      project_code: code,
      project_name: name,
      project_human_id: normalizeProjectHumanId(code, uuid),
      project_manager_user_id: pm.user_id,
      project_manager_name: pm.name,
      project_manager_email: pm.email,
    });
  }

  const [artRes, msRes, wResTry, raidRes, chRes] = await Promise.all([
    supabase
      .from("v_artifact_board")
      .select(
        "project_id,artifact_id,id,artifact_key,title,owner_email,due_date,phase,approval_status,status,updated_at,content_json,artifact_type,type,is_current"
      )
      .in("project_id", projectIds)
      .order("updated_at", { ascending: false })
      .limit(5000),

    supabase
      .from("schedule_milestones")
      .select("id,project_id,milestone_name,start_date,end_date,status,progress_pct,critical_path_flag,source_artifact_id")
      .in("project_id", projectIds)
      .order("end_date", { ascending: true })
      .limit(5000),

    supabase
      .from("work_items")
      .select("id,project_id,title,type,stage,status,due_date,artifact_id,parent_id,milestone_id,created_at,updated_at")
      .in("project_id", projectIds)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .limit(20000),

    supabase
      .from("raid_items")
      .select("id,project_id,public_id,item_no,type,title,description,status,due_date,owner_label,ai_status,priority,source_artifact_id")
      .in("project_id", projectIds)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .limit(20000),

    supabase
      .from("change_requests")
      .select("id,project_id,title,seq,status,delivery_status,decision_status,updated_at,artifact_id,review_by")
      .in("project_id", projectIds)
      .order("updated_at", { ascending: false })
      .limit(5000),
  ]);

  let raidRows: any[] = Array.isArray(raidRes.data) ? (raidRes.data as any[]) : [];
  if (raidRes.error && isMissingColumnError(raidRes.error.message, "source_artifact_id")) {
    const fb = await supabase
      .from("raid_items")
      .select("id,project_id,public_id,item_no,type,title,description,status,due_date,owner_label,ai_status,priority")
      .in("project_id", projectIds)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .limit(20000);
    raidRows = Array.isArray(fb.data) ? (fb.data as any[]) : [];
  }

  let workRows: any[] = Array.isArray(wResTry.data) ? (wResTry.data as any[]) : [];
  if (wResTry.error) {
    const msg = safeStr(wResTry.error.message).toLowerCase();
    if (msg.includes("relation") && msg.includes("work_items") && msg.includes("does not exist")) {
      const wbsFb = await supabase
        .from("wbs_items")
        .select("id,project_id,name,description,status,due_date,owner,source_artifact_id,sort_order,parent_id,updated_at")
        .in("project_id", projectIds)
        .not("due_date", "is", null)
        .order("due_date", { ascending: true })
        .limit(20000);
      workRows = Array.isArray(wbsFb.data) ? (wbsFb.data as any[]) : [];
    }
  }

  const artRows: any[] = Array.isArray(artRes.data) ? (artRes.data as any[]) : [];
  const msRows: any[] = Array.isArray(msRes.data) ? (msRes.data as any[]) : [];
  const chRows: any[] = Array.isArray(chRes.data) ? (chRes.data as any[]) : [];
  const all: DueDigestItem[] = [];

  for (const x of artRows) {
    const projectUuid = safeStr(x?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const due = extractArtifactDueDate(x);
    if (!due || !inWindow(due, from, to)) continue;

    const artifactId = String(x?.artifact_id ?? x?.id ?? "").trim();
    if (!artifactId) continue;

    all.push(
      attachProjectMeta(
        {
          itemType: "artifact",
          title: safeStr(x?.title).trim() || safeStr(x?.artifact_key).trim() || "Artifact",
          dueDate: due.toISOString(),
          ownerEmail: safeStr(x?.owner_email).trim() || null,
          status: safeStr(x?.approval_status ?? x?.status).trim() || null,
          link: normalizeArtifactLink(`/projects/${projectUuid}/artifacts?artifactId=${encodeURIComponent(artifactId)}`),
          meta: {
            artifactId,
            sourceArtifactId: artifactId,
            artifactKey: safeStr(x?.artifact_key).trim() || null,
            phase: x?.phase ?? null,
            artifact_type: safeLower(x?.artifact_type ?? x?.type) || null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  for (const m of msRows) {
    const projectUuid = safeStr(m?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const due = parseDueToUtcDate(m?.end_date ?? m?.start_date);
    if (!due || !inWindow(due, from, to)) continue;

    all.push(
      attachProjectMeta(
        {
          itemType: "milestone",
          title: safeStr(m?.milestone_name).trim() || "Milestone",
          dueDate: due.toISOString(),
          status: safeStr(m?.status).trim() || null,
          link: null,
          meta: {
            milestoneId: String(m?.id ?? "").trim(),
            critical: !!m?.critical_path_flag,
            progress: typeof m?.progress_pct === "number" ? m.progress_pct : null,
            sourceArtifactId: safeStr(m?.source_artifact_id).trim() || null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  for (const w of workRows) {
    const projectUuid = safeStr(w?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const status = safeLower(w?.status);
    if (status === "done" || status === "closed" || status === "completed") continue;

    const due = parseDueToUtcDate(w?.due_date);
    if (!due || !inWindow(due, from, to)) continue;

    const id = String(w?.id ?? "").trim();
    if (!id) continue;

    const srcArtifactId = safeStr((w as any)?.artifact_id).trim() || safeStr((w as any)?.source_artifact_id).trim();

    all.push(
      attachProjectMeta(
        {
          itemType: "work_item",
          title: safeStr((w as any)?.title).trim() || safeStr((w as any)?.name).trim() || "Work item",
          dueDate: due.toISOString(),
          status: safeStr((w as any)?.status).trim() || null,
          ownerLabel: safeStr((w as any)?.owner).trim() || null,
          link: null,
          meta: {
            workItemId: id,
            parentId: safeStr((w as any)?.parent_id).trim() || null,
            milestoneId: safeStr((w as any)?.milestone_id).trim() || null,
            sourceArtifactId: srcArtifactId || null,
            workType: safeStr((w as any)?.type).trim() || null,
            stage: safeStr((w as any)?.stage).trim() || null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  for (const r of raidRows) {
    const projectUuid = safeStr(r?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const st = safeLower(r?.status);
    if (st === "closed" || st === "invalid") continue;

    const due = parseDueToUtcDate(r?.due_date);
    if (!due || !inWindow(due, from, to)) continue;

    all.push(
      attachProjectMeta(
        {
          itemType: "raid",
          title:
            safeStr(r?.title).trim() ||
            safeStr(r?.description).trim().slice(0, 100) ||
            `${safeStr(r?.type).trim() || "RAID"} item`,
          dueDate: due.toISOString(),
          status: safeStr(r?.status).trim() || null,
          ownerLabel: safeStr(r?.owner_label).trim() || null,
          link: null,
          meta: {
            raidId: String(r?.id ?? ""),
            publicId: safeStr(r?.public_id).trim() || null,
            itemNo: r?.item_no ?? null,
            raidType: safeStr(r?.type).trim() || null,
            priority: safeStr(r?.priority).trim() || null,
            aiStatus: safeStr(r?.ai_status).trim() || null,
            sourceArtifactId: safeStr((r as any)?.source_artifact_id).trim() || null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  const isInReview = (r: any) => {
    const d = safeLower(r?.delivery_status);
    const dc = safeLower(r?.decision_status);
    return d === "review" || dc === "submitted";
  };

  for (const c of chRows.filter(isInReview)) {
    const projectUuid = safeStr(c?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const due = parseDueToUtcDate(c?.review_by) || parseDueToUtcDate(c?.updated_at);
    if (!due || !inWindow(due, from, to)) continue;

    const changeId = String(c?.id ?? "").trim();
    if (!changeId) continue;

    all.push(
      attachProjectMeta(
        {
          itemType: "change",
          title: safeStr(c?.title).trim() || "Change request (review)",
          dueDate: due.toISOString(),
          status: safeStr(c?.decision_status ?? c?.delivery_status ?? c?.status ?? "review").trim() || "review",
          link: null,
          meta: {
            changeId,
            seq: c?.seq ?? null,
            reviewBy: safeStr(c?.review_by).trim() || null,
            delivery_status: safeLower(c?.delivery_status) || null,
            decision_status: safeLower(c?.decision_status) || null,
            sourceArtifactId: safeStr(c?.artifact_id).trim() || null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  const dueSoonLegacy = all
    .slice()
    .sort((a: any, b: any) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;
      return safeStr(a.title).localeCompare(safeStr(b.title));
    })
    .slice(0, 500)
    .map((x: any) => ({ ...x, link: normalizeArtifactLink(x.link) || null }));

  const dueSoonCanonical: DueSoonItem[] = dueSoonLegacy
    .map((x: DueDigestItem) => toCanonicalDueSoonItem(x))
    .filter(Boolean) as DueSoonItem[];

  const counts = dueSoonCanonical.reduce(
    (acc: any, x: DueSoonItem) => {
      acc.total++;
      acc[x.type] = (acc[x.type] ?? 0) + 1;
      return acc;
    },
    { total: 0, milestone: 0, work_item: 0, raid: 0, change_request: 0 }
  );

  return {
    summary:
      dueSoonCanonical.length > 0
        ? `Found ${dueSoonCanonical.length} due item(s) in the next ${windowDays} days across ${projects.length} project(s).`
        : `No due items found in the next ${windowDays} days.`,
    windowDays,
    counts,
    dueSoon: dueSoonCanonical,
    dueSoon_legacy: dueSoonLegacy,
    recommendedMessage:
      dueSoonCanonical.length > 0
        ? "Review the due list and notify owners for items due soon."
        : "No reminders needed.",
    _rows: { msRows, workRows, raidRows, chRows, artRows },
  };
}

/* ── stats from bulk rows ───────────────────────────────────────────────── */

function buildDashboardStatsFromBulkRows(args: {
  msRows: any[];
  workRows: any[];
  artRows: any[];
  raidRows: any[];
  chRows: any[];
  projectIds: string[];
}) {
  const { msRows, workRows, artRows, raidRows, chRows, projectIds } = args;
  const from = startOfUtcDay(new Date());
  const to = endOfUtcWindow(from, 30);

  const milestones_due_30d = msRows.filter((m: any) => {
    const st = safeLower(m?.status);
    if (st === "done" || st === "completed" || st === "closed") return false;
    const d = parseDueToUtcDate(m?.end_date ?? m?.start_date);
    return !!(d && inWindow(d, from, to));
  }).length;

  const wbs_done = workRows.filter((x: any) => {
    const st = safeLower(x?.status);
    return st === "done" || st === "completed" || st === "closed";
  }).length;

  const milestones_done = msRows.filter((m: any) => {
    const st = safeLower(m?.status);
    return st === "done" || st === "completed" || st === "closed";
  }).length;

  const raid_closed = raidRows.filter((r: any) => safeLower(r?.status) === "closed").length;

  const changes_closed = chRows.filter((c: any) => {
    const s = safeLower(c?.status);
    const d = safeLower(c?.delivery_status);
    return s === "closed" || s === "implemented" || d === "closed" || d === "implemented";
  }).length;

  const lessons_count = artRows.filter((a: any) => {
    const t = safeLower(a?.artifact_type || a?.type);
    return t === "lessons_learned" && (a?.is_current === true || a?.is_current == null);
  }).length;

  return {
    projects: projectIds.length,
    success: {
      work_packages_completed: wbs_done,
      milestones_done,
      raid_closed,
      changes_closed,
      wbs_done,
      lessons: lessons_count,
    },
    milestones_due_30d,
  };
}

/* ── project-scoped due loaders ─────────────────────────────────────────── */

async function loadDueMilestones(supabase: any, projectUuid: string, from: Date, to: Date): Promise<DueDigestItem[]> {
  const { data, error } = await supabase
    .from("schedule_milestones")
    .select("id,milestone_name,start_date,end_date,status,progress_pct,critical_path_flag,source_artifact_id")
    .eq("project_id", projectUuid)
    .order("end_date", { ascending: true })
    .limit(500);

  if (error || !Array.isArray(data)) return [];

  return (data as any[])
    .map((m: any) => {
      const due = parseDueToUtcDate(m?.end_date ?? m?.start_date);
      if (!due || !inWindow(due, from, to)) return null;

      return {
        itemType: "milestone",
        title: safeStr(m?.milestone_name).trim() || "Milestone",
        dueDate: due.toISOString(),
        status: safeStr(m?.status).trim() || null,
        link: null,
        meta: {
          milestoneId: String(m?.id ?? "").trim(),
          critical: !!m?.critical_path_flag,
          progress: typeof m?.progress_pct === "number" ? m.progress_pct : null,
          sourceArtifactId: safeStr(m?.source_artifact_id).trim() || null,
        },
      } as DueDigestItem;
    })
    .filter(Boolean) as DueDigestItem[];
}

async function loadDueWorkItems(supabase: any, projectUuid: string, from: Date, to: Date): Promise<DueDigestItem[]> {
  const tryWork = await supabase
    .from("work_items")
    .select("id,title,type,stage,status,due_date,artifact_id,parent_id,milestone_id")
    .eq("project_id", projectUuid)
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(1000);

  let rows: any[] = Array.isArray(tryWork.data) ? tryWork.data : [];
  let usedLegacy = false;

  if (tryWork.error) {
    const msg = safeStr(tryWork.error.message).toLowerCase();
    if (msg.includes("relation") && msg.includes("work_items") && msg.includes("does not exist")) {
      usedLegacy = true;
      const fb = await supabase
        .from("wbs_items")
        .select("id,name,description,status,due_date,owner,source_artifact_id,sort_order,parent_id")
        .eq("project_id", projectUuid)
        .not("due_date", "is", null)
        .order("due_date", { ascending: true })
        .limit(1000);
      rows = Array.isArray(fb.data) ? fb.data : [];
    } else {
      return [];
    }
  }

  return rows
    .map((w: any) => {
      const st = safeLower(w?.status);
      if (st === "done" || st === "closed" || st === "completed") return null;

      const due = parseDueToUtcDate(w?.due_date);
      if (!due || !inWindow(due, from, to)) return null;

      const id = String(w?.id ?? "").trim();
      if (!id) return null;

      const srcArtifactId = usedLegacy ? safeStr(w?.source_artifact_id).trim() : safeStr(w?.artifact_id).trim();

      return {
        itemType: "work_item",
        title: usedLegacy ? safeStr(w?.name).trim() || "WBS item" : safeStr(w?.title).trim() || "Work item",
        dueDate: due.toISOString(),
        status: safeStr(w?.status).trim() || null,
        ownerLabel: usedLegacy ? safeStr(w?.owner).trim() || null : null,
        link: null,
        meta: {
          workItemId: id,
          parentId: safeStr(w?.parent_id).trim() || null,
          milestoneId: safeStr(w?.milestone_id).trim() || null,
          sourceArtifactId: srcArtifactId || null,
          workType: safeStr(w?.type).trim() || null,
          stage: safeStr(w?.stage).trim() || null,
          legacy: usedLegacy ? true : undefined,
        },
      } as DueDigestItem;
    })
    .filter(Boolean) as DueDigestItem[];
}

async function loadDueRaidItems(supabase: any, projectUuid: string, from: Date, to: Date): Promise<DueDigestItem[]> {
  const { data, error } = await supabase
    .from("raid_items")
    .select("id,public_id,item_no,type,title,description,status,due_date,owner_label,ai_status,priority,source_artifact_id")
    .eq("project_id", projectUuid)
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(500);

  let rows = data as any[] | null;

  if (error) {
    const fb = await supabase
      .from("raid_items")
      .select("id,public_id,item_no,type,title,description,status,due_date,owner_label,ai_status,priority")
      .eq("project_id", projectUuid)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .limit(500);
    if (fb.error || !Array.isArray(fb.data)) return [];
    rows = fb.data as any[];
  }

  if (!Array.isArray(rows)) return [];

  return rows
    .map((r: any) => {
      const st = safeLower(r?.status);
      if (st === "closed" || st === "invalid") return null;

      const due = parseDueToUtcDate(r?.due_date);
      if (!due || !inWindow(due, from, to)) return null;

      return {
        itemType: "raid",
        title:
          safeStr(r?.title).trim() ||
          safeStr(r?.description).trim().slice(0, 100) ||
          `${safeStr(r?.type).trim() || "RAID"} item`,
        dueDate: due.toISOString(),
        status: safeStr(r?.status).trim() || null,
        ownerLabel: safeStr(r?.owner_label).trim() || null,
        link: null,
        meta: {
          raidId: String(r?.id ?? ""),
          publicId: safeStr(r?.public_id).trim() || null,
          itemNo: r?.item_no ?? null,
          raidType: safeStr(r?.type).trim() || null,
          priority: safeStr(r?.priority).trim() || null,
          aiStatus: safeStr(r?.ai_status).trim() || null,
          sourceArtifactId: safeStr((r as any)?.source_artifact_id).trim() || null,
        },
      } as DueDigestItem;
    })
    .filter(Boolean) as DueDigestItem[];
}

async function loadChangesInReview(supabase: any, projectUuid: string, from: Date, to: Date): Promise<DueDigestItem[]> {
  const { data, error } = await supabase
    .from("change_requests")
    .select("id,title,seq,status,delivery_status,decision_status,updated_at,artifact_id,review_by")
    .eq("project_id", projectUuid)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !Array.isArray(data)) return [];

  const isInReview = (r: any) => {
    const d = safeLower(r?.delivery_status);
    const dc = safeLower(r?.decision_status);
    return d === "review" || dc === "submitted";
  };

  return (data as any[])
    .filter(isInReview)
    .map((c: any) => {
      const due = parseDueToUtcDate(c?.review_by) || parseDueToUtcDate(c?.updated_at);
      if (!due || !inWindow(due, from, to)) return null;

      const changeId = String(c?.id ?? "").trim();
      if (!changeId) return null;

      return {
        itemType: "change",
        title: safeStr(c?.title).trim() || "Change request (review)",
        dueDate: due.toISOString(),
        status: safeStr(c?.decision_status ?? c?.delivery_status ?? c?.status ?? "review").trim() || "review",
        link: null,
        meta: {
          changeId,
          seq: c?.seq ?? null,
          reviewBy: safeStr(c?.review_by).trim() || null,
          delivery_status: safeLower(c?.delivery_status) || null,
          decision_status: safeLower(c?.decision_status) || null,
          sourceArtifactId: safeStr(c?.artifact_id).trim() || null,
        },
      } as DueDigestItem;
    })
    .filter(Boolean) as DueDigestItem[];
}

async function buildDueDigestAi(supabase: any, projectUuid: string, meta: ProjectMeta, windowDays: number) {
  const from = startOfUtcDay(new Date());
  const to = endOfUtcWindow(from, windowDays);

  const [milestones, workItems, raidItems, changesInReview] = await Promise.all([
    loadDueMilestones(supabase, projectUuid, from, to),
    loadDueWorkItems(supabase, projectUuid, from, to),
    loadDueRaidItems(supabase, projectUuid, from, to),
    loadChangesInReview(supabase, projectUuid, from, to),
  ]);

  const enrich = (x: DueDigestItem) =>
    attachProjectMeta(x, projectUuid, {
      project_code: meta.project_code,
      project_name: meta.project_name,
      project_human_id: meta.project_human_id,
      project_manager_email: meta.project_manager_email,
      project_manager_name: meta.project_manager_name,
      project_manager_user_id: meta.project_manager_user_id,
    });

  const all: DueDigestItem[] = [
    ...milestones.map(enrich),
    ...workItems.map(enrich),
    ...raidItems.map(enrich),
    ...changesInReview.map(enrich),
  ];

  const dueSoonLegacy = all
    .slice()
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return ad !== bd ? ad - bd : safeStr(a.title).localeCompare(safeStr(b.title));
    })
    .slice(0, 500)
    .map((x) => ({ ...x, link: normalizeArtifactLink(x.link) || null }));

  const dueSoonCanonical: DueSoonItem[] = dueSoonLegacy
    .map((x) => toCanonicalDueSoonItem(x))
    .filter(Boolean) as DueSoonItem[];

  const counts = dueSoonCanonical.reduce(
    (acc: any, x: DueSoonItem) => {
      acc.total++;
      acc[x.type] = (acc[x.type] ?? 0) + 1;
      return acc;
    },
    { total: 0, milestone: 0, work_item: 0, raid: 0, change_request: 0 }
  );

  return {
    summary:
      dueSoonCanonical.length > 0
        ? `Found ${dueSoonCanonical.length} due item(s) in the next ${windowDays} days.`
        : `No due items found in the next ${windowDays} days.`,
    windowDays,
    counts,
    dueSoon: dueSoonCanonical,
    dueSoon_legacy: dueSoonLegacy,
    recommendedMessage:
      dueSoonCanonical.length > 0
        ? "Review the due list and notify owners for items due soon."
        : "No reminders needed.",
  };
}

/* ── weekly_report_narrative ───────────────────────────────────────────── */

async function buildWeeklyReportNarrative(payload: any): Promise<{
  headline: string;
  narrative: string;
  delivered: Array<{ text: string }>;
  planNextWeek: Array<{ text: string }>;
  resourceSummary: Array<{ text: string }>;
  keyDecisions: Array<{ text: string; link: null }>;
  blockers: Array<{ text: string; link: null }>;
}> {
  const {
    ragStatus = "green",
    healthContext = "",
    projectName = "",
    projectCode = "",
    managerName = "",
    period,
  } = payload ?? {};

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const systemPrompt = `You are a senior project delivery manager writing weekly executive status reports.

STYLE RULES — follow exactly:

Headline ("headline"):
- One sentence, max 12 words.
- Format: "[Project] — [RAG label] ([score]% health)"

Executive narrative ("narrative"):
- 3-5 sentences of flowing prose. NO bullets. NO lists.
- Board-level: direct, factual, confident. No "I". No invented specifics.

Completed items ("delivered"): Past-tense verb-led phrases, 3-5 items.
Next period items ("planNextWeek"): Future-tense verb-led phrases, 3-5 items.
Resource summary ("resourceSummary"): 1-2 plain sentences on utilisation. 1-2 items.
Key decisions ("keyDecisions"): Concise noun phrases, 2-4 items.
Blockers ("blockers"): Noun phrases stating what is blocked and why. 0-3 items. Empty array if none obvious.

Return ONLY valid JSON — no markdown, no extra keys:
{
  "headline": "string",
  "narrative": "string",
  "delivered": [{ "text": "string" }],
  "planNextWeek": [{ "text": "string" }],
  "resourceSummary": [{ "text": "string" }],
  "keyDecisions": [{ "text": "string", "link": null }],
  "blockers": [{ "text": "string", "link": null }]
}`.trim();

  const userPrompt = `Project: ${projectName}${projectCode ? ` (${projectCode})` : ""}
${managerName ? `Project Manager: ${managerName}` : ""}
Period: ${period?.from ?? "this week"} to ${period?.to ?? "today"}
RAG Status: ${String(ragStatus).toUpperCase()}

Live health data:
${healthContext}

Generate the weekly report fields. Where data is insufficient, write realistic PM-editable placeholders. Do not leave any array field empty.`.trim();

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 800,
    temperature: 0.3,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
  });

  let result: Record<string, any> = {};
  try {
    result = JSON.parse(completion.choices[0].message.content ?? "{}");
  } catch {
    throw new Error("AI returned invalid JSON for weekly_report_narrative");
  }

  return {
    headline: typeof result.headline === "string" ? result.headline : "",
    narrative: typeof result.narrative === "string" ? result.narrative : "",
    delivered: Array.isArray(result.delivered) ? result.delivered : [],
    planNextWeek: Array.isArray(result.planNextWeek) ? result.planNextWeek : [],
    resourceSummary: Array.isArray(result.resourceSummary) ? result.resourceSummary : [],
    keyDecisions: Array.isArray(result.keyDecisions) ? result.keyDecisions : [],
    blockers: Array.isArray(result.blockers) ? result.blockers : [],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   GET — canonical /api/ai/events?windowDays=14
══════════════════════════════════════════════════════════════════════════ */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);
    const url = new URL(req.url);
    const windowDays = parseWindowDays(url.searchParams.get("windowDays"), 14);

    const scoped = await loadScopedPortfolioProjects(supabase, user.id);
    const projects = scoped.projects;

    if (!projects.length) {
      return jsonNoStore({
        ok: true,
        eventType: "artifact_due",
        scope: "org",
        model: "artifact-due-rules-v7-org-scope",
        ai: {
          summary: "No projects available for this portfolio scope.",
          windowDays,
          counts: { total: 0, milestone: 0, work_item: 0, raid: 0, change_request: 0 },
          dueSoon: [],
          recommendedMessage: "Create a project to start tracking due items.",
        },
        stats: {
          projects: 0,
          milestones_due_30d: 0,
          success: {
            work_packages_completed: 0,
            milestones_done: 0,
            raid_closed: 0,
            changes_closed: 0,
            wbs_done: 0,
            lessons: 0,
          },
        },
      });
    }

    const bulkResult = await buildDueDigestOrgBulk({ supabase, projects, windowDays });
    const projectIds = projects.map((p) => String(p.id)).filter(Boolean);

    const stats = buildDashboardStatsFromBulkRows({
      msRows: bulkResult._rows.msRows,
      workRows: bulkResult._rows.workRows,
      artRows: bulkResult._rows.artRows,
      raidRows: bulkResult._rows.raidRows,
      chRows: bulkResult._rows.chRows,
      projectIds,
    });

    const { _rows: _dropped, dueSoon_legacy: _legacy, ...ai } = bulkResult;

    return jsonNoStore({
      ok: true,
      eventType: "artifact_due",
      scope: "org",
      model: "artifact-due-rules-v7-org-scope",
      windowDays,
      dueSoon: ai.dueSoon,
      counts: ai.counts,
      ai,
      stats,
    });
  } catch (e: any) {
    if (isAuthError(e)) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return jsonNoStore(
      {
        ok: false,
        error: e?.message ?? "Unknown error",
        meta: { code: e?.code ?? null, details: e?.details ?? null, hint: e?.hint ?? null },
      },
      { status: 500 }
    );
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   POST handler
══════════════════════════════════════════════════════════════════════════ */

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({} as any));
    const eventType = safeStr(body?.eventType).trim();
    const payload = (body && typeof body === "object" ? (body as any).payload : null) || null;

    const rawProject =
      safeStr(body?.project_id).trim() ||
      safeStr(body?.projectId).trim() ||
      safeStr(body?.project_human_id).trim() ||
      safeStr(body?.payload?.project_id).trim() ||
      safeStr(body?.payload?.projectId).trim() ||
      safeStr(body?.payload?.project_human_id).trim();

    if (eventType === "artifact_due" && !rawProject) {
      const windowDays = parseWindowDays(body?.windowDays ?? payload?.windowDays, 14);
      const scoped = await loadScopedPortfolioProjects(supabase, user.id);
      const projects = scoped.projects;

      if (!projects.length) {
        return jsonNoStore({
          ok: true,
          eventType,
          scope: "org",
          model: "artifact-due-rules-v7-org-scope",
          ai: {
            summary: "No projects available for this portfolio scope.",
            windowDays,
            counts: { total: 0, milestone: 0, work_item: 0, raid: 0, change_request: 0 },
            dueSoon: [],
            recommendedMessage: "Create a project to start tracking due items.",
          },
          stats: {
            projects: 0,
            milestones_due_30d: 0,
            success: {
              work_packages_completed: 0,
              milestones_done: 0,
              raid_closed: 0,
              changes_closed: 0,
              wbs_done: 0,
              lessons: 0,
            },
          },
        });
      }

      const bulkResult = await buildDueDigestOrgBulk({ supabase, projects, windowDays });
      const projectIds = projects.map((p) => String(p.id)).filter(Boolean);

      const stats = buildDashboardStatsFromBulkRows({
        msRows: bulkResult._rows.msRows,
        workRows: bulkResult._rows.workRows,
        artRows: bulkResult._rows.artRows,
        raidRows: bulkResult._rows.raidRows,
        chRows: bulkResult._rows.chRows,
        projectIds,
      });

      const { _rows: _dropped, dueSoon_legacy: _legacy, ...ai } = bulkResult;

      return jsonNoStore({
        ok: true,
        eventType,
        scope: "org",
        model: "artifact-due-rules-v7-org-scope",
        ai,
        windowDays,
        dueSoon: ai.dueSoon,
        counts: ai.counts,
        stats,
      });
    }

    if (!rawProject && eventType !== "artifact_due") {
      return jsonNoStore({ ok: false, error: "Missing project id" }, { status: 400 });
    }

    const projectUuid = rawProject ? await resolveProjectUuid(supabase, rawProject) : null;
    if (rawProject && !projectUuid) {
      return jsonNoStore({ ok: false, error: "Project not found", meta: { rawProject } }, { status: 404 });
    }

    if (projectUuid) {
      await requireProjectAccessViaOrg(supabase, projectUuid, user.id);
    }

    const meta = projectUuid
      ? await loadProjectMeta(supabase, projectUuid)
      : {
          project_human_id: null,
          project_code: null,
          project_name: null,
          project_manager_user_id: null,
          project_manager_name: null,
          project_manager_email: null,
        };

    const draftId =
      safeStr((payload as any)?.draftId).trim() || safeStr(body?.draftId).trim() || "";

    if (eventType === "artifact_due" && projectUuid) {
      const windowDays = parseWindowDays((body as any)?.windowDays ?? (payload as any)?.windowDays, 14);
      const ai = await buildDueDigestAi(supabase, projectUuid, meta, windowDays);

      return jsonNoStore({
        ok: true,
        eventType,
        scope: "project",
        project_id: projectUuid,
        project_code: meta.project_code,
        project_name: meta.project_name,
        project_manager_name: meta.project_manager_name,
        project_manager_email: meta.project_manager_email,
        model: "artifact-due-rules-v7-project-scope",
        windowDays,
        dueSoon: ai.dueSoon,
        counts: ai.counts,
        ai,
      });
    }

    if (eventType === "weekly_report_narrative") {
      try {
        const result = await buildWeeklyReportNarrative(payload);
        return jsonNoStore({ ok: true, ...result });
      } catch (e: any) {
        return jsonNoStore(
          { ok: false, error: e?.message ?? "weekly_report_narrative failed" },
          { status: 500 }
        );
      }
    }

    if (eventType === "change_ai_impact_assessment") {
      const changeId =
        safeStr((payload as any)?.changeId).trim() ||
        safeStr((payload as any)?.change_id).trim() ||
        safeStr((body as any)?.changeId).trim() ||
        safeStr((body as any)?.artifactId).trim();

      if (!changeId) return jsonNoStore({ ok: false, error: "Missing changeId" }, { status: 400 });
      if (!projectUuid) {
        return jsonNoStore({ ok: false, error: "Missing project id for change assessment" }, { status: 400 });
      }

      let cr: any = null;

      const { data: d1, error: e1 } = await supabase
        .from("change_requests")
        .select(
          "id,project_id,title,description,delivery_status,decision_status,priority,impact_analysis,justification,financial,schedule,risks,dependencies,assumptions,implementation_plan,rollback_plan"
        )
        .eq("id", changeId)
        .eq("project_id", projectUuid)
        .maybeSingle();

      if (!e1) {
        cr = d1;
      } else {
        const { data: d2, error: e2 } = await supabase
          .from("change_requests")
          .select("id,project_id,title,description,delivery_status,decision_status,priority,impact_analysis")
          .eq("id", changeId)
          .eq("project_id", projectUuid)
          .maybeSingle();

        if (e2) return jsonNoStore({ ok: false, error: e2.message }, { status: 500 });
        cr = d2;
      }

      if (!cr) return jsonNoStore({ ok: false, error: "Change request not found" }, { status: 404 });

      const impact = (cr as any)?.impact_analysis ?? {};

      const assessment = await buildPmImpactAssessment({
        title: safeStr((cr as any)?.title),
        description: safeStr((cr as any)?.description),
        justification: safeStr((cr as any)?.justification),
        financial: safeStr((cr as any)?.financial),
        schedule: safeStr((cr as any)?.schedule),
        risks: safeStr((cr as any)?.risks),
        dependencies: safeStr((cr as any)?.dependencies),
        implementationPlan:
          safeStr((cr as any)?.implementation_plan) || safeStr((cr as any)?.implementationPlan),
        rollbackPlan: safeStr((cr as any)?.rollback_plan) || safeStr((cr as any)?.rollbackPlan),
        deliveryStatus: safeStr((cr as any)?.delivery_status),
        decisionStatus: safeStr((cr as any)?.decision_status),
        priority: safeStr((cr as any)?.priority),
        cost: safeNumAi(impact?.cost, 0),
        days: safeNumAi(impact?.days, 0),
        risk: safeStr(impact?.risk),
      });

      return jsonNoStore({
        ok: true,
        eventType,
        scope: "project",
        project_id: projectUuid,
        readiness_score: assessment.readiness_score,
        readiness_label: assessment.readiness_label,
        recommendation: assessment.recommendation,
        executive_summary: assessment.executive_summary,
        schedule: assessment.schedule,
        cost: assessment.cost,
        risk: assessment.risk,
        assessment_scope: assessment.scope,
        governance: assessment.governance,
        blockers: assessment.blockers,
        strengths: assessment.strengths,
        next_actions: assessment.next_actions,
        model: assessment.model,
      });
    }

    const knownTypes = [
      "artifact_due",
      "delivery_report",
      "weekly_report_narrative",
      "change_ai_impact_assessment",
    ];

    if (eventType && !knownTypes.includes(eventType)) {
      console.warn(`[ai/events] Unrecognised eventType "${eventType}" — falling through to draft assist.`);
    }

    const draft =
      payload && typeof payload === "object"
        ? payload
        : body && typeof body === "object"
          ? body
          : ({} as any);

    return jsonNoStore({
      ok: true,
      eventType: eventType || "change_draft_assist_requested",
      model: "draft-rules-v1",
      draftId,
      project_id: projectUuid,
      project_human_id: meta.project_human_id,
      project_code: meta.project_code,
      project_name: meta.project_name,
      project_manager_name: meta.project_manager_name,
      project_manager_email: meta.project_manager_email,
      project_manager_user_id: meta.project_manager_user_id,
      ai: buildDraftAssistAi(draft),
    });
  } catch (e: any) {
    if (isAuthError(e)) {
      return jsonNoStore({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return jsonNoStore(
      {
        ok: false,
        error: e?.message ?? "Unknown error",
        meta: { code: e?.code ?? null, details: e?.details ?? null, hint: e?.hint ?? null },
      },
      { status: 500 }
    );
  }
}