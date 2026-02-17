// src/app/api/stakeholders/[id]/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ----------------------------------------
   Helpers
---------------------------------------- */

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x ?? "").trim()
  );
}

type MemberRole = "viewer" | "editor" | "admin" | "owner";
function normalizeRole(role: unknown): MemberRole {
  const r = String(role ?? "viewer").toLowerCase();
  if (r === "owner" || r === "admin" || r === "editor" || r === "viewer") return r;
  return "viewer";
}
function canDelete(role: MemberRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

function jsonError(message: string, status: number, meta?: any) {
  return NextResponse.json({ ok: false, error: message, meta }, { status });
}

/* ----------------------------------------
   Artifact content_json sync
   (Exporters expect flat: { version, type, rows: [] })
---------------------------------------- */

function normalizeChannel(x: any) {
  return String(x ?? "").trim().replace(/\s+/g, " ");
}

function normalizeGroup(x: any) {
  const s = String(x ?? "").trim();
  return s || "Project";
}

function toImpactUi(x: any): "High" | "Medium" | "Low" {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "high") return "High";
  if (s === "low") return "Low";
  return "Medium";
}

function toInfluenceUi(x: any): "High" | "Medium" | "Low" {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "high") return "High";
  if (s === "low") return "Low";
  return "Medium";
}

function inferMapping(influence?: string, impact?: string) {
  const i = String(influence ?? "").toLowerCase();
  const p = String(impact ?? "").toLowerCase();
  if (i === "high" && p === "high") return "Manage Closely";
  if (i === "high" && p !== "high") return "Keep Satisfied";
  if (i !== "high" && p === "high") return "Keep Informed";
  return "Monitor";
}

function buildStakeholderRegisterContentJson(stakeholders: any[]) {
  const rows = (stakeholders ?? [])
    .map((s) => {
      const contact =
        s?.contact_info && typeof s.contact_info === "object" && !Array.isArray(s.contact_info)
          ? s.contact_info
          : {};

      const influenceUi = toInfluenceUi(s?.influence_level);
      const impactUi = toImpactUi(contact?.impact_level ?? "Medium");

      return {
        id: String(s?.id ?? ""),
        name: String(s?.name ?? "").trim(),
        point_of_contact: String(contact?.point_of_contact ?? "").trim(),
        role: String(s?.role ?? "").trim(),
        internal_external:
          String(contact?.internal_external ?? "Internal") === "External" ? "External" : "Internal",
        title_role: String(contact?.title_role ?? "").trim(),
        impact_level: impactUi,
        influence_level: influenceUi,
        stakeholder_mapping: String(contact?.stakeholder_mapping ?? "") || inferMapping(influenceUi, impactUi),
        involvement_milestone: String(contact?.involvement_milestone ?? "").trim(),
        stakeholder_impact: String(contact?.stakeholder_impact ?? "").trim(),
        channels: Array.isArray(contact?.channels) ? contact.channels.map(normalizeChannel).filter(Boolean) : [],
        group: normalizeGroup(contact?.group ?? "Project"),
      };
    })
    .filter((r) => r.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));

  return { version: 1, type: "stakeholder_register", rows };
}

async function syncArtifactContentJson(supabase: any, projectId: string, artifactId: string) {
  const { data: stakeholders, error } = await supabase
    .from("stakeholders")
    .select("id, name, role, influence_level, contact_info, name_key")
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .order("name", { ascending: true });

  if (error) throw new Error(error.message);

  const content_json = buildStakeholderRegisterContentJson(stakeholders ?? []);

  const { error: updErr } = await supabase
    .from("artifacts")
    .update({
      content_json,
      title: "Stakeholder Register",
    })
    .eq("id", artifactId)
    .eq("project_id", projectId);

  if (updErr) throw new Error(updErr.message);

  return { content_json };
}

/* ----------------------------------------
   DELETE /api/stakeholders/:id?projectId=...&artifactId=...
---------------------------------------- */

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const supabase = await createClient();

  try {
    const params = await Promise.resolve(ctx.params as any);
    const stakeholderId = safeParam(params?.id).trim();

    const url = new URL(req.url);
    const projectId = safeParam(url.searchParams.get("projectId")).trim();
    const artifactId = safeParam(url.searchParams.get("artifactId")).trim();

    if (!stakeholderId) return jsonError("Missing id", 400);
    if (!isUuid(stakeholderId)) return jsonError("Invalid id", 400);

    if (!projectId) return jsonError("Missing projectId", 400);
    if (!isUuid(projectId)) return jsonError("Invalid projectId", 400);

    if (!artifactId) return jsonError("Missing artifactId", 400);
    if (!isUuid(artifactId)) return jsonError("Invalid artifactId", 400);

    // 1) auth
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonError(authErr.message, 401);
    if (!auth?.user) return jsonError("Unauthorized", 401);

    // 2) membership + role (project-level) — hide existence for non-members
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role, removed_at")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (memErr) return jsonError(memErr.message, 403);
    if (!mem) return jsonError("Not found", 404);

    const role = normalizeRole((mem as any).role);
    if (!canDelete(role)) return jsonError("Forbidden", 403);

    // 3) delete scoped to (id + project_id + artifact_id)
    const { data: deleted, error: delErr } = await supabase
      .from("stakeholders")
      .delete()
      .eq("id", stakeholderId)
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId)
      .select("id")
      .maybeSingle();

    if (delErr) return jsonError(delErr.message, 403);

    if (!deleted) return jsonError("Not found", 404);

    // ✅ CRITICAL: keep artifacts.content_json in sync so exports/UI don't go stale
    try {
      await syncArtifactContentJson(supabase, projectId, artifactId);
    } catch (e: any) {
      // If delete succeeded but sync failed, return 200 but surface warning.
      // (Prevents UI feeling "delete failed" when it actually succeeded.)
      return NextResponse.json(
        { ok: true, deleted_id: stakeholderId, warning: "Deleted, but failed to sync artifact content_json", sync_error: String(e?.message ?? e) },
        { status: 200 }
      );
    }

    // Optional AI event (non-blocking)
    try {
      await fetch(new URL("/api/ai/events", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          artifactId,
          eventType: "stakeholder_deleted",
          severity: "info",
          source: "app",
          payload: { target_artifact_type: "stakeholder_register", stakeholderId },
        }),
      }).catch(() => null);
    } catch {}

    return NextResponse.json({ ok: true, deleted_id: stakeholderId }, { status: 200 });
  } catch (e: any) {
    return jsonError(String(e?.message ?? "Unknown error"), 500);
  }
}
