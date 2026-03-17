// src/app/api/artifacts/[id]/timeline/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function noStore(res: NextResponse) {
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function jsonOk(data: any, status = 200) {
  return noStore(NextResponse.json({ ok: true, ...data }, { status }));
}

function jsonErr(error: string, status = 400, details?: any) {
  return noStore(NextResponse.json({ ok: false, error, details }, { status }));
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function clampLimit(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  const v = Math.trunc(n);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * Debug toggle:
 * - Non-prod: ?debug=1 works
 * - Prod: requires ALLOW_DEBUG_ROUTES=1 and x-aliena-debug-secret === DEBUG_ROUTE_SECRET
 */
function debugEnabled(req: Request, url: URL) {
  const wants = safeStr(url.searchParams.get("debug")).trim() === "1";
  if (!wants) return false;

  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return true;

  const allowProdDebug = safeStr(process.env.ALLOW_DEBUG_ROUTES).trim() === "1";
  if (!allowProdDebug) return false;

  const expected = safeStr(process.env.DEBUG_ROUTE_SECRET).trim();
  const got = safeStr(req.headers.get("x-aliena-debug-secret")).trim();
  return Boolean(expected) && got === expected;
}

/**
 * GET /api/artifacts/:id/timeline?limit=60
 *
 * Access rules (kept simple + fast):
 * - Must be authenticated
 * - Must be either an active project member OR an active org member for the project's org
 * - Then query artifact_audit_log scoped to (project_id, artifact_id)
 *
 * Includes a small debug block you can enable with ?debug=1 to confirm cookie/session wiring.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id?: string }> }
) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr)
      return jsonErr("Auth error", 401, {
        message: authErr.message,
        code: authErr.code,
      });
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const { id } = await ctx.params;
    const artifactId = safeStr(id).trim();
    if (!artifactId || !looksLikeUuid(artifactId))
      return jsonErr("Invalid artifactId", 400);

    const url = new URL(req.url);
    const limit = clampLimit(Number(url.searchParams.get("limit") ?? "60"), 10, 400);
    const debug = debugEnabled(req, url);

    // Optional debug: confirms whether the request includes cookies/session
    if (debug) {
      const { data: sess } = await supabase.auth.getSession();
      return jsonOk({
        debug: true,
        artifactId,
        userId: auth.user.id,
        hasSession: !!sess?.session,
        // IMPORTANT: do NOT include tokens; only boolean presence is safe
        accessTokenPresent: !!sess?.session?.access_token,
      });
    }

    // 1) Resolve project_id (+ organisation_id) from artifact (RLS still applies)
    const { data: a0, error: a0Err } = await supabase
      .from("artifacts")
      .select("id, project_id, projects:projects!artifacts_project_id_fkey(id, organisation_id)")
      .eq("id", artifactId)
      .maybeSingle();

    if (a0Err)
      return jsonErr("Failed to load artifact", 500, {
        message: a0Err.message,
        code: a0Err.code,
      });
    if (!a0?.project_id) return jsonErr("Artifact not found", 404);

    const projectId = String((a0 as any).project_id);
    const organisationId =
      safeStr((a0 as any)?.projects?.organisation_id).trim() || null;

    // 2) Gate by project membership OR org membership
    let isProjectMember = false;
    let isOrgMember = false;

    const { data: pm, error: pmErr } = await supabase
      .from("project_members")
      .select("role, removed_at")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (pmErr)
      return jsonErr("Membership check failed", 500, {
        message: pmErr.message,
        code: pmErr.code,
      });
    if (pm) isProjectMember = true;

    if (!isProjectMember && organisationId) {
      const { data: om, error: omErr } = await supabase
        .from("organisation_members")
        .select("role, removed_at")
        .eq("organisation_id", organisationId)
        .eq("user_id", auth.user.id)
        .is("removed_at", null)
        .maybeSingle();

      if (omErr)
        return jsonErr("Org membership check failed", 500, {
          message: omErr.message,
          code: omErr.code,
        });
      if (om) isOrgMember = true;
    }

    if (!isProjectMember && !isOrgMember) return jsonErr("Not found", 404);

    // 3) Fetch timeline rows (IMPORTANT: filter by project_id too)
    const { data: rowsRaw, error: rowsErr } = await supabase
      .from("artifact_audit_log")
      .select(
        [
          "id",
          "created_at",
          "project_id",
          "artifact_id",
          "actor_id",
          "actor_email",
          "action",
          "table_name",
          "row_pk",
          "changed_columns",
          "content_json_paths",
          "request_id",
          "route",
          "summary",
          "before",
          "after",
          "section",
          "action_label",
          "save_key",
        ].join(", ")
      )
      .eq("project_id", projectId)
      .eq("artifact_id", artifactId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (rowsErr) {
      // Avoid leaking details to non-debug callers; log server-side only.
      console.error("[timeline] query failed:", rowsErr);
      return jsonErr("Timeline query failed", 403);
    }

    const rows = Array.isArray(rowsRaw) ? rowsRaw : [];

    // 4) Backfill missing actor_email from public.profiles (best-effort)
    const missingActorIds = Array.from(
      new Set(
        rows
          .filter((r: any) => !safeStr(r?.actor_email).trim())
          .map((r: any) => safeStr(r?.actor_id).trim())
          .filter((x) => looksLikeUuid(x))
      )
    ).slice(0, 500);

    if (missingActorIds.length > 0) {
      try {
        // Try profiles.user_id first
        const { data: p1, error: p1Err } = await supabase
          .from("profiles")
          .select("user_id, email, full_name")
          .in("user_id", missingActorIds);

        if (!p1Err && Array.isArray(p1) && p1.length) {
          const emailByUserId = new Map<string, string>();
          for (const p of p1) {
            const uid = safeStr((p as any)?.user_id).trim();
            const email = safeStr((p as any)?.email).trim();
            if (uid && email) emailByUserId.set(uid, email);
          }

          for (const r of rows as any[]) {
            if (safeStr(r?.actor_email).trim()) continue;
            const aid = safeStr(r?.actor_id).trim();
            const email = emailByUserId.get(aid);
            if (email) r.actor_email = email;
          }
        } else {
          // Fallback profiles.id
          const { data: p2, error: p2Err } = await supabase
            .from("profiles")
            .select("id, email, full_name")
            .in("id", missingActorIds);

          if (!p2Err && Array.isArray(p2) && p2.length) {
            const emailById = new Map<string, string>();
            for (const p of p2) {
              const pid = safeStr((p as any)?.id).trim();
              const email = safeStr((p as any)?.email).trim();
              if (pid && email) emailById.set(pid, email);
            }

            for (const r of rows as any[]) {
              if (safeStr(r?.actor_email).trim()) continue;
              const aid = safeStr(r?.actor_id).trim();
              const email = emailById.get(aid);
              if (email) r.actor_email = email;
            }
          }
        }
      } catch {
        // best-effort; ignore
      }
    }

    return jsonOk({
      artifactId,
      projectId,
      organisationId,
      limit,
      isProjectMember,
      isOrgMember,
      rows,
    });
  } catch (e: any) {
    return jsonErr("Server error", 500, { message: String(e?.message ?? e) });
  }
}