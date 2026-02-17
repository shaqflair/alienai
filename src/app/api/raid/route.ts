// src/app/api/raid/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200, headers?: HeadersInit) {
  return NextResponse.json({ ok: true, ...data }, { status, headers });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
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
  // keep DB enum casing stable; we validate against exact allowed list anyway
  return s.trim();
}

/* ---------------- domain enums (match DB constraints) ---------------- */

const RAID_TYPES = new Set(["Risk", "Assumption", "Issue", "Dependency"]);
const RAID_STATUSES = new Set(["Open", "In Progress", "Mitigated", "Closed", "Invalid"]);
const RAID_PRIORITIES = new Set(["Low", "Medium", "High", "Critical"]);

function normalizeRaidType(raw: any): string {
  const s = safeStr(raw).trim();
  if (!s) return "";
  // allow loose inputs
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

function normalizeRelatedRefs(raw: any): any[] {
  // your DDL: related_refs jsonb NOT NULL default '[]'
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  // tolerate object from older UI
  if (typeof raw === "object") return [raw];
  return [];
}

/* ---------------- access guard (charter-style) ---------------- */

async function requireProjectMember(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) return { ok: false as const, status: 401, error: "Unauthorized" };

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role,is_active")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) return { ok: false as const, status: 400, error: memErr.message };
  if (!mem?.is_active) return { ok: false as const, status: 403, error: "Forbidden" };

  return { ok: true as const, userId: auth.user.id, role: safeStr(mem.role) };
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

    const access = await requireProjectMember(supabase, projectId);
    if (!access.ok) return jsonErr(access.error, access.status);

    // Optional filters
    const typeFilter = normalizeRaidType(url.searchParams.get("type"));
    const statusFilter = normalizeRaidStatus(url.searchParams.get("status"));
    const includeClosed = safeStr(url.searchParams.get("includeClosed"))
      .trim()
      .toLowerCase() === "true";

    let q = supabase
      .from("raid_items")
      .select(
        "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,impact,ai_rollup,owner_id,status,response_plan,next_steps,notes,related_refs,created_at,updated_at,due_date"
      )
      .eq("project_id", projectId);

    if (typeFilter) {
      if (!RAID_TYPES.has(typeFilter)) return jsonErr(`Invalid type: ${typeFilter}`, 400, { allowed: Array.from(RAID_TYPES) });
      q = q.eq("type", typeFilter);
    }

    if (url.searchParams.has("status")) {
      // only apply status filter if user asked for it
      if (!RAID_STATUSES.has(statusFilter)) return jsonErr(`Invalid status: ${statusFilter}`, 400, { allowed: Array.from(RAID_STATUSES) });
      q = q.eq("status", statusFilter);
    } else if (!includeClosed) {
      // default: hide Closed + Invalid unless asked
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
/* POST /api/raid  body: { project_id, type, description, owner_label, ... }   */
/* ========================================================================== */

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const body = await req.json().catch(() => null);
    if (!body) return jsonErr("Invalid JSON", 400);

    const project_id = safeStr(body.project_id).trim();
    if (!looksLikeUuid(project_id)) return jsonErr("Invalid or missing project_id", 400);

    const access = await requireProjectMember(supabase, project_id);
    if (!access.ok) return jsonErr(access.error, access.status);

    const type = normalizeRaidType(body.type);
    const description = safeStr(body.description).trim();
    const owner_label = safeStr(body.owner_label).trim(); // required by DB constraint

    if (!type) return jsonErr("type required", 400);
    if (!RAID_TYPES.has(type)) return jsonErr(`Invalid type: ${type}`, 400, { allowed: Array.from(RAID_TYPES) });

    if (!description) return jsonErr("description required", 400);
    if (!owner_label) return jsonErr("owner_label required (Owner)", 400);

    const status = normalizeRaidStatus(body.status);
    if (!RAID_STATUSES.has(status)) return jsonErr(`Invalid status: ${status}`, 400, { allowed: Array.from(RAID_STATUSES) });

    const priority = normalizeRaidPriority(body.priority);
    if (priority && !RAID_PRIORITIES.has(priority))
      return jsonErr(`Invalid priority: ${priority}`, 400, { allowed: Array.from(RAID_PRIORITIES) });

    const dueRaw = safeStr(body.due_date).trim();
    const due_date = dueRaw ? (isIsoDateOnly(dueRaw) ? dueRaw : null) : null;
    if (dueRaw && !due_date) return jsonErr("due_date must be YYYY-MM-DD", 400);

    const probability = clampInt0to100(body.probability);
    const severity = clampInt0to100(body.severity);

    const row = {
      project_id,
      type,
      title: safeStr(body.title).trim() || null,
      description,
      owner_label,
      priority: priority || null,
      probability,
      severity,
      impact: safeStr(body.impact).trim() || null,
      owner_id: looksLikeUuid(safeStr(body.owner_id).trim()) ? safeStr(body.owner_id).trim() : null,
      status,
      response_plan: safeStr(body.response_plan).trim() || null,
      next_steps: safeStr(body.next_steps).trim() || null,
      notes: safeStr(body.notes).trim() || null,
      ai_rollup: safeStr(body.ai_rollup).trim() || null,
      related_refs: normalizeRelatedRefs(body.related_refs),
      due_date,
    };

    const { data, error } = await supabase.from("raid_items").insert(row).select("*").single();
    if (error) return jsonErr(error.message, 400);

    return jsonOk({ item: data }, 201);
  } catch (e: any) {
    return jsonErr("Failed to create RAID item", 500, { message: safeStr(e?.message) });
  }
}

