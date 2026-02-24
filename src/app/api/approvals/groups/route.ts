// src/app/api/approvals/groups/route.ts
import "server-only";
import { NextResponse } from "next/server";
import {
  sb,
  requireAuth,
  requireOrgMember,
  requireApprovalsWriter,
  safeStr,
} from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

const ALLOWED_ARTIFACT_TYPES = new Set(["project_charter", "change", "project_closure_report"]);

function normArtifactType(x: any) {
  const v = safeStr(x).trim().toLowerCase();
  if (!v) return "";
  if (v === "change_request" || v === "change_requests") return "change";
  return v;
}

function validateArtifactTypeOrEmpty(v: string) {
  if (!v) return true;
  return ALLOWED_ARTIFACT_TYPES.has(v);
}

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const organisationId = safeStr(url.searchParams.get("orgId")).trim();
    const artifactType = normArtifactType(url.searchParams.get("artifactType"));

    if (!organisationId) return err("Missing orgId", 400);

    // ✅ Read = org member
    await requireOrgMember(supabase, organisationId, user.id);

    if (!validateArtifactTypeOrEmpty(artifactType)) {
      return err(
        `Unsupported artifactType. Allowed: project_charter, change, project_closure_report`,
        400
      );
    }

    let q = supabase.from("approval_groups").select("*").eq("organisation_id", organisationId);
    if (artifactType) q = q.eq("artifact_type", artifactType);
    q = q.order("created_at", { ascending: false });

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const groups = (data ?? []).filter((g: any) =>
      "is_active" in g ? g.is_active !== false : true
    );

    return ok({ groups });
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
    const artifactType = normArtifactType(body?.artifactType);
    const name = safeStr(body?.name).trim();

    if (!organisationId) return err("Missing orgId", 400);
    if (!artifactType) return err("Missing artifactType", 400);
    if (!ALLOWED_ARTIFACT_TYPES.has(artifactType)) {
      return err(
        `Unsupported artifactType. Allowed: project_charter, change, project_closure_report`,
        400
      );
    }
    if (!name) return err("Missing name", 400);

    // ✅ Write = PLATFORM ADMIN ONLY (enterprise mode B)
    await requireApprovalsWriter(supabase, organisationId, user.id);

    const { data, error } = await supabase
      .from("approval_groups")
      .insert({
        organisation_id: organisationId,
        artifact_type: artifactType,
        name,
        is_active: true,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return ok({ group: data }, 201);
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
    const name = safeStr(body?.name).trim();
    const isActive = body?.is_active;

    if (!organisationId) return err("Missing orgId", 400);
    if (!id) return err("Missing id", 400);

    // ✅ Write = PLATFORM ADMIN ONLY (enterprise mode B)
    await requireApprovalsWriter(supabase, organisationId, user.id);

    const patch: any = {};
    if (name) patch.name = name;
    if (typeof isActive === "boolean") patch.is_active = isActive;

    const { data, error } = await supabase
      .from("approval_groups")
      .update(patch)
      .eq("id", id)
      .eq("organisation_id", organisationId)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return ok({ group: data });
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

    // ✅ Write = PLATFORM ADMIN ONLY (enterprise mode B)
    await requireApprovalsWriter(supabase, organisationId, user.id);

    const { error } = await supabase
      .from("approval_groups")
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