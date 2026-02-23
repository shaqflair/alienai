// src/app/api/notifications/route.ts
import "server-only";

import { NextResponse } from "next/server";
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

function ok(data: any, status = 200) {
  return noStore(NextResponse.json({ ok: true, ...data }, { status }));
}

function err(message: string, status = 400, meta?: any) {
  return noStore(
    NextResponse.json(
      { ok: false, error: message, ...(meta ? { meta } : {}) },
      { status }
    )
  );
}

function clampInt(x: string | null, def: number, min: number, max: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function parseUnreadFlag(v: string | null) {
  const s = safeStr(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function toIsoOrNull(s: string | null) {
  const v = safeStr(s).trim();
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function todayYmdUtc() {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isObj(x: any): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function getMetaProjectId(md: any) {
  const m = isObj(md) ? md : {};
  return (
    safeStr(m.project_id).trim() ||
    safeStr(m.projectId).trim() ||
    safeStr(m.project_uuid).trim() ||
    safeStr(m.projectUuid).trim() ||
    ""
  );
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
 * Enrich notification items so UI can show project_code + title (instead of UUID / "Project").
 * (No DB writes; best-effort.)
 */
async function hydrateProjectMeta(supabase: any, itemsRaw: any[] | null | undefined) {
  const list = Array.isArray(itemsRaw) ? itemsRaw : [];

  const needByIndex = new Map<number, string>(); // index -> projectId
  const missingProjectViaArtifact: { index: number; artifactId: string }[] = [];

  for (let i = 0; i < list.length; i++) {
    const n = list[i];
    const pidRow = safeStr(n?.project_id).trim();
    const pidMeta = getMetaProjectId(n?.metadata);
    const pid = pidRow || pidMeta;

    if (pid) {
      needByIndex.set(i, pid);
    } else {
      const aid = safeStr(n?.artifact_id).trim();
      if (aid) missingProjectViaArtifact.push({ index: i, artifactId: aid });
    }
  }

  // Resolve missing project IDs via artifacts (best-effort)
  let artifactResolveMeta: any = { resolvedFromArtifacts: 0 };

  if (missingProjectViaArtifact.length > 0) {
    const artifactIds = Array.from(
      new Set(missingProjectViaArtifact.map((x) => x.artifactId).filter(Boolean))
    );

    try {
      const { data: artifacts, error: artErr } = await supabase
        .from("artifacts")
        .select("id, project_id")
        .in("id", artifactIds);

      if (!artErr && Array.isArray(artifacts)) {
        const artMap = new Map<string, string>();
        for (const a of artifacts) {
          const aid = safeStr(a?.id).trim();
          const pid = safeStr(a?.project_id).trim();
          if (aid && pid) artMap.set(aid, pid);
        }

        let resolved = 0;
        for (const x of missingProjectViaArtifact) {
          const pid = artMap.get(x.artifactId);
          if (pid) {
            needByIndex.set(x.index, pid);
            resolved++;
          }
        }
        artifactResolveMeta = { resolvedFromArtifacts: resolved };
      } else if (artErr) {
        artifactResolveMeta = { resolvedFromArtifacts: 0, artifactsLookupError: artErr.message };
      }
    } catch (e: any) {
      artifactResolveMeta = {
        resolvedFromArtifacts: 0,
        artifactsLookupError: safeStr(e?.message) || "artifact lookup failed",
      };
    }
  }

  const projectIds = Array.from(new Set(Array.from(needByIndex.values()).filter(Boolean)));
  if (projectIds.length === 0) {
    return { items: list, meta: { hydratedProjects: 0, ...artifactResolveMeta } };
  }

  let hydrateError: string | null = null;
  const byId = new Map<string, { project_code?: string; project_name?: string }>();

  try {
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id, project_code, title")
      .in("id", projectIds);

    if (projErr) {
      hydrateError = projErr.message;
    } else {
      for (const p of Array.isArray(projects) ? projects : []) {
        const pid = safeStr(p?.id).trim();
        if (!pid) continue;

        const code = safeStr(p?.project_code).trim();
        const name = safeStr(p?.title).trim();

        byId.set(pid, {
          project_code: code || undefined,
          project_name: name || undefined,
        });
      }
    }
  } catch (e: any) {
    hydrateError = safeStr(e?.message) || "projects lookup failed";
  }

  if (byId.size === 0) {
    return {
      items: list,
      meta: {
        hydratedProjects: 0,
        ...(hydrateError ? { hydrateError } : {}),
        ...artifactResolveMeta,
      },
    };
  }

  const enriched = list.map((n, idx) => {
    const pid =
      safeStr(n?.project_id).trim() ||
      getMetaProjectId(n?.metadata) ||
      safeStr(needByIndex.get(idx)).trim();

    if (!pid) return n;

    const p = byId.get(pid);
    if (!p) return n;

    const md = isObj(n?.metadata) ? { ...n.metadata } : {};

    if (!safeStr(md.project_code || md.projectCode || md.project_code_text).trim() && p.project_code) {
      md.project_code = p.project_code;
    }
    if (!safeStr(md.project_name || md.projectName || md.project_title || md.projectTitle).trim() && p.project_name) {
      md.project_name = p.project_name;
    }

    return {
      ...n,
      project_id: safeStr(n?.project_id).trim() ? n.project_id : pid,
      metadata: md,
    };
  });

  return {
    items: enriched,
    meta: {
      hydratedProjects: byId.size,
      ...(hydrateError ? { hydrateError } : {}),
      ...artifactResolveMeta,
    },
  };
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return err("Unauthorized", 401);
    if (!auth?.user) return err("Unauthorized", 401);

    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 30, 1, 200);
    const unreadOnly = parseUnreadFlag(url.searchParams.get("unread"));

    const beforeRaw = url.searchParams.get("before");
    const beforeIso = toIsoOrNull(beforeRaw);

    const debug = debugEnabled(req, url);

    let q = supabase
      .from("notifications")
      .select(
        [
          "id",
          "user_id",
          "project_id",
          "artifact_id",
          "type",
          "title",
          "body",
          "link",
          "is_read",
          "created_at",
          "actor_user_id",
          "metadata",
          "source_type",
          "source_id",
          "due_date",
          "bucket",
        ].join(",")
      )
      .eq("user_id", auth.user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (unreadOnly) q = q.eq("is_read", false);
    if (beforeIso) q = q.lt("created_at", beforeIso);

    const { data: itemsRaw, error: listErr } = await q;
    if (listErr) {
      console.error("[notifications] list failed:", listErr);
      return err("Failed to load notifications", 500);
    }

    const { items, meta: hydrateMeta } = await hydrateProjectMeta(supabase, itemsRaw);

    // Unread count (count-only)
    let unreadCount = 0;
    let unreadCountMode: "exact" | "fallback_rows" | "fallback_items" = "exact";

    const { count, error: cntErr } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", auth.user.id)
      .eq("is_read", false);

    if (cntErr) {
      console.error("[notifications] unread count failed:", cntErr);
      return err("Failed to load notifications", 500);
    }

    if (typeof count === "number") {
      unreadCount = count;
    } else {
      const { data: rows, error: fbErr } = await supabase
        .from("notifications")
        .select("id")
        .eq("user_id", auth.user.id)
        .eq("is_read", false)
        .limit(500);

      if (fbErr) {
        console.error("[notifications] unread fallback failed:", fbErr);
        return err("Failed to load notifications", 500);
      }

      unreadCount = Array.isArray(rows) ? rows.length : 0;
      unreadCountMode = "fallback_rows";

      if (!unreadCount) {
        unreadCount = Array.isArray(items)
          ? items.filter((n: any) => n?.is_read !== true).length
          : 0;
        unreadCountMode = "fallback_items";
      }
    }

    let meta: any = {
      unreadOnly,
      limit,
      before: beforeIso,
      unreadCountMode,
      ...hydrateMeta,
    };

    // Debug-only meta (gated)
    if (debug) {
      const ymd = todayYmdUtc();

      const { count: totalForUser, error: totalErr } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.user.id);

      if (totalErr) {
        console.error("[notifications] debug totalForUser failed:", totalErr);
        // still return normal payload; don't fail request
      }

      const { count: overdueUnread, error: overdueErr } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", auth.user.id)
        .eq("is_read", false)
        .or(`bucket.eq.overdue,and(due_date.not.is.null,due_date.lt.${ymd})`);

      if (overdueErr) {
        console.error("[notifications] debug overdueUnread failed:", overdueErr);
        // still return normal payload; don't fail request
      }

      meta = {
        ...meta,
        debug: true,
        authUserId: auth.user.id,
        totalForUser: Number(totalForUser ?? 0),
        unreadForUser: Number(unreadCount ?? 0),
        overdueUnreadForUser: Number(overdueUnread ?? 0),
        todayYmdUtc: ymd,
      };
    }

    return ok({
      unreadCount: Number(unreadCount ?? 0),
      items: Array.isArray(items) ? items : [],
      meta,
    });
  } catch (e: any) {
    console.error("[notifications] server error:", e);
    return err("Unexpected error", 500);
  }
}