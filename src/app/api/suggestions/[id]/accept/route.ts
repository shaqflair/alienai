// src/app/api/suggestions/[id]/accept/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { applyPatch } from "@/lib/ai/patch-apply";
import { runOrchestrator } from "@/lib/orchestrator";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x ?? "")
  );
}

async function safeJson(req: Request) {
  return await req.json().catch(() => ({}));
}

function slugNameKey(name: string) {
  const s = String(name ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return s || "stakeholder";
}

function isStakeholderRegisterType(t: string) {
  const s = safeLower(t);
  return s === "stakeholder_register" || s === "stakeholders" || s === "stakeholder";
}

function normalizeInfluenceDb(x: unknown): "high" | "medium" | "low" {
  const s = safeLower(x);
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

async function requireProjectMembership(supabase: any, projectId: string, userId: string) {
  const { data: mem, error } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!mem) throw new Error("Not found");

  const role = safeLower((mem as any).role ?? "viewer");
  const canWrite = role === "owner" || role === "admin" || role === "editor";
  if (!canWrite) throw new Error("Forbidden");
}

async function getOrCreateTargetArtifact(supabase: any, projectId: string, artifactType: string) {
  const { data: existing, error: exErr } = await supabase
    .from("artifacts")
    .select("id, content_json, title")
    .eq("project_id", projectId)
    .eq("type", artifactType)
    .eq("is_current", true)
    .order("created_at", { ascending: false })
    .maybeSingle();

  if (exErr) throw exErr;
  if (existing?.id) return existing;

  const nowIso = new Date().toISOString();
  const title =
    artifactType === "raid_log"
      ? "RAID Log"
      : artifactType === "status_dashboard"
      ? "Status Dashboard"
      : artifactType === "stakeholder_register"
      ? "Stakeholder Register"
      : artifactType;

  const { data: inserted, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id: projectId,
      type: artifactType,
      title,
      content: "",
      content_json: { version: 2, type: artifactType, sections: [] },
      approval_status: "draft",
      status: "draft",
      is_locked: false,
      is_current: true,
      is_baseline: false,
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id, content_json, title")
    .single();

  if (insErr) throw insErr;
  return inserted;
}

/**
 * âœ… Auto-apply governance roles into canonical table: public.stakeholders
 * Patch shape we generate for governance:
 * { kind:"add_rows", mode:"append", rows:[[name, role, influence, expectations], ...] }
 *
 * âœ… Stakeholder Register requirement: Sponsor ONLY (no Approver)
 */
async function applyStakeholderGovernanceToDb(args: {
  supabase: any;
  projectId: string;
  artifactId: string;
  patch: any;
  actorUserId: string;
}) {
  const { supabase, projectId, artifactId, patch, actorUserId } = args;

  const rows = Array.isArray(patch?.rows) ? patch.rows : [];
  if (!rows.length) return { ok: true, upserted: 0 };

  // âœ… Only Sponsor rows are allowed/required
  const sponsorOnly = rows.filter((r: any) => safeLower(r?.[1]) === "project sponsor");
  if (!sponsorOnly.length) return { ok: true, upserted: 0 };

  const payload = sponsorOnly
    .map((r: any) => {
      const name = safeStr(r?.[0]).trim();
      const role = safeStr(r?.[1]).trim(); // "Project Sponsor"
      const influence = normalizeInfluenceDb(r?.[2]);
      const expectations = safeStr(r?.[3]).trim();

      if (!name || !role) return null;

      // âœ… Make key artifact-scoped AND role-scoped so "TBC" doesn't collide
      const name_key = slugNameKey(`${name}-${role}`);

      return {
        project_id: projectId,
        artifact_id: artifactId,
        name,
        name_key,
        role,
        influence_level: influence,
        expectations: expectations || null,
        communication_strategy: null,
        contact_info: {
          point_of_contact: "",
          internal_external: "Internal",
          title_role: "",
          stakeholder_mapping: "",
          involvement_milestone: "",
          stakeholder_impact: "",
          channels: ["Teams"],
          group: "Project",
          added_by_ai: true,
          added_by_user: actorUserId,
        },
        updated_at: new Date().toISOString(),
      };
    })
    .filter(Boolean);

  if (!payload.length) return { ok: true, upserted: 0 };

  // âœ… IMPORTANT: artifact-scoped uniqueness
  const { error } = await supabase
    .from("stakeholders")
    .upsert(payload as any[], { onConflict: "project_id,artifact_id,name_key" });

  if (error) return { ok: false, upserted: 0, error: error.message };
  return { ok: true, upserted: payload.length };
}

export async function POST(req: Request, ctx: any) {
  const supabase = await createClient();

  // âœ… Auth required
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return NextResponse.json({ ok: false, error: authErr.message }, { status: 500 });
  if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  // âœ… Next params can be Promise in some versions
  const params = ctx?.params && typeof ctx.params?.then === "function" ? await ctx.params : ctx?.params;
  const id = safeStr(params?.id).trim();
  if (!id) return NextResponse.json({ ok: false, error: "Missing suggestion id" }, { status: 400 });

  const body = await safeJson(req);
  const bodyProjectId = safeStr(body?.projectId).trim();
  const bodyArtifactId = safeStr(body?.artifactId).trim();

  // Load suggestion (must include artifact_id)
  const { data: sug, error: sErr } = await supabase
    .from("ai_suggestions")
    .select("id, project_id, artifact_id, target_artifact_type, suggestion_type, patch, status")
    .eq("id", id)
    .maybeSingle();

  if (sErr) return NextResponse.json({ ok: false, error: sErr.message }, { status: 500 });
  if (!sug) return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });

  const projectId = safeStr((sug as any).project_id || bodyProjectId).trim();
  if (!projectId || !isUuid(projectId)) {
    return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
  }

  // âœ… Membership/permission check
  try {
    await requireProjectMembership(supabase, projectId, auth.user.id);
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const code = msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }

  const currStatus = safeLower((sug as any).status);
  if (currStatus !== "proposed") {
    return NextResponse.json({
      ok: true,
      suggestion: { id: (sug as any).id, status: (sug as any).status },
      note: `No change (already ${(sug as any).status})`,
    });
  }

  const targetType = safeStr((sug as any).target_artifact_type).trim();
  const suggestionType = safeLower((sug as any).suggestion_type);
  const patch = (sug as any).patch ?? null;

  // âœ… Determine artifactId for stakeholder DB apply
  const effectiveArtifactId = safeStr((sug as any).artifact_id || bodyArtifactId).trim();

  // ============================
  // SPECIAL CASE: Stakeholder governance -> apply to public.stakeholders directly
  // ============================
  let appliedToStakeholders: any = null;

  const isGovPatch = patch && safeLower(patch?.kind) === "add_rows" && Array.isArray(patch?.rows);
  const isStakeholderGov =
    isStakeholderRegisterType(targetType) && (suggestionType === "governance" || isGovPatch);

  if (isStakeholderGov) {
    if (!effectiveArtifactId || !isUuid(effectiveArtifactId)) {
      return NextResponse.json(
        { ok: false, error: "Missing/invalid artifactId for stakeholder governance apply" },
        { status: 400 }
      );
    }

    appliedToStakeholders = await applyStakeholderGovernanceToDb({
      supabase,
      projectId,
      artifactId: effectiveArtifactId,
      patch,
      actorUserId: auth.user.id,
    });

    if (!appliedToStakeholders?.ok) {
      return NextResponse.json(
        { ok: false, error: appliedToStakeholders?.error || "Failed to apply governance rows" },
        { status: 500 }
      );
    }

    // Mark suggestion applied (matches your check constraint)
    const { error: updSugErr } = await supabase
      .from("ai_suggestions")
      .update({
        status: "applied",
        decided_at: new Date().toISOString(),
        actioned_by: auth.user.id,
      })
      .eq("id", id)
      .eq("project_id", projectId);

    if (updSugErr) return NextResponse.json({ ok: false, error: updSugErr.message }, { status: 500 });

    // Orchestrator (best effort)
    try {
      await runOrchestrator({
        projectId,
        artifactId: effectiveArtifactId,
        artifactType: "stakeholder_register",
        artifactJson: null,
      });
    } catch {
      // swallow
    }

    return NextResponse.json({
      ok: true,
      applied: true,
      mode: "stakeholders_db",
      artifactId: effectiveArtifactId,
      appliedToStakeholders,
    });
  }

  // ============================
  // DEFAULT: Apply patch to artifacts.content_json
  // ============================
  const target = await getOrCreateTargetArtifact(supabase, projectId, targetType);
  await applyPatch(patch, projectId);

  const { error: updErr } = await supabase
    .from("artifacts")
    .update({ content_json: nextJson, updated_at: new Date().toISOString() })
    .eq("id", (target as any).id)
    .eq("project_id", projectId);

  if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });

  const { error: sugUpdErr } = await supabase
    .from("ai_suggestions")
    .update({ status: "applied", decided_at: new Date().toISOString(), actioned_by: auth.user.id })
    .eq("id", id)
    .eq("project_id", projectId);

  if (sugUpdErr) return NextResponse.json({ ok: false, error: sugUpdErr.message }, { status: 500 });

  let orch: any = null;
  try {
    orch = await runOrchestrator({
      projectId,
      artifactId: String((target as any).id),
      artifactType: targetType,
      artifactJson: nextJson,
    });
  } catch {
    orch = null;
  }

  return NextResponse.json({
    ok: true,
    applied: true,
    mode: "artifact_json",
    target_artifact_id: (target as any).id,
    orchestrator: orch,
  });
}



