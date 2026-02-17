// src/app/api/doa/rules/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeNum(x: unknown): number | null {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

async function requireAuth(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

// âœ… Your roles: owner | editor | viewer
async function requireProjectAdmin(supabase: any, projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const role = String(data?.role ?? "").toLowerCase();
  const allowed = new Set(["owner", "editor"]);
  if (!allowed.has(role)) throw new Error("Forbidden");
}

/**
 * Overlap rule:
 * - Treat max_amount NULL as infinity
 * - Two ranges [a,b] and [c,d] overlap iff a <= d and c <= b
 *   where b/d can be infinity.
 */
function rangesOverlap(aMin: number, aMax: number | null, bMin: number, bMax: number | null) {
  const Amax = aMax == null ? Number.POSITIVE_INFINITY : aMax;
  const Bmax = bMax == null ? Number.POSITIVE_INFINITY : bMax;
  return aMin <= Bmax && bMin <= Amax;
}

async function ensureNoOverlap(
  supabase: any,
  args: { projectId: string; minAmount: number; maxAmount: number | null; excludeId?: string }
) {
  const { projectId, minAmount, maxAmount, excludeId } = args;

  let q = supabase
    .from("doa_rules")
    .select("id,min_amount,max_amount,removed_at")
    .eq("project_id", projectId)
    .is("removed_at", null);

  if (excludeId) q = q.neq("id", excludeId);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  const rules = (data ?? []) as any[];
  const conflict = rules.find((r) =>
    rangesOverlap(minAmount, maxAmount, Number(r.min_amount ?? 0), r.max_amount == null ? null : Number(r.max_amount))
  );

  if (conflict) {
    throw new Error("Band overlaps an existing rule. Adjust min/max so bands do not overlap.");
  }
}

/**
 * POST /api/doa/rules
 * Body:
 * {
 *   projectId,
 *   minAmount,
 *   maxAmount?, // null or missing = infinity
 *   currency?,
 *   approverUserId,
 *   approverName?,
 *   approverEmail?,
 *   approverRole?
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    if (!projectId) return jsonErr("Missing projectId", 400);

    await requireProjectAdmin(supabase, projectId, user.id);

    const minAmount = safeNum(body?.minAmount);
    const maxAmount = body?.maxAmount === "" ? null : safeNum(body?.maxAmount);
    const currency = safeStr(body?.currency).trim() || "GBP";

    if (minAmount == null) return jsonErr("minAmount must be a number", 400);
    if (minAmount < 0) return jsonErr("minAmount must be >= 0", 400);

    if (maxAmount !== null && maxAmount !== undefined) {
      if (maxAmount < 0) return jsonErr("maxAmount must be >= 0", 400);
      if (maxAmount < minAmount) return jsonErr("maxAmount must be >= minAmount", 400);
    }

    const approverUserId = safeStr(body?.approverUserId).trim();
    if (!approverUserId) return jsonErr("Missing approverUserId", 400);

    // âœ… prevent overlapping bands
    await ensureNoOverlap(supabase, {
      projectId,
      minAmount,
      maxAmount: maxAmount == null ? null : maxAmount,
    });

    const insertRow: any = {
      project_id: projectId,
      min_amount: minAmount,
      max_amount: maxAmount == null ? null : maxAmount,
      currency,
      approver_user_id: approverUserId,
      approver_name: safeStr(body?.approverName).trim() || null,
      approver_email: safeStr(body?.approverEmail).trim() || null,
      approver_role: safeStr(body?.approverRole).trim() || null,
      created_by: user.id,
      // updated_at is handled by trigger on update; on insert default now()
    };

    const { data, error } = await supabase.from("doa_rules").insert(insertRow).select("*").single();
    if (error) throw new Error(error.message);

    return jsonOk({ rule: data }, 201);
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized") ? 401 : lower.includes("forbidden") ? 403 : 400;
    return jsonErr(msg, status);
  }
}

/**
 * GET /api/doa/rules?projectId=...
 * Returns active rules only (removed_at IS NULL)
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    if (!projectId) return jsonErr("Missing projectId", 400);

    // any active project member can view
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("id")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (memErr) throw new Error(memErr.message);
    if (!mem?.id) return jsonErr("Forbidden", 403);

    const { data, error } = await supabase
      .from("doa_rules")
      .select("*")
      .eq("project_id", projectId)
      .is("removed_at", null)
      .order("min_amount", { ascending: true });

    if (error) throw new Error(error.message);

    return jsonOk({ rules: data ?? [] });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized") ? 401 : lower.includes("forbidden") ? 403 : 400;
    return jsonErr(msg, status);
  }
}

/**
 * PATCH /api/doa/rules
 * Body:
 * {
 *   id,
 *   projectId,
 *   minAmount,
 *   maxAmount?,
 *   currency?,
 *   approverUserId,
 *   approverName?,
 *   approverEmail?,
 *   approverRole?
 * }
 */
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));
    const id = safeStr(body?.id).trim();
    const projectId = safeStr(body?.projectId).trim();
    if (!id) return jsonErr("Missing id", 400);
    if (!projectId) return jsonErr("Missing projectId", 400);

    await requireProjectAdmin(supabase, projectId, user.id);

    const minAmount = safeNum(body?.minAmount);
    const maxAmount = body?.maxAmount === "" ? null : safeNum(body?.maxAmount);
    const currency = safeStr(body?.currency).trim() || "GBP";

    if (minAmount == null) return jsonErr("minAmount must be a number", 400);
    if (minAmount < 0) return jsonErr("minAmount must be >= 0", 400);

    if (maxAmount !== null && maxAmount !== undefined) {
      if (maxAmount < 0) return jsonErr("maxAmount must be >= 0", 400);
      if (maxAmount < minAmount) return jsonErr("maxAmount must be >= minAmount", 400);
    }

    const approverUserId = safeStr(body?.approverUserId).trim();
    if (!approverUserId) return jsonErr("Missing approverUserId", 400);

    // Ensure rule exists and belongs to this project and is active
    const { data: existing, error: exErr } = await supabase
      .from("doa_rules")
      .select("id, project_id, removed_at")
      .eq("id", id)
      .maybeSingle();

    if (exErr) throw new Error(exErr.message);
    if (!existing?.id) return jsonErr("Rule not found", 404);
    if (existing.removed_at) return jsonErr("Rule is removed", 400);
    if (String(existing.project_id) !== projectId) return jsonErr("projectId mismatch", 400);

    // âœ… prevent overlap (exclude this rule)
    await ensureNoOverlap(supabase, {
      projectId,
      minAmount,
      maxAmount: maxAmount == null ? null : maxAmount,
      excludeId: id,
    });

    const patch: any = {
      min_amount: minAmount,
      max_amount: maxAmount == null ? null : maxAmount,
      currency,
      approver_user_id: approverUserId,
      approver_name: safeStr(body?.approverName).trim() || null,
      approver_email: safeStr(body?.approverEmail).trim() || null,
      approver_role: safeStr(body?.approverRole).trim() || null,
      // updated_at handled by trigger
    };

    const { data, error } = await supabase.from("doa_rules").update(patch).eq("id", id).select("*").single();
    if (error) throw new Error(error.message);

    return jsonOk({ rule: data });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized") ? 401 : lower.includes("forbidden") ? 403 : 400;
    return jsonErr(msg, status);
  }
}

/**
 * DELETE /api/doa/rules?id=...&projectId=...
 * Soft delete: sets removed_at + removed_by (matches your schema)
 */
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const id = safeStr(url.searchParams.get("id")).trim();
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    if (!id) return jsonErr("Missing id", 400);
    if (!projectId) return jsonErr("Missing projectId", 400);

    await requireProjectAdmin(supabase, projectId, user.id);

    // Ensure exists and belongs to project
    const { data: existing, error: exErr } = await supabase
      .from("doa_rules")
      .select("id, project_id, removed_at")
      .eq("id", id)
      .maybeSingle();

    if (exErr) throw new Error(exErr.message);
    if (!existing?.id) return jsonErr("Rule not found", 404);
    if (String(existing.project_id) !== projectId) return jsonErr("projectId mismatch", 400);

    const { data, error } = await supabase
      .from("doa_rules")
      .update({
        removed_at: new Date().toISOString(),
        removed_by: user.id,
      })
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    return jsonOk({ rule: data });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized") ? 401 : lower.includes("forbidden") ? 403 : 400;
    return jsonErr(msg, status);
  }
}


