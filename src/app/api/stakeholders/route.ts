// src/app/api/stakeholders/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ----------------------------------------
   Helpers
---------------------------------------- */

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x ?? "").trim());
}

type MemberRole = "viewer" | "editor" | "admin" | "owner";
function normalizeRole(role: unknown): MemberRole {
  const r = String(role ?? "viewer").toLowerCase();
  if (r === "owner" || r === "admin" || r === "editor" || r === "viewer") return r;
  return "viewer";
}
function canRead(_role: MemberRole) {
  return true;
}
function canWrite(role: MemberRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

/**
 * Name-key for uniqueness within an artifact register.
 * Must match UNIQUE index: (artifact_id, name_key)
 */
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

function normalizeInfluenceDb(x: unknown): "high" | "medium" | "low" {
  const s = String(x ?? "").toLowerCase();
  if (s === "high") return "high";
  if (s === "low") return "low";
  return "medium";
}

type SaveMode = "upsert" | "replace";
function normalizeMode(x: unknown): SaveMode {
  const s = String(x ?? "").toLowerCase();
  return s === "replace" ? "replace" : "upsert";
}

async function requireAuthAndMembership(projectId: string) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) return { supabase, user: null as any, role: null as any };

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);

  return {
    supabase,
    user: auth.user,
    role: mem ? normalizeRole((mem as any).role) : null,
  };
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

/**
 * ✅ IMPORTANT:
 * Exporters currently expect: { version: 1, type: "stakeholder_register", rows: [...] }
 */
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

  return {
    version: 1,
    type: "stakeholder_register",
    rows,
  };
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

  return { content_json, stakeholders: stakeholders ?? [] };
}

/* ----------------------------------------
   GET stakeholders
---------------------------------------- */
/**
 * GET /api/stakeholders?projectId=...&artifactId=...
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    if (!isUuid(projectId)) return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });

    if (!artifactId) return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });
    if (!isUuid(artifactId)) return NextResponse.json({ ok: false, error: "Invalid artifactId" }, { status: 400 });

    const { supabase, user, role } = await requireAuthAndMembership(projectId);
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!role || !canRead(role)) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("stakeholders")
      .select(
        "id, project_id, artifact_id, name, role, influence_level, contact_info, expectations, communication_strategy, created_at, updated_at, name_key"
      )
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId)
      .order("name", { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, stakeholders: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

/* ----------------------------------------
   POST stakeholders (UPSERT or REPLACE)
---------------------------------------- */
/**
 * POST /api/stakeholders
 * Body: { projectId, artifactId, items: [...], mode?: "upsert" | "replace" }
 *
 * mode:
 *  - "upsert" (default): inserts/updates submitted items; does NOT delete anything.
 *  - "replace": inserts/updates submitted items AND deletes any existing rows for the artifact not in the submitted list.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const artifactId = safeStr(body?.artifactId).trim();
    const mode = normalizeMode(body?.mode);
    const items = Array.isArray(body?.items) ? body.items : [];

    if (items.length > 5000) {
      return NextResponse.json({ ok: false, error: "Too many items (max 5000)" }, { status: 413 });
    }

    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    if (!isUuid(projectId)) return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });

    if (!artifactId) return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });
    if (!isUuid(artifactId)) return NextResponse.json({ ok: false, error: "Invalid artifactId" }, { status: 400 });

    const { supabase, user, role } = await requireAuthAndMembership(projectId);
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!role) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!canWrite(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // ✅ Build candidate rows (including optional id)
    const candidates = items
      .map((it: any) => {
        const name = String(it?.name ?? "").trim();
        if (!name) return null;

        const incomingId = isUuid(String(it?.id ?? "")) ? String(it.id) : null;

        // Allow client to send name_key, but always normalise server-side for correctness.
        const rawKey = String(it?.name_key ?? name);
        const name_key = slugNameKey(rawKey);

        const contact_info =
          it?.contact_info && typeof it.contact_info === "object" && !Array.isArray(it.contact_info)
            ? it.contact_info
            : {};

        return {
          id: incomingId ?? undefined,
          project_id: projectId,
          artifact_id: artifactId,
          name,
          role: String(it?.role ?? "").trim() || null,
          influence_level: normalizeInfluenceDb(it?.influence_level),
          expectations: it?.expectations ?? null,
          communication_strategy: it?.communication_strategy ?? null,
          contact_info,
          name_key,
        };
      })
      .filter(Boolean) as any[];

    // If replace mode and no valid candidates, interpret as "clear register"
    if (mode === "replace" && candidates.length === 0) {
      const { error: delErr } = await supabase
        .from("stakeholders")
        .delete()
        .eq("project_id", projectId)
        .eq("artifact_id", artifactId);

      if (delErr) throw new Error(delErr.message);

      await syncArtifactContentJson(supabase, projectId, artifactId);

      // Fire AI event (non-blocking)
      try {
        await fetch(new URL("/api/ai/events", req.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            artifactId,
            eventType: "stakeholders_saved",
            severity: "info",
            source: "app",
            payload: { target_artifact_type: "stakeholder_register", saved: 0, mode },
          }),
        }).catch(() => null);
      } catch {}

      return NextResponse.json({ ok: true, saved: 0, rows: [], mode, cleared: true }, { status: 200 });
    }

    if (candidates.length === 0) {
      await syncArtifactContentJson(supabase, projectId, artifactId);
      return NextResponse.json({ ok: true, saved: 0, rows: [], mode }, { status: 200 });
    }

    /**
     * ✅ CRITICAL FIX:
     * Your client sends existing DB ids for edits, but your old server ignored them and upserted by (artifact_id,name_key),
     * which causes "rename" to insert new rows.
     *
     * Approach:
     * 1) Fetch existing rows for this artifact and map name_key -> id
     * 2) For any candidate with no id, if name_key already exists, attach its id
     * 3) Upsert by primary key (id) so edits update the same row.
     */
    const { data: existing, error: exErr } = await supabase
      .from("stakeholders")
      .select("id, name_key")
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId);

    if (exErr) throw new Error(exErr.message);

    const existingByKey = new Map<string, string>();
    for (const r of existing ?? []) {
      const k = String((r as any)?.name_key ?? "").trim();
      const id = String((r as any)?.id ?? "").trim();
      if (k && id) existingByKey.set(k, id);
    }

    const upserts = candidates.map((r) => {
      const k = String(r?.name_key ?? "").trim();
      if (!r.id && k && existingByKey.has(k)) {
        return { ...r, id: existingByKey.get(k)! };
      }
      return r;
    });

    // ✅ Upsert by id (PK). Unique (artifact_id,name_key) still protects duplicates.
    const { data: savedRows, error: upErr } = await supabase
      .from("stakeholders")
      .upsert(upserts, { onConflict: "id" })
      .select("id, name, name_key");

    if (upErr) {
      const msg = String(upErr.message ?? upErr);
      // make the common unique error friendlier for the UI
      if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
        throw new Error("Duplicate stakeholder name detected. Each stakeholder name must be unique within this register.");
      }
      throw new Error(msg);
    }

    // If replace, delete anything not in keep set (use ids to avoid fragile SQL-string quoting)
    if (mode === "replace") {
      const keepIds = Array.from(
        new Set((savedRows ?? []).map((r: any) => String(r?.id ?? "").trim()).filter((x: string) => isUuid(x)))
      );

      if (keepIds.length) {
        const { error: delErr } = await supabase
          .from("stakeholders")
          .delete()
          .eq("project_id", projectId)
          .eq("artifact_id", artifactId)
          .not("id", "in", `(${keepIds.map((id) => `"${id}"`).join(",")})`);

        if (delErr) throw new Error(delErr.message);
      } else {
        // Safety: if nothing kept, do not mass-delete unexpectedly
      }
    }

    // ✅ Update artifacts.content_json so exports render correctly
    await syncArtifactContentJson(supabase, projectId, artifactId);

    // Fire AI event (non-blocking)
    try {
      await fetch(new URL("/api/ai/events", req.url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          artifactId,
          eventType: "stakeholders_saved",
          severity: "info",
          source: "app",
          payload: {
            target_artifact_type: "stakeholder_register",
            saved: (savedRows ?? []).length,
            mode,
          },
        }),
      }).catch(() => null);
    } catch {}

    return NextResponse.json({ ok: true, saved: (savedRows ?? []).length, rows: savedRows ?? [], mode }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

/* ----------------------------------------
   DELETE stakeholders
---------------------------------------- */
/**
 * DELETE /api/stakeholders?projectId=...&artifactId=...
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    if (!isUuid(projectId)) return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });

    if (!artifactId) return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });
    if (!isUuid(artifactId)) return NextResponse.json({ ok: false, error: "Invalid artifactId" }, { status: 400 });

    const { supabase, user, role } = await requireAuthAndMembership(projectId);
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!role) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!canWrite(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const { error } = await supabase
      .from("stakeholders")
      .delete()
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId);

    if (error) throw new Error(error.message);

    await syncArtifactContentJson(supabase, projectId, artifactId);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

