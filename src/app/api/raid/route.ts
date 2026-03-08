// src/app/api/raid/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- response helpers ---------------- */

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonOk(data: any, status = 200, headers?: HeadersInit) {
  return withNoStore(NextResponse.json({ ok: true, ...data }, { status, headers }));
}

function jsonErr(error: string, status = 400, meta?: any) {
  return withNoStore(NextResponse.json({ ok: false, error, meta }, { status }));
}

/* ---------------- utils ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isIsoDateOnly(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function clampInt0to100(v: any): number | null {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function titleCaseLikeDbEnum(s: string) {
  return s.trim();
}

function bestProjectRole(rows: Array<{ role?: string | null }> | null | undefined) {
  const roles = (rows ?? [])
    .map((r) => String(r?.role ?? "").toLowerCase().trim())
    .filter(Boolean);

  if (!roles.length) return "";
  if (roles.includes("owner")) return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return roles[0] || "";
}

function canWrite(projectRole: string, orgRole: string) {
  const pr = safeStr(projectRole).toLowerCase();
  const or = safeStr(orgRole).toLowerCase();
  return or === "admin" || or === "owner" || pr === "owner" || pr === "editor";
}

/* ---------------- domain enums (match DB constraints) ---------------- */

const RAID_TYPES = new Set(["Risk", "Assumption", "Issue", "Dependency"]);
const RAID_STATUSES = new Set(["Open", "In Progress", "Mitigated", "Closed", "Invalid"]);
const RAID_PRIORITIES = new Set(["Low", "Medium", "High", "Critical"]);
const RAID_IMPACTS = new Set(["low", "medium", "high", "critical"]);

function normalizeRaidType(raw: any): string {
  const s = safeStr(raw).trim();
  if (!s) return "";
  const lc = s.toLowerCase();
  if (lc === "risk") return "Risk";
  if (lc === "assumption") return "Assumption";
  if (lc === "issue") return "Issue";
  if (lc === "dependency" || lc === "dep") return "Dependency";
  return titleCaseLikeDbEnum(s);
}

function normalizeRaidStatus(raw: any): string {
  const s = safeStr(raw).trim();
  if (!s) return "Open";
  const lc = s.toLowerCase().replace(/_/g, " ");
  if (lc === "open") return "Open";
  if (lc === "in progress" || lc === "inprogress") return "In Progress";
  if (lc === "mitigated") return "Mitigated";
  if (lc === "closed") return "Closed";
  if (lc === "invalid") return "Invalid";
  return titleCaseLikeDbEnum(s);
}

function normalizeRaidPriority(raw: any): string | null {
  const s = safeStr(raw).trim();
  if (!s) return null;
  const lc = s.toLowerCase();
  if (lc === "low") return "Low";
  if (lc === "medium" || lc === "med") return "Medium";
  if (lc === "high") return "High";
  if (lc === "critical" || lc === "crit") return "Critical";
  return titleCaseLikeDbEnum(s);
}

function normalizeRaidImpact(raw: any): string | null {
  const s = safeStr(raw).trim();
  if (!s) return null;
  const lc = s.toLowerCase();
  if (lc === "low") return "low";
  if (lc === "medium" || lc === "med") return "medium";
  if (lc === "high") return "high";
  if (lc === "critical" || lc === "crit") return "critical";
  return lc;
}

function normalizeRelatedRefs(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  if (typeof raw === "object") return [raw];
  return [];
}

/* ---------------- AI enrichment ---------------- */

type RaidAiClassification = {
  type?: string | null;
  priority?: string | null;
  impact?: string | null;
  probability?: number | null;
  severity?: number | null;
  ai_rollup?: string | null;
};

async function classifyRaidItemBestEffort(input: {
  projectId: string;
  title?: string | null;
  description?: string | null;
  response_plan?: string | null;
  next_steps?: string | null;
  notes?: string | null;
}): Promise<RaidAiClassification | null> {
  try {
    const mod: any = await import("@/lib/ai/raid-classify");
    const fn =
      mod?.classifyRaidItem ||
      mod?.default?.classifyRaidItem ||
      mod?.default;

    if (typeof fn !== "function") return null;

    const out = await fn({
      projectId: input.projectId,
      title: input.title ?? "",
      description: input.description ?? "",
      response_plan: input.response_plan ?? "",
      next_steps: input.next_steps ?? "",
      notes: input.notes ?? "",
    });

    if (!out || typeof out !== "object") return null;

    return {
      type: safeStr(out.type).trim() || null,
      priority: safeStr(out.priority).trim() || null,
      impact: safeStr(out.impact).trim() || null,
      probability: clampInt0to100(out.probability),
      severity: clampInt0to100(out.severity),
      ai_rollup: safeStr(out.ai_rollup).trim() || null,
    };
  } catch {
    return null;
  }
}

/* ---------------- access guard ---------------- */

async function getProjectAccess(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) return { ok: false as const, status: 401, error: "Unauthorized" };

  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) {
    return { ok: false as const, status: 403, error: "No active organisation" };
  }

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projectErr) return { ok: false as const, status: 400, error: projectErr.message };
  if (!project?.id) return { ok: false as const, status: 404, error: "Project not found" };
  if (String(project.organisation_id) !== activeOrgId) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  const [{ data: orgMem, error: orgErr }, { data: projMemRows, error: projErr }] = await Promise.all([
    supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", activeOrgId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle(),
    supabase
      .from("project_members")
      .select("role, is_active, removed_at")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null),
  ]);

  if (orgErr) return { ok: false as const, status: 400, error: orgErr.message };
  if (projErr) return { ok: false as const, status: 400, error: projErr.message };

  const orgRole = safeStr(orgMem?.role).toLowerCase().trim();
  const activeProjRows = (projMemRows ?? []).filter((r: any) => r?.is_active !== false);
  const projectRole = bestProjectRole(activeProjRows as any);

  const isOrgMember = Boolean(orgRole);
  const isProjectMember = Boolean(projectRole);

  if (!isOrgMember && !isProjectMember) {
    return { ok: false as const, status: 403, error: "Forbidden" };
  }

  return {
    ok: true as const,
    userId: auth.user.id,
    activeOrgId,
    orgRole,
    projectRole,
    canWrite: canWrite(projectRole, orgRole),
  };
}

/* ========================================================================== */
/* GET /api/raid?projectId=... [&type=Risk] [&status=Open] [&includeClosed=true] */
/* ========================================================================== */

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();

    if (!looksLikeUuid(projectId)) return jsonErr("Invalid or missing projectId", 400);

    const supabase = await createClient();

    const access = await getProjectAccess(supabase, projectId);
    if (!access.ok) return jsonErr(access.error, access.status);

    const typeFilter = normalizeRaidType(url.searchParams.get("type"));
    const statusFilter = normalizeRaidStatus(url.searchParams.get("status"));
    const includeClosed =
      safeStr(url.searchParams.get("includeClosed")).trim().toLowerCase() === "true";

    let q = supabase
      .from("raid_items")
      .select(
        "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,impact,ai_rollup,owner_id,status,response_plan,next_steps,notes,related_refs,created_at,updated_at,due_date,ai_status,ai_dirty"
      )
      .eq("project_id", projectId);

    if (typeFilter) {
      if (!RAID_TYPES.has(typeFilter)) {
        return jsonErr(`Invalid type: ${typeFilter}`, 400, { allowed: Array.from(RAID_TYPES) });
      }
      q = q.eq("type", typeFilter);
    }

    if (url.searchParams.has("status")) {
      if (!RAID_STATUSES.has(statusFilter)) {
        return jsonErr(`Invalid status: ${statusFilter}`, 400, {
          allowed: Array.from(RAID_STATUSES),
        });
      }
      q = q.eq("status", statusFilter);
    } else if (!includeClosed) {
      q = q.not("status", "in", '("Closed","Invalid")');
    }

    const { data, error } = await q.order("updated_at", { ascending: false });

    if (error) return jsonErr(error.message, 400);

    return jsonOk({ items: data ?? [] });
  } catch (e: any) {
    return jsonErr("Failed to load RAID", 500, { message: safeStr(e?.message) });
  }
}

/* ========================================================================== */
/* POST /api/raid */
/* ========================================================================== */

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const body = await req.json().catch(() => null);
    if (!body) return jsonErr("Invalid JSON", 400);

    const project_id = safeStr(body.project_id).trim();
    if (!looksLikeUuid(project_id)) return jsonErr("Invalid or missing project_id", 400);

    const access = await getProjectAccess(supabase, project_id);
    if (!access.ok) return jsonErr(access.error, access.status);
    if (!access.canWrite) return jsonErr("Forbidden", 403);

    const title = safeStr(body.title).trim() || null;
    const description = safeStr(body.description).trim();
    const owner_label = safeStr(body.owner_label).trim();
    const response_plan = safeStr(body.response_plan).trim() || null;
    const next_steps = safeStr(body.next_steps).trim() || null;
    const notes = safeStr(body.notes).trim() || null;

    if (!description) return jsonErr("description required", 400);
    if (!owner_label) return jsonErr("owner_label required (Owner)", 400);

    const shouldClassify =
      !safeStr(body.type).trim() ||
      !safeStr(body.priority).trim() ||
      !safeStr(body.impact).trim() ||
      body.probability == null ||
      body.severity == null ||
      !safeStr(body.ai_rollup).trim();

    const ai = shouldClassify
      ? await classifyRaidItemBestEffort({
          projectId: project_id,
          title,
          description,
          response_plan,
          next_steps,
          notes,
        })
      : null;

    const type = normalizeRaidType(body.type || ai?.type);
    if (!type) return jsonErr("type required", 400);
    if (!RAID_TYPES.has(type)) {
      return jsonErr(`Invalid type: ${type}`, 400, { allowed: Array.from(RAID_TYPES) });
    }

    const status = normalizeRaidStatus(body.status);
    if (!RAID_STATUSES.has(status)) {
      return jsonErr(`Invalid status: ${status}`, 400, { allowed: Array.from(RAID_STATUSES) });
    }

    const priority = normalizeRaidPriority(body.priority || ai?.priority);
    if (priority && !RAID_PRIORITIES.has(priority)) {
      return jsonErr(`Invalid priority: ${priority}`, 400, {
        allowed: Array.from(RAID_PRIORITIES),
      });
    }

    const impact = normalizeRaidImpact(body.impact || ai?.impact);
    if (impact && !RAID_IMPACTS.has(impact)) {
      return jsonErr(`Invalid impact: ${impact}`, 400, {
        allowed: Array.from(RAID_IMPACTS),
      });
    }

    const dueRaw = safeStr(body.due_date).trim();
    const due_date = dueRaw ? (isIsoDateOnly(dueRaw) ? dueRaw : null) : null;
    if (dueRaw && !due_date) return jsonErr("due_date must be YYYY-MM-DD", 400);

    const probability =
      body.probability != null
        ? clampInt0to100(body.probability)
        : clampInt0to100(ai?.probability);

    const severity =
      body.severity != null
        ? clampInt0to100(body.severity)
        : clampInt0to100(ai?.severity);

    const ai_rollup =
      safeStr(body.ai_rollup).trim() ||
      safeStr(ai?.ai_rollup).trim() ||
      null;

    const row = {
      project_id,
      type,
      title,
      description,
      owner_label,
      priority: priority || null,
      probability,
      severity,
      impact: impact || null,
      owner_id: looksLikeUuid(safeStr(body.owner_id).trim())
        ? safeStr(body.owner_id).trim()
        : null,
      status,
      response_plan,
      next_steps,
      notes,
      ai_rollup,
      related_refs: normalizeRelatedRefs(body.related_refs),
      due_date,
      ai_dirty: true,
    };

    const { data, error } = await supabase
      .from("raid_items")
      .insert(row)
      .select(
        "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,impact,ai_rollup,owner_id,status,response_plan,next_steps,notes,related_refs,created_at,updated_at,due_date,ai_status,ai_dirty"
      )
      .single();

    if (error) return jsonErr(error.message, 400);

    return jsonOk(
      {
        item: data,
        ai_enriched: Boolean(ai),
      },
      201
    );
  } catch (e: any) {
    return jsonErr("Failed to create RAID item", 500, { message: safeStr(e?.message) });
  }
}