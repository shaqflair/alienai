// src/app/api/raid/[id]/route.ts
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
  return s.trim();
}

/* ---------------- domain enums (match DB constraints) ---------------- */

const RAID_TYPES = new Set(["Risk", "Assumption", "Issue", "Dependency"]);
const RAID_STATUSES = new Set(["Open", "In Progress", "Mitigated", "Closed", "Invalid"]);
const RAID_PRIORITIES = new Set(["Low", "Medium", "High", "Critical"]);

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

function normalizeRelatedRefs(raw: any): any[] {
  if (Array.isArray(raw)) return raw;
  if (raw == null) return [];
  if (typeof raw === "object") return [raw];
  return [];
}

function expectedUpdatedAtFrom(req: NextRequest, body: any) {
  const hdr = safeStr(req.headers.get("if-match-updated-at")).trim();
  const b = safeStr(body?.expected_updated_at).trim();
  return hdr || b || "";
}

/* ---------------- access guard ---------------- */

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

function canWrite(role: string) {
  const r = safeStr(role).toLowerCase();
  return r === "owner" || r === "editor";
}

/* ---------------- shared select ---------------- */

const RAID_SELECT =
  "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,impact,ai_rollup,owner_id,status,response_plan,next_steps,notes,related_refs,created_at,updated_at,due_date,ai_dirty";

/* ========================================================================== */
/* GET /api/raid/[id]                                                         */
/* ========================================================================== */

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raidId = safeStr(id).trim();

    if (!looksLikeUuid(raidId)) return jsonErr("Invalid or missing id", 400);

    const supabase = await createClient();

    const { data: item, error } = await supabase
      .from("raid_items")
      .select(RAID_SELECT)
      .eq("id", raidId)
      .maybeSingle();

    if (error) return jsonErr(error.message, 400);
    if (!item) return jsonErr("Not found", 404);

    const access = await requireProjectMember(supabase, safeStr(item.project_id));
    if (!access.ok) return jsonErr(access.error, access.status);

    return jsonOk({ item });
  } catch (e: any) {
    return jsonErr("Failed to load RAID item", 500, { message: safeStr(e?.message) });
  }
}

/* ========================================================================== */
/* PATCH /api/raid/[id]   body: { ...fields..., expected_updated_at? }         */
/* ========================================================================== */

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raidId = safeStr(id).trim();

    if (!looksLikeUuid(raidId)) return jsonErr("Invalid or missing id", 400);

    const supabase = await createClient();

    const body = await req.json().catch(() => null);
    if (!body) return jsonErr("Invalid JSON", 400);

    // Load current row (for membership + stale check)
    const { data: current, error: curErr } = await supabase
      .from("raid_items")
      .select(RAID_SELECT)
      .eq("id", raidId)
      .maybeSingle();

    if (curErr) return jsonErr(curErr.message, 400);
    if (!current) return jsonErr("Not found", 404);

    const access = await requireProjectMember(supabase, safeStr(current.project_id));
    if (!access.ok) return jsonErr(access.error, access.status);
    if (!canWrite(access.role)) return jsonErr("Forbidden", 403);

    // Concurrency
    const expected = expectedUpdatedAtFrom(req, body);
    const currentUpdatedAt = safeStr((current as any).updated_at).trim();
    if (expected && currentUpdatedAt && expected !== currentUpdatedAt) {
      return jsonErr("Conflict", 409, {
        stale: true,
        expected_updated_at: expected,
        current_updated_at: currentUpdatedAt,
      });
    }

    // Build a strict patch (only allowed fields)
    const patch: any = {};

    if ("type" in body) {
      const t = normalizeRaidType(body.type);
      if (!t) return jsonErr("type required", 400);
      if (!RAID_TYPES.has(t)) return jsonErr(`Invalid type: ${t}`, 400, { allowed: Array.from(RAID_TYPES) });
      patch.type = t;
    }

    if ("title" in body) patch.title = safeStr(body.title).trim() || null;

    if ("description" in body) {
      const d = safeStr(body.description).trim();
      if (!d) return jsonErr("description required", 400);
      patch.description = d;
    }

    if ("owner_label" in body) {
      const o = safeStr(body.owner_label).trim();
      if (!o) return jsonErr("owner_label required (Owner)", 400);
      patch.owner_label = o;
    }

    if ("status" in body) {
      const st = normalizeRaidStatus(body.status);
      if (!RAID_STATUSES.has(st))
        return jsonErr(`Invalid status: ${st}`, 400, { allowed: Array.from(RAID_STATUSES) });
      patch.status = st;
    }

    if ("priority" in body) {
      const pr = normalizeRaidPriority(body.priority);
      if (pr && !RAID_PRIORITIES.has(pr))
        return jsonErr(`Invalid priority: ${pr}`, 400, { allowed: Array.from(RAID_PRIORITIES) });
      patch.priority = pr || null;
    }

    if ("probability" in body) patch.probability = clampInt0to100(body.probability);
    if ("severity" in body) patch.severity = clampInt0to100(body.severity);

    if ("impact" in body) patch.impact = safeStr(body.impact).trim() || null;

    if ("owner_id" in body) {
      const oid = safeStr(body.owner_id).trim();
      patch.owner_id = looksLikeUuid(oid) ? oid : null;
    }

    if ("response_plan" in body) patch.response_plan = safeStr(body.response_plan).trim() || null;
    if ("next_steps" in body) patch.next_steps = safeStr(body.next_steps).trim() || null;
    if ("notes" in body) patch.notes = safeStr(body.notes).trim() || null;
    if ("ai_rollup" in body) patch.ai_rollup = safeStr(body.ai_rollup).trim() || null;

    if ("related_refs" in body) patch.related_refs = normalizeRelatedRefs(body.related_refs);

    if ("due_date" in body) {
      const dueRaw = safeStr(body.due_date).trim();
      const due_date = dueRaw ? (isIsoDateOnly(dueRaw) ? dueRaw : null) : null;
      if (dueRaw && !due_date) return jsonErr("due_date must be YYYY-MM-DD", 400);
      patch.due_date = due_date;
    }

    // Nothing to update
    if (!Object.keys(patch).length) return jsonOk({ item: current });

    const { data: updated, error: upErr } = await supabase
      .from("raid_items")
      .update(patch)
      .eq("id", raidId)
      .select(RAID_SELECT)
      .single();

    if (upErr) return jsonErr(upErr.message, 400);

    return jsonOk({ item: updated });
  } catch (e: any) {
    return jsonErr("Failed to update RAID item", 500, { message: safeStr(e?.message) });
  }
}

/* ========================================================================== */
/* DELETE /api/raid/[id]   (uses header/body expected_updated_at)              */
/* ========================================================================== */

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const raidId = safeStr(id).trim();

    if (!looksLikeUuid(raidId)) return jsonErr("Invalid or missing id", 400);

    const supabase = await createClient();

    // Some clients send JSON body on DELETE, some don’t.
    const body = await req.json().catch(() => ({}));
    const expected = expectedUpdatedAtFrom(req, body);

    const { data: current, error: curErr } = await supabase
      .from("raid_items")
      .select("id,project_id,updated_at")
      .eq("id", raidId)
      .maybeSingle();

    if (curErr) return jsonErr(curErr.message, 400);
    if (!current) return NextResponse.json({ ok: true }, { status: 204 });

    const access = await requireProjectMember(supabase, safeStr((current as any).project_id));
    if (!access.ok) return jsonErr(access.error, access.status);
    if (!canWrite(access.role)) return jsonErr("Forbidden", 403);

    const currentUpdatedAt = safeStr((current as any).updated_at).trim();
    if (expected && currentUpdatedAt && expected !== currentUpdatedAt) {
      return jsonErr("Conflict", 409, {
        stale: true,
        expected_updated_at: expected,
        current_updated_at: currentUpdatedAt,
      });
    }

    const { error: delErr } = await supabase.from("raid_items").delete().eq("id", raidId);
    if (delErr) return jsonErr(delErr.message, 400);

    return NextResponse.json({ ok: true }, { status: 204 });
  } catch (e: any) {
    return jsonErr("Failed to delete RAID item", 500, { message: safeStr(e?.message) });
  }
}