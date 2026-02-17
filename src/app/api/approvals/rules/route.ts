import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { sb, requireAuth, requireOrgAdmin, requireOrgMember, safeStr } from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function safeNum(x: unknown): number | null {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * For now: only enable org approval rules for these artifact types.
 * (Change uses its own submit route, but shares the same org rules.)
 */
const ALLOWED_RULE_ARTIFACT_TYPES = new Set<string>([
  "project_charter",
  "change",
  "project_closure_report",
]);

function normalizeArtifactType(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function assertAllowedArtifactType(artifactType: string) {
  if (!artifactType) return "Missing artifactType";
  if (!ALLOWED_RULE_ARTIFACT_TYPES.has(artifactType)) {
    return `Approvals are only enabled for: ${Array.from(ALLOWED_RULE_ARTIFACT_TYPES).join(", ")}`;
  }
  return null;
}

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const organisationId = safeStr(url.searchParams.get("orgId")).trim();
    const artifactType = normalizeArtifactType(url.searchParams.get("artifactType"));

    if (!organisationId) return err("Missing orgId", 400);
    const typeErr = assertAllowedArtifactType(artifactType);
    if (typeErr) return err(typeErr, 400);

    await requireOrgMember(supabase, organisationId, user.id);

    const { data, error } = await supabase
      .from("artifact_approver_rules")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq("artifact_type", artifactType)
      .eq("is_active", true)
      .order("step", { ascending: true })
      .order("min_amount", { ascending: true });

    if (error) throw new Error(error.message);

    // ✅ IMPORTANT: UI expects { rules: [...] }
    return ok({ rules: data ?? [] });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));
    const organisationId = safeStr(body?.orgId).trim();
    const artifactType = normalizeArtifactType(body?.artifactType);

    const typeErr = assertAllowedArtifactType(artifactType);

    const step = safeNum(body?.step) ?? 1;
    const approvalRole = safeStr(body?.approval_role).trim() || "Approver";
    const minAmount = safeNum(body?.min_amount) ?? 0;
    const maxAmount = body?.max_amount === "" ? null : safeNum(body?.max_amount);

    const approverUserId = safeStr(body?.approver_user_id).trim();
    const approvalGroupId = safeStr(body?.approval_group_id).trim();

    if (!organisationId) return err("Missing orgId", 400);
    if (typeErr) return err(typeErr, 400);

    await requireOrgAdmin(supabase, organisationId, user.id);

    const targetOk = (approverUserId && !approvalGroupId) || (!approverUserId && approvalGroupId);
    if (!targetOk) return err("Provide either approver_user_id OR approval_group_id", 400);

    if (minAmount == null || minAmount < 0) return err("min_amount must be >= 0", 400);
    if (maxAmount != null && maxAmount < minAmount) return err("max_amount must be >= min_amount", 400);
    if (!Number.isFinite(step) || step < 1) return err("step must be >= 1", 400);

    const { data, error } = await supabase
      .from("artifact_approver_rules")
      .insert({
        organisation_id: organisationId,
        artifact_type: artifactType,
        approval_role: approvalRole,
        step,
        min_amount: minAmount,
        max_amount: maxAmount,
        approver_user_id: approverUserId || null,
        approval_group_id: approvalGroupId || null,
        is_active: true,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return ok({ rule: data }, 201);
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));
    const organisationId = safeStr(body?.orgId).trim();
    const id = safeStr(body?.id).trim();

    if (!organisationId) return err("Missing orgId", 400);
    if (!id) return err("Missing id", 400);

    await requireOrgAdmin(supabase, organisationId, user.id);

    const patch: any = {};

    // Do NOT allow changing artifact_type here (keeps rules stable + avoids bypassing allowed types)
    if (body?.approval_role != null) patch.approval_role = safeStr(body.approval_role).trim();
    if (body?.step != null) {
      const v = safeNum(body.step) ?? 1;
      if (!Number.isFinite(v) || v < 1) return err("step must be >= 1", 400);
      patch.step = v;
    }

    if (body?.min_amount != null) {
      const v = safeNum(body.min_amount);
      if (v == null || v < 0) return err("min_amount must be >= 0", 400);
      patch.min_amount = v;
    }

    if (body?.max_amount !== undefined) {
      const v = body.max_amount === "" ? null : safeNum(body.max_amount);
      if (v != null && v < 0) return err("max_amount must be >= 0", 400);
      patch.max_amount = v;
    }

    const approverUserId = safeStr(body?.approver_user_id).trim();
    const approvalGroupId = safeStr(body?.approval_group_id).trim();
    if (approverUserId || approvalGroupId) {
      const targetOk = (approverUserId && !approvalGroupId) || (!approverUserId && approvalGroupId);
      if (!targetOk) return err("Provide either approver_user_id OR approval_group_id", 400);
      patch.approver_user_id = approverUserId || null;
      patch.approval_group_id = approvalGroupId || null;
    }

    const { data, error } = await supabase
      .from("artifact_approver_rules")
      .update(patch)
      .eq("id", id)
      .eq("organisation_id", organisationId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);

    // Optional safety: ensure returned rule is in allowed set (in case older data exists)
    const returnedType = normalizeArtifactType((data as any)?.artifact_type);
    if (returnedType && !ALLOWED_RULE_ARTIFACT_TYPES.has(returnedType)) {
      return err(
        `This rule's artifact_type (${returnedType}) is not enabled yet. Allowed: ${Array.from(ALLOWED_RULE_ARTIFACT_TYPES).join(
          ", "
        )}`,
        409
      );
    }

    return ok({ rule: data });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const organisationId = safeStr(url.searchParams.get("orgId")).trim();
    const id = safeStr(url.searchParams.get("id")).trim();

    if (!organisationId) return err("Missing orgId", 400);
    if (!id) return err("Missing id", 400);

    await requireOrgAdmin(supabase, organisationId, user.id);

    const { error } = await supabase
      .from("artifact_approver_rules")
      .update({ is_active: false })
      .eq("id", id)
      .eq("organisation_id", organisationId);

    if (error) throw new Error(error.message);
    return ok({ removed: true });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}

