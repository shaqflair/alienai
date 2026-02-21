// src/app/api/ai/events/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// ✅ prevent cross-user caching (dashboard KPI bleed)
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- utils ---------------- */

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

  // ISO / YYYY-MM-DD / timestamps
  const isoTry = new Date(s);
  if (!isNaN(isoTry.getTime())) return isoTry;

  // DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = clampInt(m[1], 1, 31, 1);
    const mm = clampInt(m[2], 1, 12, 1);
    const yyyy = clampInt(m[3], 1900, 3000, 2000);
    return new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0));
  }

  return null;
}

/* ---------------- UK date formatting (human-facing only) ---------------- */

function fmtUkDateFromDate(d: Date | null | undefined) {
  if (!d) return "";
  // Always format in UTC to avoid local-time day shifts
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

function fmtUkDateFromAny(value: any) {
  const d = parseDueToUtcDate(value);
  return d ? fmtUkDateFromDate(d) : safeStr(value).trim();
}

function mergeBits(parts: Array<string | null | undefined>) {
  return parts
    .map((x) => safeStr(x).trim())
    .filter(Boolean)
    .join("\n\n");
}

/** prefer project_code for routes (/projects/:humanId/...) */
function normalizeProjectHumanId(projectHumanId: string | null | undefined, fallback: string) {
  const v = safeStr(projectHumanId).trim();
  return v || safeStr(fallback).trim();
}

/**
 * Normalize incoming project identifier:
 * - decodeURIComponent
 * - trim
 * - allow "P-100011" -> "100011"
 */
function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();

  // common prefixes: P-100011 / PRJ-100011 etc → extract last numeric run
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
    (m.includes("unknown column") && m.includes(c))
  );
}

function shapeSbError(err: any) {
  if (!err) return { kind: "empty" };
  return {
    code: err?.code ?? null,
    message: err?.message ?? String(err),
    details: err?.details ?? null,
    hint: err?.hint ?? null,
  };
}

/**
 * ✅ Server-side link normaliser (prevents /RAID, /WBS etc)
 * Works on relative paths; preserves query/hash.
 */
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

/* ---------------- admin client (service role) ---------------- */

function adminClientOrNull() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

/* ---------------- ai_suggestions generator helpers ---------------- */

type SuggestionInsert = {
  project_id: string;
  artifact_id: string | null;
  section_key: string | null;
  target_artifact_type: string;
  suggestion_type: string;
  rationale: string | null;
  confidence: number | null;
  patch: any;
  status: "proposed";
  created_by?: string | null;
};

function isEmptyText(v: any) {
  return !safeStr(v).trim();
}

function normalizeCharterSections(doc: any): Array<{ key: string; title: string; bullets?: string; table?: any }> {
  const d = safeJson(doc) ?? doc;
  const secs = Array.isArray(d?.sections) ? d.sections : [];
  return secs
    .map((s: any) => ({
      key: safeStr(s?.key).trim(),
      title: safeStr(s?.title).trim(),
      bullets: typeof s?.bullets === "string" ? s.bullets : undefined,
      table: s?.table ?? null,
    }))
    .filter((s) => !!s.key);
}

/**
 * FAST, deterministic "exec-friendly" rules:
 * - If key sections empty → propose content
 * - Always store patch shape compatible with your apply route:
 *   { kind:"replace_bullets", bullets:"..." } or { kind:"add_rows", rows:[...] }
 */
function buildCharterRuleSuggestions(args: {
  projectUuid: string;
  artifactId: string;
  projectName?: string | null;
  pmName?: string | null;
  contentJson: any;
  actorUserId: string;
}): SuggestionInsert[] {
  const { projectUuid, artifactId, projectName, pmName, contentJson, actorUserId } = args;

  const secs = normalizeCharterSections(contentJson);
  const byKey = new Map(secs.map((s) => [safeLower(s.key), s]));

  const suggestions: SuggestionInsert[] = [];

  const want = [
    { key: "business_case", title: "Business Case" },
    { key: "objectives", title: "Objectives" },
    { key: "key_deliverables", title: "Key Deliverables" },
    { key: "risks", title: "Risks" },
    { key: "issues", title: "Issues" },
    { key: "assumptions", title: "Assumptions" },
    { key: "dependencies", title: "Dependencies" },
  ];

  for (const w of want) {
    const sec = byKey.get(w.key);
    const empty = !sec || isEmptyText(sec.bullets);

    if (!empty) continue;

    const bullets =
      w.key === "business_case"
        ? [
            `${projectName ? `${projectName}: ` : ""}Business case summary (replace with confirmed detail).`,
            "[TBC] Business drivers and strategic alignment.",
            "[TBC] Expected benefits and success measures.",
            "[ASSUMPTION] Funding/budget approval path and governance cadence.",
          ].join("\n")
        : w.key === "objectives"
          ? [
              "Deliver agreed scope on time and within tolerance.",
              "Improve operational outcomes (quality, cycle time, compliance) with measurable KPIs.",
              "[TBC] Stakeholder acceptance criteria and sign-off approach.",
            ].join("\n")
          : w.key === "key_deliverables"
            ? ["[TBC] Deliverable 1", "[TBC] Deliverable 2", "[TBC] Deliverable 3"].join("\n")
            : w.key === "risks"
              ? [
                  "Resource constraints / SME availability — Mitigation: confirm RACI + booking plan.",
                  "Scope creep — Mitigation: baseline scope + change control enforcement.",
                  "Delivery dependencies not met — Mitigation: dependency log + weekly review.",
                ].join("\n")
              : w.key === "issues"
                ? ["No known issues yet. [TBC]"].join("\n")
                : w.key === "assumptions"
                  ? [
                      "Stakeholders are available for workshops and approvals.",
                      "Environments and access are provisioned before build starts.",
                      "Requirements and acceptance criteria will be signed off within agreed SLA.",
                    ].join("\n")
                  : [
                      "Dependencies: upstream approvals, vendor lead times, environments, access and test data.",
                      "External dependencies: release calendar / change windows / CAB.",
                    ].join("\n");

    suggestions.push({
      project_id: projectUuid,
      artifact_id: artifactId,
      section_key: w.key,
      target_artifact_type: "project_charter",
      suggestion_type: "replace_bullets",
      rationale: `Section "${w.title}" is empty. Populate with an executive-ready baseline to accelerate drafting.`,
      confidence: 0.62,
      patch: { kind: "replace_bullets", bullets },
      status: "proposed",
      created_by: actorUserId,
    });
  }

  // Example table suggestion: milestones_timeline empty → add starter row
  const ms = byKey.get("milestones_timeline");
  const msTableRows = Array.isArray(ms?.table?.rows) ? ms!.table.rows : [];
  const hasAnyDataRow = msTableRows.some(
    (r: any) =>
      safeLower(r?.type) === "data" && r?.cells?.some((c: any) => safeStr(c).trim())
  );

  if (!hasAnyDataRow) {
    suggestions.push({
      project_id: projectUuid,
      artifact_id: artifactId,
      section_key: "milestones_timeline",
      target_artifact_type: "project_charter",
      suggestion_type: "add_rows",
      rationale: "Milestones & Timeline has no data rows. Add starter milestones to structure the plan.",
      confidence: 0.55,
      patch: {
        kind: "add_rows",
        mode: "append",
        rows: [
          ["Kick-off", "[TBC] DD/MM/YYYY", "", "Confirm governance cadence + stakeholders"],
          ["Design complete", "[TBC] DD/MM/YYYY", "", "Requirements sign-off achieved"],
        ],
      },
      status: "proposed",
      created_by: actorUserId,
    });
  }

  // Optional: propose to populate PM/owner if missing (meta is handled in editor, but suggestion is still useful)
  if (pmName && pmName.trim()) {
    // (intentionally left empty for now)
  }

  return suggestions;
}

/** De-dupe: same project+artifact+section+suggestion_type+status='proposed' */
async function insertSuggestionsDeduped(args: { supabaseAdmin: any; suggestions: SuggestionInsert[] }) {
  const { supabaseAdmin, suggestions } = args;
  if (!suggestions.length) return [];

  const projectId = suggestions[0].project_id;
  const artifactId = suggestions[0].artifact_id;

  const { data: existing, error: exErr } = await supabaseAdmin
    .from("ai_suggestions")
    .select("id, project_id, artifact_id, section_key, suggestion_type, status")
    .eq("project_id", projectId)
    .eq("status", "proposed")
    .eq("artifact_id", artifactId);

  if (exErr) throw new Error(exErr.message);

  const seen = new Set(
    (Array.isArray(existing) ? existing : []).map(
      (x: any) =>
        `${safeLower(x.project_id)}|${safeLower(x.artifact_id)}|${safeLower(x.section_key)}|${safeLower(
          x.suggestion_type
        )}`
    )
  );

  const toInsert = suggestions.filter((s) => {
    const k = `${safeLower(s.project_id)}|${safeLower(s.artifact_id)}|${safeLower(s.section_key)}|${safeLower(
      s.suggestion_type
    )}`;
    return !seen.has(k);
  });

  if (!toInsert.length) return [];

  const { data: inserted, error: insErr } = await supabaseAdmin.from("ai_suggestions").insert(toInsert).select("*");

  if (insErr) throw new Error(insErr.message);

  return Array.isArray(inserted) ? inserted : [];
}

/* ---------------- auth + access ---------------- */

async function requireAuth(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

/**
 * ✅ Membership check MUST be via organisation_members + projects.organisation_id
 * (project_members was legacy and can cause false positives/negatives)
 *
 * NOTE: We keep this against `projects` (not the view) so direct access to a closed project
 * can still work when called project-scoped. Dashboard/org lists use projects_active instead.
 */
async function requireProjectAccessViaOrg(supabase: any, projectUuid: string, userId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("id, organisation_id, deleted_at")
    .eq("id", projectUuid)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id || data.deleted_at != null) throw new Error("Project not found");

  const orgId = safeStr(data.organisation_id).trim();
  if (!orgId) throw new Error("Forbidden");

  const { data: mem, error: memErr } = await supabase
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Forbidden");

  return { organisation_id: orgId, role: safeStr(mem.role).trim() || "member" };
}

async function loadMyOrgIds(supabase: any, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .is("removed_at", null);

  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data : [])
    .map((x: any) => safeStr(x?.organisation_id).trim())
    .filter(Boolean);
}

/**
 * ✅ DASHBOARD-GRADE ACTIVE PROJECTS ONLY
 * Uses DB view `public.projects_active` which already excludes deleted/closed/cancelled/completed.
 */
async function loadProjectsForOrgs(supabase: any, orgIds: string[]) {
  if (!orgIds.length) return [];
  const { data, error } = await supabase
    .from("projects_active")
    .select("id,title,project_code,organisation_id,created_at")
    .in("organisation_id", orgIds)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

/* ---------------- project resolver ---------------- */

const HUMAN_COL_CANDIDATES = [
  "project_code",
  "project_human_id",
  "human_id",
  "code",
  "slug",
  "reference",
  "ref",
] as const;

function isNumericLike(s: string) {
  return /^\d+$/.test(String(s || "").trim());
}

async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const raw = safeStr(identifier).trim();
  if (!raw) return null;

  // 1) UUID
  if (looksLikeUuid(raw)) return raw;

  // 2) Normalize human ids like P-100011 → 100011
  const id = normalizeProjectIdentifier(raw);

  // 3) Probe candidate columns until one works
  for (const col of HUMAN_COL_CANDIDATES) {
    const likelyNumeric = col === "project_code" || col === "human_id" || col === "project_human_id";
    if (likelyNumeric && !isNumericLike(id)) continue;

    const { data, error } = await supabase.from("projects").select("id").eq(col as any, id).maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      const shaped = shapeSbError(error);
      throw new Error(`${shaped.code || "db_error"}: ${shaped.message}`);
    }

    if (data?.id) return String(data.id);
  }

  // 4) Final attempt, try slug-ish columns with raw (in case normalize stripped meaning)
  for (const col of ["slug", "reference", "ref", "code"] as const) {
    const { data, error } = await supabase.from("projects").select("id").eq(col as any, raw).maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      const shaped = shapeSbError(error);
      throw new Error(`${shaped.code || "db_error"}: ${shaped.message}`);
    }
    if (data?.id) return String(data.id);
  }

  return null;
}

/* ---------------- project meta + PM resolver ---------------- */

type ProjectMeta = {
  project_human_id: string | null; // project_code
  project_code: string | null;
  project_name: string | null;

  project_manager_user_id: string | null;
  project_manager_name: string | null;
  project_manager_email: string | null;
};

/**
 * PM resolution (production-safe):
 * 1) role='project_manager' (active) earliest assignment
 * 2) else role='owner' (active) earliest assignment
 * Profiles lookup via profiles.user_id (unique in your schema)
 */
async function loadProjectMeta(supabase: any, projectUuid: string): Promise<ProjectMeta> {
  const { data: proj, error } = await supabase
    .from("projects")
    .select("id,title,project_code")
    .eq("id", projectUuid)
    .maybeSingle();

  if (error) {
    const shaped = shapeSbError(error);
    throw new Error(`${shaped.code || "db_error"}: ${shaped.message}`);
  }

  const project_code = safeStr(proj?.project_code).trim() || null;
  const project_name = safeStr(proj?.title).trim() || null;

  const pickMemberForRoles = async (roles: string[]) => {
    const { data, error: memErr } = await supabase
      .from("project_members")
      .select("user_id, created_at, role")
      .eq("project_id", projectUuid)
      .in("role", roles as any)
      .is("removed_at", null)
      .order("created_at", { ascending: true })
      .limit(25);

    if (memErr) {
      const shaped = shapeSbError(memErr);
      throw new Error(`${shaped.code || "db_error"}: ${shaped.message}`);
    }

    const rows = Array.isArray(data) ? data : [];
    // prefer first role in roles[] order
    for (const r of roles) {
      const hit = rows.find((x: any) => safeLower(x?.role) === safeLower(r) && x?.user_id);
      if (hit) return String(hit.user_id);
    }
    // fallback to first row
    const first = rows.find((x: any) => x?.user_id);
    return first?.user_id ? String(first.user_id) : null;
  };

  // Try PM role first, then owner
  let pmUserId: string | null = null;

  // If your constraint currently doesn't include 'project_manager', this will simply return no rows (fine).
  pmUserId = await pickMemberForRoles(["project_manager", "owner"]);

  let project_manager_name: string | null = null;
  let project_manager_email: string | null = null;

  if (pmUserId) {
    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("full_name,email")
      .eq("user_id", pmUserId)
      .maybeSingle();

    if (profErr) {
      const shaped = shapeSbError(profErr);
      throw new Error(`${shaped.code || "db_error"}: ${shaped.message}`);
    }

    project_manager_name = safeStr(prof?.full_name).trim() || "Project Manager";
    project_manager_email = safeStr(prof?.email).trim() || null;
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

/* ---------------- draft assist ---------------- */

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
    (costs ? `Known costs / effort: ${costs}\nBudget/PO: TBC\nCommercial notes: confirm rate card / approvals.` : "") ||
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

/* ---------------- artifact_due digest loaders ---------------- */

type DueDigestItem = {
  itemType: "artifact" | "milestone" | "work_item" | "raid" | "change";
  title: string;
  dueDate: string | null; // ISO timestamp string
  status?: string | null;
  ownerLabel?: string | null;
  ownerEmail?: string | null;
  link?: string | null;
  meta?: any;
};

function linkForArtifact(projectHumanId: string, artifactId: string) {
  return normalizeArtifactLink(`/projects/${projectHumanId}/artifacts/${artifactId}`);
}
function linkForSchedule(projectHumanId: string, focusMilestoneId?: string) {
  const base = `/projects/${projectHumanId}/schedule`;
  const url = focusMilestoneId ? `${base}?milestone=${encodeURIComponent(focusMilestoneId)}` : base;
  return normalizeArtifactLink(url);
}
function linkForWbs(projectHumanId: string, focusWorkItemId?: string) {
  const base = `/projects/${projectHumanId}/wbs`;
  const url = focusWorkItemId ? `${base}?item=${encodeURIComponent(focusWorkItemId)}` : base;
  return normalizeArtifactLink(url);
}
function linkForRaid(projectHumanId: string, focusPublicId?: string) {
  const base = `/projects/${projectHumanId}/raid`;
  const url = focusPublicId ? `${base}?item=${encodeURIComponent(focusPublicId)}` : base;
  return normalizeArtifactLink(url);
}
function linkForChanges(projectHumanId: string, focusChangeId?: string) {
  const base = `/projects/${projectHumanId}/change`;
  const url = focusChangeId ? `${base}?id=${encodeURIComponent(focusChangeId)}` : base;
  return normalizeArtifactLink(url);
}

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

/* ---------------- BULK org-scope due loader (FAST) ---------------- */

function attachProjectMeta(
  x: DueDigestItem,
  projectUuid: string,
  p: {
    project_code?: string | null;
    project_name?: string | null;
    project_human_id?: string | null;
    project_manager_name?: string | null;
    project_manager_email?: string | null;
    project_manager_user_id?: string | null;
  }
) {
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

async function bulkLoadProjectManagers(supabase: any, projectIds: string[]) {
  if (!projectIds.length)
    return new Map<string, { user_id: string | null; name: string | null; email: string | null }>();

  // Pull active members for these projects (limit kept high but bounded)
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("project_id,user_id,role,created_at,removed_at")
    .in("project_id", projectIds)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(50000);

  if (memErr) throw new Error(memErr.message);

  const rows = Array.isArray(mem) ? (mem as any[]) : [];
  const byProject = new Map<string, any[]>();
  for (const r of rows) {
    const pid = safeStr(r?.project_id).trim();
    if (!pid) continue;
    const arr = byProject.get(pid) ?? [];
    arr.push(r);
    byProject.set(pid, arr);
  }

  // pick PM per project: project_manager then owner
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
    const { data: profs, error: profErr } = await supabase
      .from("profiles")
      .select("user_id,full_name,email")
      .in("user_id", uniqUserIds)
      .limit(50000);

    if (profErr) throw new Error(profErr.message);

    const pr = Array.isArray(profs) ? (profs as any[]) : [];
    for (const p of pr) {
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

async function buildDueDigestOrgBulk(args: {
  supabase: any;
  projects: Array<{ id: string; title: string | null; project_code: any }>;
  windowDays: number;
}) {
  const { supabase, projects, windowDays } = args;

  const now = new Date();
  const from = startOfUtcDay(now);
  const to = endOfUtcWindow(from, windowDays);

  const projectIds = projects.map((p) => String(p.id)).filter(Boolean);

  // ✅ bulk PM lookup (no N+1)
  const pmByProjectId = await bulkLoadProjectManagers(supabase, projectIds);

  const projectById = new Map<
    string,
    {
      project_code: string | null;
      project_name: string | null;
      project_human_id: string;
      project_manager_user_id: string | null;
      project_manager_name: string | null;
      project_manager_email: string | null;
    }
  >();

  for (const p of projects) {
    const uuid = String(p.id);
    const code = safeStr((p as any).project_code).trim() || null;
    const name = safeStr((p as any).title).trim() || null;
    const human = normalizeProjectHumanId(code, uuid);

    const pm = pmByProjectId.get(uuid) || { user_id: null, name: null, email: null };

    projectById.set(uuid, {
      project_code: code,
      project_name: name,
      project_human_id: human,
      project_manager_user_id: pm.user_id,
      project_manager_name: pm.name,
      project_manager_email: pm.email,
    });
  }

  // Run the 5 “due” queries once each (bulk).
  const [artRes, msRes, wbsRes, raidRes, chRes] = await Promise.all([
    supabase
      .from("v_artifact_board")
      .select(
        "project_id,artifact_id,id,artifact_key,title,owner_email,due_date,phase,approval_status,status,updated_at,content_json"
      )
      .in("project_id", projectIds)
      .order("updated_at", { ascending: false })
      .limit(5000),
    supabase
      .from("schedule_milestones")
      .select(
        "id,project_id,milestone_name,start_date,end_date,status,progress_pct,critical_path_flag,source_artifact_id"
      )
      .in("project_id", projectIds)
      .order("end_date", { ascending: true })
      .limit(5000),
    supabase
      .from("wbs_items")
      .select(
        "id,project_id,name,description,status,due_date,owner,source_artifact_id,source_row_id,sort_order,parent_id"
      )
      .in("project_id", projectIds)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .order("sort_order", { ascending: true })
      .limit(20000),
    // RAID with resilient fallback if source_artifact_id missing
    supabase
      .from("raid_items")
      .select(
        "id,project_id,public_id,item_no,type,title,description,status,due_date,owner_label,ai_status,priority,source_artifact_id"
      )
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

  // RAID fallback if column missing
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

  const all: DueDigestItem[] = [];

  // Artifacts
  const artRows: any[] = Array.isArray(artRes.data) ? (artRes.data as any[]) : [];
  for (const x of artRows) {
    const projectUuid = safeStr(x?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const due = extractArtifactDueDate(x);
    if (!due || !inWindow(due, from, to)) continue;

    const artifactId = String(x?.artifact_id ?? x?.id ?? "").trim();
    if (!artifactId) continue;

    const title = safeStr(x?.title).trim() || safeStr(x?.artifact_key).trim() || "Artifact";

    all.push(
      attachProjectMeta(
        {
          itemType: "artifact",
          title,
          dueDate: due.toISOString(),
          ownerEmail: safeStr(x?.owner_email).trim() || null,
          status: safeStr(x?.approval_status ?? x?.status).trim() || null,
          link: linkForArtifact(p.project_human_id, artifactId),
          meta: {
            artifactId,
            sourceArtifactId: artifactId,
            artifactKey: safeStr(x?.artifact_key).trim() || null,
            phase: x?.phase ?? null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  // Milestones
  const msRows: any[] = Array.isArray(msRes.data) ? (msRes.data as any[]) : [];
  for (const m of msRows) {
    const projectUuid = safeStr(m?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const due = parseDueToUtcDate(m?.end_date ?? m?.start_date);
    if (!due || !inWindow(due, from, to)) continue;

    const id = String(m?.id ?? "").trim();
    const title = safeStr(m?.milestone_name).trim() || "Milestone";
    const srcArtifactId = safeStr(m?.source_artifact_id).trim();
    const link = srcArtifactId
      ? linkForArtifact(p.project_human_id, srcArtifactId)
      : linkForSchedule(p.project_human_id, id);

    all.push(
      attachProjectMeta(
        {
          itemType: "milestone",
          title,
          dueDate: due.toISOString(),
          status: safeStr(m?.status).trim() || null,
          link,
          meta: {
            milestoneId: id,
            critical: !!m?.critical_path_flag,
            progress: typeof m?.progress_pct === "number" ? m.progress_pct : null,
            sourceArtifactId: srcArtifactId || null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  // WBS
  const wbsRows: any[] = Array.isArray(wbsRes.data) ? (wbsRes.data as any[]) : [];
  for (const w of wbsRows) {
    const projectUuid = safeStr(w?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const st = safeLower(w?.status);
    if (st === "done" || st === "closed" || st === "completed") continue;

    const due = parseDueToUtcDate(w?.due_date);
    if (!due || !inWindow(due, from, to)) continue;

    const id = String(w?.id ?? "").trim();
    const title = safeStr(w?.name).trim() || "WBS item";

    const srcArtifactId = safeStr(w?.source_artifact_id).trim();
    const focusId = safeStr(w?.source_row_id).trim() || id;

    const link = srcArtifactId
      ? linkForArtifact(p.project_human_id, srcArtifactId)
      : linkForWbs(p.project_human_id, focusId);

    all.push(
      attachProjectMeta(
        {
          itemType: "work_item",
          title,
          dueDate: due.toISOString(),
          status: safeStr(w?.status).trim() || null,
          ownerLabel: safeStr(w?.owner).trim() || null,
          link,
          meta: {
            wbsItemId: id,
            sourceRowId: safeStr(w?.source_row_id).trim() || null,
            parentId: safeStr(w?.parent_id).trim() || null,
            sourceArtifactId: srcArtifactId || null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  // RAID
  for (const r of raidRows) {
    const projectUuid = safeStr(r?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const st = safeLower(r?.status);
    if (st === "closed" || st === "invalid") continue;

    const due = parseDueToUtcDate(r?.due_date);
    if (!due || !inWindow(due, from, to)) continue;

    const publicId = safeStr(r?.public_id).trim();
    const title =
      safeStr(r?.title).trim() ||
      safeStr(r?.description).trim().slice(0, 100) ||
      `${safeStr(r?.type).trim() || "RAID"} item`;

    all.push(
      attachProjectMeta(
        {
          itemType: "raid",
          title,
          dueDate: due.toISOString(),
          status: safeStr(r?.status).trim() || null,
          ownerLabel: safeStr(r?.owner_label).trim() || null,
          link: linkForRaid(p.project_human_id, publicId || undefined),
          meta: {
            raidId: String(r?.id ?? ""),
            publicId: publicId || null,
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

  // Changes-in-review
  const chRows: any[] = Array.isArray(chRes.data) ? (chRes.data as any[]) : [];
  const isInReview = (r: any) => {
    const delivery = safeLower(r?.delivery_status);
    const decision = safeLower(r?.decision_status);
    return delivery === "review" || decision === "submitted";
  };

  for (const c of chRows.filter(isInReview)) {
    const projectUuid = safeStr(c?.project_id).trim();
    const p = projectById.get(projectUuid);
    if (!projectUuid || !p) continue;

    const due = parseDueToUtcDate(c?.review_by) || parseDueToUtcDate(c?.updated_at);
    if (!due || !inWindow(due, from, to)) continue;

    const changeId = String(c?.id ?? "").trim();
    if (!changeId) continue;

    const title = safeStr(c?.title).trim() || "Change request (review)";
    const decision = safeLower(c?.decision_status);
    const delivery = safeLower(c?.delivery_status);

    all.push(
      attachProjectMeta(
        {
          itemType: "change",
          title,
          dueDate: due.toISOString(),
          status: safeStr(c?.decision_status ?? c?.delivery_status ?? c?.status ?? "review").trim() || "review",
          link: linkForChanges(p.project_human_id, changeId),
          meta: {
            changeId,
            seq: c?.seq ?? null,
            reviewBy: safeStr(c?.review_by).trim() || null,
            delivery_status: delivery || null,
            decision_status: decision || null,
            sourceArtifactId: safeStr(c?.artifact_id).trim() || null,
          },
        },
        projectUuid,
        p
      )
    );
  }

  const dueSoon = all
    .slice()
    .sort((a: any, b: any) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;

      const ap = safeStr(a?.meta?.project_name);
      const bp = safeStr(b?.meta?.project_name);
      if (ap !== bp) return ap.localeCompare(bp);

      const at = safeStr(a.itemType);
      const bt = safeStr(b.itemType);
      if (at !== bt) return at.localeCompare(bt);

      return safeStr(a.title).localeCompare(safeStr(b.title));
    })
    .slice(0, 250)
    .map((x: any) => ({ ...x, link: normalizeArtifactLink(x.link) || null }));

  const counts = dueSoon.reduce(
    (acc: any, x: any) => {
      acc.total++;
      acc[x.itemType] = (acc[x.itemType] ?? 0) + 1;
      return acc;
    },
    { total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0 }
  );

  return {
    summary:
      dueSoon.length > 0
        ? `Found ${dueSoon.length} due item(s) in the next ${windowDays} days across ${projects.length} project(s).`
        : `No due items found in the next ${windowDays} days.`,
    windowDays,
    counts,
    dueSoon,
    recommendedMessage:
      dueSoon.length > 0 ? "Review the due list and notify owners for items due soon." : "No reminders needed.",
  };
}

/* ---------------- project-scoped due (unchanged, still OK) ---------------- */

async function loadDueArtifacts(
  supabase: any,
  projectUuid: string,
  projectHumanId: string,
  from: Date,
  to: Date
): Promise<DueDigestItem[]> {
  let rows: any[] = [];
  try {
    const { data, error } = await supabase
      .from("v_artifact_board")
      .select("artifact_id,id,artifact_key,title,owner_email,due_date,phase,approval_status,status,updated_at,content_json")
      .eq("project_id", projectUuid)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (!error && Array.isArray(data)) rows = data;
  } catch {
    rows = [];
  }

  return rows
    .map((x) => {
      const due = extractArtifactDueDate(x);
      if (!due || !inWindow(due, from, to)) return null;

      const artifactId = String(x?.artifact_id ?? x?.id ?? "").trim();
      if (!artifactId) return null;

      const title = safeStr(x?.title).trim() || safeStr(x?.artifact_key).trim() || "Artifact";

      return {
        itemType: "artifact",
        title,
        dueDate: due.toISOString(),
        ownerEmail: safeStr(x?.owner_email).trim() || null,
        status: safeStr(x?.approval_status ?? x?.status).trim() || null,
        link: linkForArtifact(projectHumanId, artifactId),
        meta: {
          artifactId,
          sourceArtifactId: artifactId,
          artifactKey: safeStr(x?.artifact_key).trim() || null,
          phase: x?.phase ?? null,
        },
      } as DueDigestItem;
    })
    .filter(Boolean) as DueDigestItem[];
}

async function loadDueMilestones(
  supabase: any,
  projectUuid: string,
  projectHumanId: string,
  from: Date,
  to: Date
): Promise<DueDigestItem[]> {
  const { data, error } = await supabase
    .from("schedule_milestones")
    .select("id,milestone_name,start_date,end_date,status,progress_pct,critical_path_flag,source_artifact_id")
    .eq("project_id", projectUuid)
    .order("end_date", { ascending: true })
    .limit(500);

  if (error || !Array.isArray(data)) return [];

  return data
    .map((m: any) => {
      const due = parseDueToUtcDate(m?.end_date ?? m?.start_date);
      if (!due || !inWindow(due, from, to)) return null;

      const id = String(m?.id ?? "").trim();
      const title = safeStr(m?.milestone_name).trim() || "Milestone";

      const srcArtifactId = safeStr(m?.source_artifact_id).trim();
      const link = srcArtifactId ? linkForArtifact(projectHumanId, srcArtifactId) : linkForSchedule(projectHumanId, id);

      return {
        itemType: "milestone",
        title,
        dueDate: due.toISOString(),
        status: safeStr(m?.status).trim() || null,
        link,
        meta: {
          milestoneId: id,
          critical: !!m?.critical_path_flag,
          progress: typeof m?.progress_pct === "number" ? m.progress_pct : null,
          sourceArtifactId: srcArtifactId || null,
        },
      } as DueDigestItem;
    })
    .filter(Boolean) as DueDigestItem[];
}

async function loadDueWbsItems(
  supabase: any,
  projectUuid: string,
  projectHumanId: string,
  from: Date,
  to: Date
): Promise<DueDigestItem[]> {
  const { data, error } = await supabase
    .from("wbs_items")
    .select("id,name,description,status,due_date,owner,source_artifact_id,source_row_id,sort_order,parent_id")
    .eq("project_id", projectUuid)
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .order("sort_order", { ascending: true })
    .limit(1000);

  if (error || !Array.isArray(data)) return [];

  return data
    .map((w: any) => {
      const st = safeLower(w?.status);
      if (st === "done" || st === "closed" || st === "completed") return null;

      const due = parseDueToUtcDate(w?.due_date);
      if (!due || !inWindow(due, from, to)) return null;

      const id = String(w?.id ?? "").trim();
      const title = safeStr(w?.name).trim() || "WBS item";

      const srcArtifactId = safeStr(w?.source_artifact_id).trim();
      const focusId = safeStr(w?.source_row_id).trim() || id;

      const link = srcArtifactId ? linkForArtifact(projectHumanId, srcArtifactId) : linkForWbs(projectHumanId, focusId);

      return {
        itemType: "work_item",
        title,
        dueDate: due.toISOString(),
        status: safeStr(w?.status).trim() || null,
        ownerLabel: safeStr(w?.owner).trim() || null,
        link,
        meta: {
          wbsItemId: id,
          sourceRowId: safeStr(w?.source_row_id).trim() || null,
          parentId: safeStr(w?.parent_id).trim() || null,
          sourceArtifactId: srcArtifactId || null,
        },
      } as DueDigestItem;
    })
    .filter(Boolean) as DueDigestItem[];
}

async function loadDueRaidItems(
  supabase: any,
  projectUuid: string,
  projectHumanId: string,
  from: Date,
  to: Date
): Promise<DueDigestItem[]> {
  const { data, error } = await supabase
    .from("raid_items")
    .select("id,public_id,item_no,type,title,description,status,due_date,owner_label,ai_status,priority,source_artifact_id")
    .eq("project_id", projectUuid)
    .not("due_date", "is", null)
    .order("due_date", { ascending: true })
    .limit(500);

  // resilient fallback if source_artifact_id doesn't exist
  let rows = data as any[] | null;
  if (error) {
    const fallback = await supabase
      .from("raid_items")
      .select("id,public_id,item_no,type,title,description,status,due_date,owner_label,ai_status,priority")
      .eq("project_id", projectUuid)
      .not("due_date", "is", null)
      .order("due_date", { ascending: true })
      .limit(500);

    if (fallback.error || !Array.isArray(fallback.data)) return [];
    rows = fallback.data as any[];
  }
  if (!Array.isArray(rows)) return [];

  return rows
    .map((r: any) => {
      const st = safeLower(r?.status);
      if (st === "closed" || st === "invalid") return null;

      const due = parseDueToUtcDate(r?.due_date);
      if (!due || !inWindow(due, from, to)) return null;

      const publicId = safeStr(r?.public_id).trim();
      const title =
        safeStr(r?.title).trim() ||
        safeStr(r?.description).trim().slice(0, 100) ||
        `${safeStr(r?.type).trim() || "RAID"} item`;

      return {
        itemType: "raid",
        title,
        dueDate: due.toISOString(),
        status: safeStr(r?.status).trim() || null,
        ownerLabel: safeStr(r?.owner_label).trim() || null,
        link: linkForRaid(projectHumanId, publicId || undefined),
        meta: {
          raidId: String(r?.id ?? ""),
          publicId: publicId || null,
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

async function loadChangesInReview(
  supabase: any,
  projectUuid: string,
  projectHumanId: string,
  from: Date,
  to: Date
): Promise<DueDigestItem[]> {
  const { data, error } = await supabase
    .from("change_requests")
    .select("id,title,seq,status,delivery_status,decision_status,updated_at,artifact_id,review_by")
    .eq("project_id", projectUuid)
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !Array.isArray(data)) return [];

  const isInReview = (r: any) => {
    const delivery = safeLower(r?.delivery_status);
    const decision = safeLower(r?.decision_status);
    return delivery === "review" || decision === "submitted";
  };

  return (data as any[])
    .filter(isInReview)
    .map((c: any) => {
      const due = parseDueToUtcDate(c?.review_by) || parseDueToUtcDate(c?.updated_at);
      if (!due || !inWindow(due, from, to)) return null;

      const changeId = String(c?.id ?? "").trim();
      if (!changeId) return null;

      const title = safeStr(c?.title).trim() || "Change request (review)";

      const decision = safeLower(c?.decision_status);
      const delivery = safeLower(c?.delivery_status);

      return {
        itemType: "change",
        title,
        dueDate: due.toISOString(),
        status: safeStr(c?.decision_status ?? c?.delivery_status ?? c?.status ?? "review").trim() || "review",
        link: linkForChanges(projectHumanId, changeId),
        meta: {
          changeId,
          seq: c?.seq ?? null,
          reviewBy: safeStr(c?.review_by).trim() || null,
          delivery_status: delivery || null,
          decision_status: decision || null,
          sourceArtifactId: safeStr(c?.artifact_id).trim() || null,
        },
      } as DueDigestItem;
    })
    .filter(Boolean) as DueDigestItem[];
}

async function buildDueDigestAi(supabase: any, projectUuid: string, projectHumanId: string, windowDays: number) {
  const now = new Date();
  const from = startOfUtcDay(now);
  const to = endOfUtcWindow(from, windowDays);

  const [artifacts, milestones, wbsItems, raidItems, changesInReview] = await Promise.all([
    loadDueArtifacts(supabase, projectUuid, projectHumanId, from, to),
    loadDueMilestones(supabase, projectUuid, projectHumanId, from, to),
    loadDueWbsItems(supabase, projectUuid, projectHumanId, from, to),
    loadDueRaidItems(supabase, projectUuid, projectHumanId, from, to),
    loadChangesInReview(supabase, projectUuid, projectHumanId, from, to),
  ]);

  const all: DueDigestItem[] = [...milestones, ...wbsItems, ...raidItems, ...artifacts, ...changesInReview];

  const dueSoon = all
    .slice()
    .sort((a, b) => {
      const ad = a.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const bd = b.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (ad !== bd) return ad - bd;

      const at = safeStr(a.itemType);
      const bt = safeStr(b.itemType);
      if (at !== bt) return at.localeCompare(bt);

      return safeStr(a.title).localeCompare(safeStr(b.title));
    })
    .slice(0, 250)
    .map((x) => ({
      ...x,
      link: normalizeArtifactLink(x.link) || null,
    }));

  const summary =
    dueSoon.length > 0
      ? `Found ${dueSoon.length} due item(s) in the next ${windowDays} days.`
      : `No due items found in the next ${windowDays} days.`;

  const counts = dueSoon.reduce(
    (acc, x) => {
      acc.total++;
      (acc as any)[x.itemType] = ((acc as any)[x.itemType] ?? 0) + 1;
      return acc;
    },
    { total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0 } as any
  );

  return {
    summary,
    windowDays,
    counts,
    dueSoon,
    recommendedMessage:
      dueSoon.length > 0 ? "Review the due list and notify owners for items due soon." : "No reminders needed.",
  };
}

/* ---------------- dashboard summary (global, org-scoped) ---------------- */

async function buildDashboardStatsGlobal(supabase: any, userId: string) {
  const orgIds = await loadMyOrgIds(supabase, userId);
  if (!orgIds.length) {
    return {
      projects: 0,
      success: {
        work_packages_completed: 0,
        milestones_done: 0,
        raid_closed: 0,
        changes_closed: 0,
        wbs_done: 0,
        lessons: 0,
      },
      milestones_due_30d: 0,
    };
  }

  // ✅ active-only projects via projects_active view
  const projects = await loadProjectsForOrgs(supabase, orgIds);
  const projectIds = projects.map((p: any) => p.id).filter(Boolean);

  if (!projectIds.length) {
    return {
      projects: 0,
      success: {
        work_packages_completed: 0,
        milestones_done: 0,
        raid_closed: 0,
        changes_closed: 0,
        wbs_done: 0,
        lessons: 0,
      },
      milestones_due_30d: 0,
    };
  }

  // Milestones due in next 30 days (end_date within window; not completed)
  const from = startOfUtcDay(new Date());
  const to = endOfUtcWindow(from, 30);

  const { data: ms, error: msErr } = await supabase
    .from("schedule_milestones")
    .select("id,project_id,end_date,start_date,status")
    .in("project_id", projectIds)
    .limit(5000);

  const milestones_due_30d =
    !msErr && Array.isArray(ms)
      ? ms.filter((m: any) => {
          const st = safeLower(m?.status);
          if (st === "done" || st === "completed" || st === "closed") return false;
          const d = parseDueToUtcDate(m?.end_date ?? m?.start_date);
          return !!(d && inWindow(d, from, to));
        }).length
      : 0;

  // WBS done count (items with status done/closed/completed)
  const { data: wbs, error: wbsErr } = await supabase
    .from("wbs_items")
    .select("id,status,project_id")
    .in("project_id", projectIds)
    .limit(20000);

  const wbs_done =
    !wbsErr && Array.isArray(wbs)
      ? wbs.filter((x: any) => {
          const st = safeLower(x?.status);
          return st === "done" || st === "completed" || st === "closed";
        }).length
      : 0;

  // Lessons count (current lessons artifacts)
  const { data: lessons, error: lessonsErr } = await supabase
    .from("artifacts")
    .select("id,type,artifact_type,is_current,deleted_at,project_id")
    .in("project_id", projectIds)
    .is("deleted_at", null)
    .limit(5000);

  const lessons_count =
    !lessonsErr && Array.isArray(lessons)
      ? lessons.filter((a: any) => {
          const t = safeLower(a?.artifact_type || a?.type);
          return t === "lessons_learned" && (a?.is_current === true || a?.is_current == null);
        }).length
      : 0;

  // RAID closed count
  const { data: raid, error: raidErr } = await supabase
    .from("raid_items")
    .select("id,status,project_id")
    .in("project_id", projectIds)
    .limit(20000);

  const raid_closed =
    !raidErr && Array.isArray(raid) ? raid.filter((r: any) => safeLower(r?.status) === "closed").length : 0;

  // Changes closed/implemented
  const { data: changes, error: chErr } = await supabase
    .from("change_requests")
    .select("id,status,delivery_status,decision_status,project_id")
    .in("project_id", projectIds)
    .limit(20000);

  const changes_closed =
    !chErr && Array.isArray(changes)
      ? changes.filter((c: any) => {
          const s = safeLower(c?.status);
          const d = safeLower(c?.delivery_status);
          return s === "closed" || s === "implemented" || d === "closed" || d === "implemented";
        }).length
      : 0;

  // Milestones done
  const milestones_done =
    !msErr && Array.isArray(ms)
      ? ms.filter((m: any) => {
          const st = safeLower(m?.status);
          return st === "done" || st === "completed" || st === "closed";
        }).length
      : 0;

  return {
    projects: projectIds.length, // ✅ active-only count
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

/* ---------------- delivery_report (weekly report generator) ---------------- */

type DeliveryReportV1 = {
  version: 1;
  period: { from: string; to: string }; // ISO YYYY-MM-DD
  sections: {
    executive_summary: { rag: "green" | "amber" | "red"; headline: string; narrative: string };
    completed_this_period: Array<{ text: string }>;
    next_period_focus: Array<{ text: string }>;
    resource_summary: Array<{ text: string }>;
    key_decisions_taken: Array<{ text: string; link?: string | null }>;
    operational_blockers: Array<{ text: string; link?: string | null }>;
  };
  lists?: {
    milestones?: Array<{ name: string; due: string | null; status: string | null; critical?: boolean }>;
    changes?: Array<{ title: string; status: string | null; link?: string | null }>;
    raid?: Array<{
      title: string;
      type?: string | null;
      status?: string | null;
      due?: string | null;
      owner?: string | null;
    }>;
  };
  metrics?: { milestonesDone?: number; wbsDone?: number; changesClosed?: number; raidClosed?: number };
  meta?: { generated_at?: string; sources?: any };
};

function ymd(s: string) {
  // keep ISO for machine fields
  return safeStr(s).trim();
}

function dateFromYmdOrIso(s: string): Date | null {
  const v = safeStr(s).trim();
  if (!v) return null;
  // YYYY-MM-DD
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const yyyy = clampInt(m[1], 1900, 3000, 2000);
    const mm = clampInt(m[2], 1, 12, 1);
    const dd = clampInt(m[3], 1, 31, 1);
    return new Date(Date.UTC(yyyy, mm - 1, dd, 0, 0, 0));
  }
  const d = new Date(v);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function uniq<T>(xs: T[]) {
  return Array.from(new Set(xs));
}

/**
 * Best-effort "dimensions" (safe probing):
 * We DO NOT assume columns exist; we attempt common names and ignore missing-column errors.
 */
async function loadProjectDimensionsSafe(supabase: any, projectUuid: string) {
  const dimensionCols = [
    "client_name",
    "client",
    "account_name",
    "programme_name",
    "portfolio",
    "service_line",
    "business_unit",
    "region",
    "country",
    "sector",
    "contract_ref",
    "contract_reference",
    "project_type",
  ] as const;

  // attempt a single select with many cols; if missing, progressively remove (cheap + safe)
  let cols = ["id", "title", "project_code", "organisation_id", ...dimensionCols] as string[];

  while (cols.length >= 4) {
    const { data, error } = await supabase.from("projects").select(cols.join(",")).eq("id", projectUuid).maybeSingle();
    if (!error) {
      const out: any = {};
      for (const k of cols) {
        if (k === "id") continue;
        const v = (data as any)?.[k];
        if (v == null) continue;
        const s = typeof v === "string" ? v.trim() : v;
        if (typeof s === "string" && !s) continue;
        out[k] = s;
      }
      return out;
    }
    // if any missing column error, drop that column and retry
    const msg = safeStr(error?.message).toLowerCase();
    const missing = cols.find((c) => isMissingColumnError(msg, c));
    if (!missing) break;
    cols = cols.filter((c) => c !== missing);
  }

  // fallback: minimal
  return {};
}

async function loadPreviousDeliveryReportSummarySafe(supabase: any, artifactId: string) {
  const id = safeStr(artifactId).trim();
  if (!looksLikeUuid(id)) return null;

  // try artifacts.content_json first (your platform uses content_json heavily)
  const { data, error } = await supabase
    .from("artifacts")
    .select("id,type,artifact_type,title,content_json,updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) return null;

  const cj = safeJson((data as any)?.content_json);
  if (!cj) return null;

  const prevRag =
    cj?.sections?.executive_summary?.rag ||
    cj?.report?.sections?.executive_summary?.rag ||
    cj?.executive_summary?.rag ||
    null;

  const prevHeadline =
    cj?.sections?.executive_summary?.headline ||
    cj?.report?.sections?.executive_summary?.headline ||
    cj?.executive_summary?.headline ||
    null;

  const prevPeriodFrom = cj?.period?.from || cj?.report?.period?.from || null;
  const prevPeriodTo = cj?.period?.to || cj?.report?.period?.to || null;

  return {
    artifact_id: id,
    updated_at: (data as any)?.updated_at ?? null,
    title: safeStr((data as any)?.title).trim() || null,
    prevRag: prevRag ? String(prevRag) : null,
    prevHeadline: prevHeadline ? String(prevHeadline) : null,
    prevPeriod: prevPeriodFrom || prevPeriodTo ? { from: prevPeriodFrom || null, to: prevPeriodTo || null } : null,
  };
}

async function buildDeliveryReportV1(args: {
  supabase: any;
  projectUuid: string;
  projectHumanId: string;
  periodFrom: string;
  periodTo: string;
  windowDays: number;
}) {
  const { supabase, projectUuid, projectHumanId, periodFrom, periodTo, windowDays } = args;

  const fromD = dateFromYmdOrIso(periodFrom) || startOfUtcDay(new Date(Date.now() - 6 * 86400_000));
  const toD = dateFromYmdOrIso(periodTo) || startOfUtcDay(new Date());

  // inclusive-ish end: add 1 day - 1ms
  const toEnd = new Date(toD.getTime() + 86400_000 - 1);

  // UK display strings
  const fromUk = fmtUkDateFromDate(fromD);
  const toUk = fmtUkDateFromDate(toD);

  // 3 Next Period Focus = due-soon digest
  const dueDigest = await buildDueDigestAi(supabase, projectUuid, projectHumanId, windowDays);
  const dueSoon = Array.isArray(dueDigest?.dueSoon) ? dueDigest.dueSoon : [];

  // Pull core sets for period
  const [msRes, raidRes, chRes] = await Promise.all([
    supabase
      .from("schedule_milestones")
      .select("id,milestone_name,start_date,end_date,status,critical_path_flag,progress_pct,source_artifact_id")
      .eq("project_id", projectUuid)
      .limit(5000),
    supabase
      .from("raid_items")
      .select(
        "id,public_id,type,title,description,status,due_date,owner_label,priority,ai_status,source_artifact_id,updated_at"
      )
      .eq("project_id", projectUuid)
      .limit(20000),
    supabase
      .from("change_requests")
      .select("id,title,status,delivery_status,decision_status,updated_at,review_by,seq,artifact_id")
      .eq("project_id", projectUuid)
      .order("updated_at", { ascending: false })
      .limit(20000),
  ]);

  // WBS: attempt to include updated_at; fallback if missing
  let wbsRows: any[] = [];
  const wbsTry = await supabase
    .from("wbs_items")
    .select("id,name,status,owner,due_date,updated_at,source_artifact_id,source_row_id")
    .eq("project_id", projectUuid)
    .limit(20000);

  if (!wbsTry.error && Array.isArray(wbsTry.data)) {
    wbsRows = wbsTry.data as any[];
  } else if (wbsTry.error && isMissingColumnError(wbsTry.error.message, "updated_at")) {
    const wbsFb = await supabase
      .from("wbs_items")
      .select("id,name,status,owner,due_date,source_artifact_id,source_row_id")
      .eq("project_id", projectUuid)
      .limit(20000);
    wbsRows = Array.isArray(wbsFb.data) ? (wbsFb.data as any[]) : [];
  }

  const msRows: any[] = Array.isArray(msRes.data) ? (msRes.data as any[]) : [];
  const raidRows: any[] = Array.isArray(raidRes.data) ? (raidRes.data as any[]) : [];
  const chRows: any[] = Array.isArray(chRes.data) ? (chRes.data as any[]) : [];

  // milestone map + raw list (requested for meta enrichment)
  const schedule_milestones_raw = msRows.slice(0, 5000);
  const milestone_map: Record<
    string,
    { id: string; name: string; due: string | null; status: string | null; critical: boolean; progress: number | null }
  > = {};
  for (const m of schedule_milestones_raw) {
    const id = safeStr(m?.id).trim();
    if (!id) continue;
    milestone_map[id] = {
      id,
      name: safeStr(m?.milestone_name).trim() || "Milestone",
      due: safeStr(m?.end_date ?? m?.start_date).trim() || null,
      status: safeStr(m?.status).trim() || null,
      critical: !!m?.critical_path_flag,
      progress: typeof m?.progress_pct === "number" ? m.progress_pct : null,
    };
  }

  // Helpers for period filtering
  const withinPeriod = (d: any) => {
    const dd = parseDueToUtcDate(d);
    if (!dd) return false;
    return dd.getTime() >= fromD.getTime() && dd.getTime() <= toEnd.getTime();
  };
  const withinUpdated = (d: any) => {
    const dd = parseDueToUtcDate(d);
    if (!dd) return false;
    return dd.getTime() >= fromD.getTime() && dd.getTime() <= toEnd.getTime();
  };

  // Completed in period
  const msDone = msRows.filter((m) => {
    const st = safeLower(m?.status);
    const done = st === "done" || st === "completed" || st === "closed";
    if (!done) return false;
    return withinPeriod(m?.end_date ?? m?.start_date);
  });

  const wbsDone = wbsRows.filter((w) => {
    const st = safeLower(w?.status);
    const done = st === "done" || st === "completed" || st === "closed";
    if (!done) return false;
    // prefer updated_at if present, else fall back to due_date window (best-effort)
    if (w?.updated_at) return withinUpdated(w.updated_at);
    return withinPeriod(w?.due_date);
  });

  const raidClosed = raidRows.filter((r) => {
    const st = safeLower(r?.status);
    if (st !== "closed") return false;
    // prefer updated_at, else due_date
    if (r?.updated_at) return withinUpdated(r.updated_at);
    return withinPeriod(r?.due_date);
  });

  const changesClosed = chRows.filter((c) => {
    const st = safeLower(c?.status);
    const del = safeLower(c?.delivery_status);
    const closed = st === "closed" || st === "implemented" || del === "closed" || del === "implemented";
    if (!closed) return false;
    return withinUpdated(c?.updated_at);
  });

  // Key Decisions Taken: approved/rejected during period
  const decisions = chRows
    .filter((c) => {
      const dec = safeLower(c?.decision_status);
      if (dec !== "approved" && dec !== "rejected") return false;
      return withinUpdated(c?.updated_at);
    })
    .slice(0, 30)
    .map((c) => {
      const title = safeStr(c?.title).trim() || "Change decision";
      const dec = safeLower(c?.decision_status);
      const seq = c?.seq != null ? `#${c.seq}` : "";
      const text = `${dec === "approved" ? "Approved" : "Rejected"} change ${seq}: ${title}`.trim();
      return {
        text,
        link: linkForChanges(projectHumanId, String(c?.id ?? "").trim()),
      };
    });

  // Operational Blockers: open issues/risks high priority or overdue/due soon
  const blockers = raidRows
    .filter((r) => {
      const st = safeLower(r?.status);
      if (st === "closed" || st === "invalid") return false;

      const type = safeLower(r?.type);
      const isIssueLike = type === "issue" || type === "dependency" || type === "risk";
      if (!isIssueLike) return false;

      const pr = safeLower(r?.priority);
      const hi = pr === "high" || pr === "p1" || pr === "critical";
      const due = parseDueToUtcDate(r?.due_date);
      const dueSoonish = due ? due.getTime() <= endOfUtcWindow(startOfUtcDay(new Date()), 14).getTime() : false;

      return hi || dueSoonish;
    })
    .slice(0, 25)
    .map((r) => {
      const t = safeStr(r?.title).trim() || safeStr(r?.description).trim().slice(0, 80) || "RAID item";
      const type = safeStr(r?.type).trim() || "RAID";
      const pr = safeStr(r?.priority).trim();
      const dueUk = r?.due_date ? fmtUkDateFromAny(r.due_date) : "";
      const bits = [
        `${type}: ${t}`,
        pr ? `Priority: ${pr}` : "",
        dueUk ? `Due: ${dueUk}` : "",
        safeStr(r?.owner_label).trim() ? `Owner: ${safeStr(r?.owner_label).trim()}` : "",
      ].filter(Boolean);
      const publicId = safeStr(r?.public_id).trim();
      return {
        text: bits.join(" — "),
        link: linkForRaid(projectHumanId, publicId || undefined),
      };
    });

  // Resource summary (best-effort from WBS owners on open items due soon)
  const openDueWork = dueSoon.filter((x: any) => x?.itemType === "work_item");
  const owners = openDueWork.map((x: any) => safeStr(x?.ownerLabel).trim()).filter(Boolean);
  const ownerList = uniq(owners).slice(0, 12);
  const resourceSummary: Array<{ text: string }> = [];

  if (openDueWork.length > 0) {
    resourceSummary.push({ text: `Open WBS items due soon: ${openDueWork.length}` });
  }
  if (ownerList.length > 0) {
    resourceSummary.push({ text: `Owners with due-soon items: ${ownerList.join(", ")}` });
  }
  if (resourceSummary.length === 0) {
    resourceSummary.push({ text: "No resource hotspots detected from due-soon workload." });
  }

  // Completed this period (top bullets)
  const completed: Array<{ text: string }> = [];

  for (const m of msDone.slice(0, 12)) {
    const name = safeStr(m?.milestone_name).trim() || "Milestone";
    completed.push({ text: `Milestone completed: ${name}` });
  }
  for (const w of wbsDone.slice(0, 12)) {
    const name = safeStr(w?.name).trim() || "WBS item";
    completed.push({ text: `Work item completed: ${name}` });
  }
  for (const c of changesClosed.slice(0, 8)) {
    const name = safeStr(c?.title).trim() || "Change request";
    completed.push({ text: `Change closed/implemented: ${name}` });
  }
  for (const r of raidClosed.slice(0, 8)) {
    const name = safeStr(r?.title).trim() || "RAID item";
    completed.push({ text: `RAID closed: ${name}` });
  }
  if (completed.length === 0) completed.push({ text: "No completed items detected for the selected period." });

  // Next period focus = dueSoon titles (UK due date in text)
  const nextFocus: Array<{ text: string }> = dueSoon
    .slice(0, 12)
    .map((x: any) => {
      const t = safeStr(x?.title).trim() || "Due item";
      const kind = safeStr(x?.itemType).replace("_", " ");
      const dueUk = x?.dueDate ? fmtUkDateFromAny(x.dueDate) : "";
      return { text: `${kind}: ${t}${dueUk ? ` (due ${dueUk})` : ""}` };
    });

  if (nextFocus.length === 0) nextFocus.push({ text: "No due-soon items detected for next period focus." });

  // RAG heuristic
  const overdue = dueSoon.filter((x: any) => {
    const d = parseDueToUtcDate(x?.dueDate);
    if (!d) return false;
    return d.getTime() < startOfUtcDay(new Date()).getTime();
  });
  const criticalSoon = dueSoon.filter((x: any) => x?.itemType === "milestone" && x?.meta?.critical);

  const rag: "green" | "amber" | "red" =
    overdue.length > 0 ? "red" : criticalSoon.length > 0 || blockers.length > 0 ? "amber" : "green";

  const headline =
    rag === "green"
      ? "Delivery on track this period"
      : rag === "amber"
        ? "Delivery requires attention (blockers / critical items)"
        : "Delivery at risk (overdue items detected)";

  const narrative = mergeBits([
    `Period covered: ${fromUk} → ${toUk}.`,
    `Completed: ${msDone.length} milestone(s), ${wbsDone.length} work item(s), ${changesClosed.length} change(s), ${raidClosed.length} RAID item(s).`,
    overdue.length ? `Overdue items: ${overdue.length} (review immediately).` : "",
    blockers.length ? `Operational blockers identified: ${blockers.length}.` : "",
    `Next period focus items (due soon): ${dueSoon.length}.`,
  ]);

  // Detail lists for optional UI usage (keep original values as-is)
  const milestonesList = msRows.slice(0, 50).map((m) => ({
    name: safeStr(m?.milestone_name).trim() || "Milestone",
    due: safeStr(m?.end_date ?? m?.start_date).trim() || null,
    status: safeStr(m?.status).trim() || null,
    critical: !!m?.critical_path_flag,
  }));

  const changesList = chRows.slice(0, 50).map((c) => ({
    title: safeStr(c?.title).trim() || "Change request",
    status: safeStr(c?.decision_status ?? c?.delivery_status ?? c?.status).trim() || null,
    link: linkForChanges(projectHumanId, String(c?.id ?? "").trim()),
  }));

  const raidList = raidRows.slice(0, 50).map((r) => ({
    title:
      safeStr(r?.title).trim() ||
      safeStr(r?.description).trim().slice(0, 100) ||
      `${safeStr(r?.type).trim() || "RAID"} item`,
    type: safeStr(r?.type).trim() || null,
    status: safeStr(r?.status).trim() || null,
    due: safeStr(r?.due_date).trim() || null,
    owner: safeStr(r?.owner_label).trim() || null,
  }));

  const report: DeliveryReportV1 = {
    version: 1,
    period: { from: ymd(periodFrom), to: ymd(periodTo) },
    sections: {
      executive_summary: { rag, headline, narrative },
      completed_this_period: completed,
      next_period_focus: nextFocus,
      resource_summary: resourceSummary,
      key_decisions_taken: decisions.length ? decisions : [{ text: "No key decisions detected in this period." }],
      operational_blockers: blockers.length ? blockers : [{ text: "No operational blockers detected." }],
    },
    lists: {
      milestones: milestonesList,
      changes: changesList,
      raid: raidList,
    },
    metrics: {
      milestonesDone: msDone.length,
      wbsDone: wbsDone.length,
      changesClosed: changesClosed.length,
      raidClosed: raidClosed.length,
    },
    meta: {
      generated_at: new Date().toISOString(),
      sources: {
        dueDigest: { windowDays, counts: dueDigest?.counts ?? null },
        periodRangeUtc: { from: fromD.toISOString(), to: toEnd.toISOString() },
        periodRangeUk: { from: fromUk, to: toUk },
      },
    },
  };

  return {
    report,
    metaExtras: {
      schedule_milestones_raw,
      milestone_map,
    },
  };
}

/* ---------------- handler ---------------- */

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({} as any));

    const eventType = safeStr(body?.eventType).trim();
    const payload = (body && typeof body === "object" ? (body as any).payload : null) || null;

    // accept either project_id/projectId/project_human_id at top-level or inside payload
    const rawProject =
      safeStr(body?.project_id).trim() ||
      safeStr(body?.projectId).trim() ||
      safeStr(body?.project_human_id).trim() ||
      safeStr(body?.payload?.project_id).trim() ||
      safeStr(body?.payload?.projectId).trim() ||
      safeStr(body?.payload?.project_human_id).trim();

    /* ===========================
       Global dashboard: no project
       =========================== */

    // ✅ If the dashboard calls artifact_due without a project, return org-scoped aggregate.
    if (eventType === "artifact_due" && !rawProject) {
      const windowDays = clampInt(body?.windowDays ?? payload?.windowDays, 1, 90, 14);

      const orgIds = await loadMyOrgIds(supabase, user.id);
      const projects = await loadProjectsForOrgs(supabase, orgIds); // ✅ active-only via view

      if (!projects.length) {
        return jsonNoStore({
          ok: true,
          eventType,
          scope: "org",
          model: "artifact-due-rules-v5-bulk",
          ai: {
            summary: "No projects available for this user.",
            windowDays,
            counts: { total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0 },
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

      const ai = await buildDueDigestOrgBulk({ supabase, projects, windowDays });
      const stats = await buildDashboardStatsGlobal(supabase, user.id);

      return jsonNoStore({
        ok: true,
        eventType,
        scope: "org",
        model: "artifact-due-rules-v5-bulk",
        ai,
        stats,
      });
    }

    /* ===========================
       Project-scoped (requires project)
       =========================== */

    if (!rawProject) {
      return jsonNoStore(
        { ok: false, error: "Missing project id (project_id / projectId / project_human_id)" },
        { status: 400 }
      );
    }

    const projectUuid = await resolveProjectUuid(supabase, rawProject);
    if (!projectUuid) {
      return jsonNoStore({ ok: false, error: "Project not found", meta: { rawProject } }, { status: 404 });
    }

    // ✅ org-membership check (replaces legacy project_members)
    await requireProjectAccessViaOrg(supabase, projectUuid, user.id);

    const meta = await loadProjectMeta(supabase, projectUuid);

    // ✅ human id MUST be project_code (fallback only if missing)
    const projectHumanId = normalizeProjectHumanId(meta.project_human_id, rawProject);

    const draftId = safeStr((payload as any)?.draftId).trim() || safeStr(body?.draftId).trim() || "";

    /* ---------- ai_suggestions_generate (creates rows in ai_suggestions) ---------- */
    if (eventType === "ai_suggestions_generate") {
      const p = payload && typeof payload === "object" ? payload : {};

      const artifactId =
        safeStr((p as any)?.artifactId).trim() ||
        safeStr((p as any)?.artifact_id).trim() ||
        safeStr((body as any)?.artifactId).trim() ||
        safeStr((body as any)?.artifact_id).trim();

      if (!artifactId || !looksLikeUuid(artifactId)) {
        return jsonNoStore({ ok: false, error: "artifactId is required (uuid)" }, { status: 400 });
      }

      // Use admin client if available (recommended), but keep auth/membership gates above.
      const supabaseAdmin = adminClientOrNull() ?? supabase;

      // Load artifact content (admin)
      const { data: art, error: artErr } = await supabaseAdmin
        .from("artifacts")
        .select("id, project_id, type, artifact_type, content_json")
        .eq("id", artifactId)
        .eq("project_id", projectUuid)
        .maybeSingle();

      if (artErr) return jsonNoStore({ ok: false, error: artErr.message }, { status: 500 });
      if (!art) return jsonNoStore({ ok: false, error: "Artifact not found" }, { status: 404 });

      const aType = safeLower((art as any)?.artifact_type ?? (art as any)?.type);
      const cj = (art as any)?.content_json ?? {};

      // For now: only generate Charter suggestions (fast rules). Extend later for RAID/WBS/Change/etc.
      if (aType !== "project_charter" && aType !== "charter" && !aType.includes("charter")) {
        return jsonNoStore({
          ok: true,
          eventType,
          scope: "project",
          project_id: projectUuid,
          artifact_id: artifactId,
          generated: 0,
          suggestions: [],
          message: `No generator for artifact type "${aType}" yet.`,
        });
      }

      const suggestions = buildCharterRuleSuggestions({
        projectUuid,
        artifactId,
        projectName: meta.project_name,
        pmName: meta.project_manager_name,
        contentJson: cj,
        actorUserId: user.id,
      });

      // Insert deduped
      let inserted: any[] = [];
      try {
        inserted = await insertSuggestionsDeduped({ supabaseAdmin, suggestions });
      } catch (e: any) {
        // if RLS blocks (because no service role), still return computed suggestions so UI can show something
        return jsonNoStore({
          ok: true,
          eventType,
          scope: "project",
          project_id: projectUuid,
          artifact_id: artifactId,
          generated: suggestions.length,
          inserted: 0,
          suggestionsComputed: suggestions,
          warning: `Could not insert suggestions (check SUPABASE_SERVICE_ROLE_KEY / RLS): ${String(
            e?.message ?? e
          )}`,
        });
      }

      return jsonNoStore({
        ok: true,
        eventType,
        scope: "project",
        project_id: projectUuid,
        project_human_id: meta.project_human_id,
        project_code: meta.project_code,
        project_name: meta.project_name,
        artifact_id: artifactId,
        model: "suggestions-rules-v1",
        generated: suggestions.length,
        inserted: inserted.length,
        suggestions: inserted,
      });
    }

    /* ---------- delivery_report (weekly report) ---------- */
    if (eventType === "delivery_report") {
      const p = payload && typeof payload === "object" ? payload : {};

      // matches your payload:
      // payload: { artifactId, period:{from,to}, ... }
      const artifactId =
        safeStr((p as any)?.artifactId).trim() ||
        safeStr((p as any)?.artifact_id).trim() ||
        safeStr((body as any)?.artifactId).trim() ||
        safeStr((body as any)?.artifact_id).trim();

      const periodFrom =
        safeStr((p as any)?.period?.from).trim() ||
        safeStr((body as any)?.period?.from).trim() ||
        safeStr((p as any)?.from).trim();

      const periodTo =
        safeStr((p as any)?.period?.to).trim() ||
        safeStr((body as any)?.period?.to).trim() ||
        safeStr((p as any)?.to).trim();

      const windowDays = clampInt((p as any)?.windowDays ?? (body as any)?.windowDays, 1, 90, 7);

      // ✅ meta enrichment (requested):
      // - previous rag (from the report artifact, if provided)
      // - milestone map
      // - dimensions
      // - schedule milestones (raw)
      const [prevSummary, dimensions] = await Promise.all([
        artifactId ? loadPreviousDeliveryReportSummarySafe(supabase, artifactId) : Promise.resolve(null),
        loadProjectDimensionsSafe(supabase, projectUuid),
      ]);

      const { report: reportBase, metaExtras } = await buildDeliveryReportV1({
        supabase,
        projectUuid,
        projectHumanId,
        periodFrom,
        periodTo,
        windowDays,
      });

      // ✅ Canonical project meta inside the report (so it persists in saved JSON + exports)
      const report: any = {
        ...reportBase,
        project: {
          id: projectUuid,
          code: meta.project_code ?? null,
          name: meta.project_name ?? null,
          managerName: meta.project_manager_name ?? null,
          managerEmail: meta.project_manager_email ?? null,
        },
        meta: {
          ...(reportBase?.meta ?? {}),
          // enrich meta (requested)
          previous: prevSummary
            ? {
                rag: prevSummary.prevRag,
                headline: prevSummary.prevHeadline,
                period: prevSummary.prevPeriod,
                updated_at: prevSummary.updated_at,
                artifact_id: prevSummary.artifact_id,
              }
            : null,
          milestone_map: metaExtras?.milestone_map ?? {},
          dimensions: dimensions ?? {},
          schedule_milestones: metaExtras?.schedule_milestones_raw ?? [],
          sources: {
            ...((reportBase as any)?.meta?.sources ?? {}),
            project: {
              id: projectUuid,
              code: meta.project_code ?? null,
              name: meta.project_name ?? null,
              pm: {
                user_id: meta.project_manager_user_id ?? null,
                name: meta.project_manager_name ?? null,
                email: meta.project_manager_email ?? null,
              },
            },
          },
        },
      };

      // ✅ keys your editor already supports
      // - report
      // - content_json (canonical save payload for artifact update)
      const content_json = report;

      return jsonNoStore({
        ok: true,
        eventType,
        scope: "project",
        project_id: projectUuid,
        project_human_id: meta.project_human_id,
        project_code: meta.project_code,
        project_name: meta.project_name,
        project_manager_name: meta.project_manager_name,
        project_manager_email: meta.project_manager_email,
        project_manager_user_id: meta.project_manager_user_id,
        model: "delivery-report-v1",
        report,
        content_json,
      });
    }

    /* ---------- artifact_due ---------- */
    if (eventType === "artifact_due") {
      const windowDays = clampInt((body as any)?.windowDays ?? (payload as any)?.windowDays, 1, 90, 14);

      const ai = await buildDueDigestAi(supabase, projectUuid, projectHumanId, windowDays);

      return jsonNoStore({
        ok: true,
        eventType,
        scope: "project",
        project_id: projectUuid, // UUID
        project_human_id: meta.project_human_id, // project_code (preferred)
        project_code: meta.project_code,
        project_name: meta.project_name,
        project_manager_name: meta.project_manager_name,
        project_manager_email: meta.project_manager_email,
        project_manager_user_id: meta.project_manager_user_id,
        model: "artifact-due-rules-v4",
        ai,
      });
    }

    /* ---------- change draft assist (and any other event types) ---------- */
    const draft =
      payload && typeof payload === "object" ? payload : body && typeof body === "object" ? body : ({} as any);

    return jsonNoStore({
      ok: true,
      eventType: eventType || "change_draft_assist_requested",
      model: "draft-rules-v1",
      draftId,
      project_id: projectUuid,
      project_human_id: meta.project_human_id, // project_code
      project_code: meta.project_code,
      project_name: meta.project_name,
      project_manager_name: meta.project_manager_name,
      project_manager_email: meta.project_manager_email,
      project_manager_user_id: meta.project_manager_user_id,
      ai: buildDraftAssistAi(draft),
    });
  } catch (e: any) {
    return jsonNoStore(
      {
        ok: false,
        error: e?.message ?? "Unknown error",
        meta: {
          code: e?.code ?? null,
          details: e?.details ?? null,
          hint: e?.hint ?? null,
        },
      },
      { status: 500 }
    );
  }
}
