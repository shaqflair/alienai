// src/app/api/artifacts/[id]/clone/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isMissingColumnError(msg: string, column: string) {
  const m = safeLower(msg);
  return m.includes("column") && m.includes(column.toLowerCase()) && m.includes("does not exist");
}

/**
 * Resolve either:
 *  - artifacts.id (uuid)
 *  - artifacts.public_id (human id / short id)
 *
 * This function is defensive:
 * - If `public_id` column does not exist, it will not throw; it will just return null.
 */
async function resolveArtifactUuid(supabase: any, rawId: string) {
  const id = safeStr(rawId).trim();
  if (!id) return null;

  if (looksLikeUuid(id)) return id;

  // Try resolve via public_id (if exists)
  const { data, error } = await supabase
    .from("artifacts")
    .select("id")
    .eq("public_id", id)
    .maybeSingle();

  if (error) {
    // If your table does not have public_id, don't 500 — just treat as not resolvable
    if (isMissingColumnError(error.message, "public_id")) return null;
    throw new Error(error.message);
  }

  return data?.id ?? null;
}

/* ---------------- auth ---------------- */

async function requireOwnerOrEditor(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem || mem.is_active === false) throw new Error("Forbidden");

  const role = safeLower(mem.role);
  if (role !== "owner" && role !== "editor") throw new Error("Forbidden");

  return auth.user;
}

/* ---------------- route ---------------- */

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  const traceId = `clone_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  try {
    const { id } = await ctx.params;
    const incoming = safeStr(id).trim();
    if (!incoming) return jsonErr("Missing artifact id", 400, { traceId });

    const supabase = await createClient();

    // Resolve the incoming identifier to the real UUID row id
    const artifactUuid = await resolveArtifactUuid(supabase, incoming);
    if (!artifactUuid) {
      // If it wasn't a UUID and public_id doesn't exist / didn't match, 404 instead of 500
      return jsonErr("Artifact not found (id not resolvable)", 404, { traceId, incoming });
    }

    // Load source artifact
    const { data: src, error: srcErr } = await supabase
      .from("artifacts")
      .select("*")
      .eq("id", artifactUuid)
      .single();

    if (srcErr) return jsonErr("Failed to load artifact", 500, { traceId, message: srcErr.message });
    if (!src) return jsonErr("Artifact not found", 404, { traceId, artifactUuid });

    // Permission check (expects src.project_id)
    const projectId = safeStr((src as any).project_id).trim();
    if (!projectId) return jsonErr("Artifact missing project_id", 500, { traceId, artifactUuid });
    await requireOwnerOrEditor(supabase, projectId);

    // Optional: allow client to request a custom suffix/title override
    let requestedTitleSuffix = "";
    try {
      const body = await req.json().catch(() => null);
      if (body && typeof body.titleSuffix === "string") {
        requestedTitleSuffix = body.titleSuffix.trim();
      }
    } catch {
      // ignore
    }

    const baseTitle = safeStr((src as any).title).trim();
    const suffix = requestedTitleSuffix ? requestedTitleSuffix : "Copy";

    // Build clone row (copy safe columns only)
    // IMPORTANT: Copy only what your schema definitely supports.
    const cloneRow: any = {
      project_id: (src as any).project_id,
      ui_kind: (src as any).ui_kind ?? null,
      title: baseTitle ? `${baseTitle} (${suffix})` : `(${suffix})`,
      content: (src as any).content ?? null,
    };

    // If you have extra columns you want copied, add them carefully here:
    // if ("phase" in src) cloneRow.phase = (src as any).phase;
    // if ("category" in src) cloneRow.category = (src as any).category;

    // Remove anything that must be unique or generated (defensive)
    delete cloneRow.id;
    delete cloneRow.public_id;
    delete cloneRow.created_at;
    delete cloneRow.updated_at;

    const { data: created, error: insErr } = await supabase
      .from("artifacts")
      .insert(cloneRow)
      .select("id, public_id, title, ui_kind, project_id")
      .single();

    if (insErr) {
      return jsonErr("Clone insert failed", 500, {
        traceId,
        message: insErr.message,
        hint: (insErr as any).hint,
        code: (insErr as any).code,
      });
    }

    return jsonOk({ traceId, artifact: created }, 200);
  } catch (e: any) {
    const msg = safeStr(e?.message || e);
    const lower = msg.toLowerCase();

    const status = lower.includes("unauthorized")
      ? 401
      : lower.includes("forbidden")
      ? 403
      : 500;

    console.error("ARTIFACT CLONE ERROR:", { traceId, error: e });

    return jsonErr("Clone failed", status, {
      traceId,
      message: msg,
      // helpful when debugging locally; safe enough for dev
      stack: safeStr(e?.stack || ""),
    });
  }
}
