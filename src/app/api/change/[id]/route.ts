// src/app/api/change/[id]/route.ts
import "server-only";

import { NextResponse } from "next/server";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  safeStr,
  normalizeImpactAnalysis,
  logChangeEvent,
  getApprovalProgressForArtifact,
} from "@/lib/change/server-helpers";
import { computeChangeAIFields } from "@/lib/change/ai-compute";

export const runtime = "nodejs";

const TABLE = "change_requests";

// FIX: Updated type to match Next.js 15+ async params
type Ctx = { params: Promise<{ id: string }> };

/* =========================
   Response helpers
========================= */

function ok(data: any, init?: ResponseInit) {
  const item = (data && (data.item ?? data.data)) || null;
  const id = item?.id ?? data?.id ?? null;
  return NextResponse.json({ ok: true, ...data, ...(id ? { id } : {}) }, init);
}

function err(message: string, init?: ResponseInit & { extra?: any; code?: string }) {
  const { extra, code, ...rest } = init || {};
  return NextResponse.json(
    { ok: false, error: message, ...(code ? { code } : {}), ...(extra ? { extra } : {}) },
    rest
  );
}

/* =========================
   Small utils
========================= */

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function isObj(v: any) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function hasOwn(obj: any, key: string) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}

function asTags(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((v) => safeStr(v).trim())
    .filter(Boolean)
    .slice(0, 25);
}

function isMissingRelation(errMsg: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
}

function normalizePriorityToDb(p: unknown): "Low" | "Medium" | "High" | "Critical" {
  const v = safeStr(p).trim().toLowerCase();
  if (v === "low") return "Low";
  if (v === "high") return "High";
  if (v === "critical") return "Critical";
  return "Medium";
}

const ALLOWED_DELIVERY = new Set(["intake", "analysis", "review", "in_progress", "implemented", "closed"]);

function normalizeDeliveryStatus(x: unknown): string | null {
  const v = safeStr(x).trim().toLowerCase();
  if (!v) return null;
  const norm = v === "in-progress" || v === "in progress" ? "in_progress" : v;
  return ALLOWED_DELIVERY.has(norm) ? norm : null;
}

function isBadIdString(x: string) {
  const v = safeStr(x).trim().toLowerCase();
  return !v || v === "null" || v === "undefined";
}

/**
 * Resolve change id from:
 * 1) ctx.params.id (Next route param) - NOW ASYNC
 * 2) URL path segment after "/change/"
 * 3) body.id / body.change_id
 */
async function pickId(req: Request, ctx: Ctx | undefined, body: any): Promise<string | null> {
  // 1) Next route params (now async)
  if (ctx?.params) {
    const params = await ctx.params;
    const p = safeStr(params?.id).trim();
    if (!isBadIdString(p)) return p;
  }

  // 2) URL path: /api/change/<id>  OR  /api/change/<id>/...
  try {
    const pathname = new URL(req.url).pathname || "";
    const parts = pathname.split("/").filter(Boolean);

    const last = parts[parts.length - 1] || "";
    if (last.toLowerCase() !== "change" && !isBadIdString(last)) return last;

    const idx = parts.findIndex((x) => String(x).toLowerCase() === "change");
    if (idx !== -1 && parts[idx + 1]) {
      const candidate = safeStr(parts[idx + 1]).trim();
      if (!isBadIdString(candidate) && candidate.toLowerCase() !== "change") return candidate;
    }
  } catch {
    // ignore
  }

  // 3) Body fallback
  const b = safeStr(body?.id ?? body?.change_id).trim();
  if (!isBadIdString(b)) return b;

  return null;
}

// ... rest of the file remains the same until the route handlers ...

/* =========================
   DELETE
========================= */

/* =========================
   GET (single OR project board)
========================= */

export async function GET(req: Request, ctx: Ctx) {
  try {
    const supabase = sb(req);
    const user = await requireUser(supabase);

    const id = await pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    // 1) Try: treat as SINGLE change_request id
    {
      const { data: change, error: chErr } = await supabase
        .from(TABLE)
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (chErr) {
        // handle missing table nicely (mis-migration / wrong env)
        if (isMissingRelation(chErr.message)) {
          return err("Database table missing: change_requests", {
            status: 500,
            code: "missing_relation",
            extra: { table: TABLE },
          });
        }
        return err(chErr.message || "Failed to load change", {
          status: 500,
          code: "db_error",
        });
      }

      if (change) {
        // ✅ authorise against the project the change belongs to
        await requireProjectRole(supabase, user.id, change.project_id, "viewer");

        // keep your existing shaping/AI/approvals logic (safe to call now)
        const normalized = normalizeImpactAnalysis(change);
        const approvals = await getApprovalProgressForArtifact(supabase, change.id).catch(
          () => null
        );

        return ok({
          mode: "change",
          item: normalized,
          approvals,
        });
      }
    }

    // 2) Otherwise: treat as PROJECT scope (uuid project_id OR human project_code)
    let projectId: string | null = null;

    // if it looks like UUID, assume it's a project id
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      projectId = id;
    } else {
      // project code lookup (if you use project_code / human ids)
      const { data: proj, error: projErr } = await supabase
        .from("projects")
        .select("id, project_code, title")
        .eq("project_code", id)
        .maybeSingle();

      if (projErr) {
        return err(projErr.message || "Failed to resolve project", {
          status: 500,
          code: "db_error",
        });
      }
      projectId = proj?.id ?? null;
    }

    if (!projectId) {
      return err("Not found", { status: 404, code: "not_found" });
    }

    await requireProjectRole(supabase, user.id, projectId, "viewer");

    const { data: items, error: itemsErr } = await supabase
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (itemsErr) {
      if (isMissingRelation(itemsErr.message)) {
        return err("Database table missing: change_requests", {
          status: 500,
          code: "missing_relation",
          extra: { table: TABLE },
        });
      }
      return err(itemsErr.message || "Failed to load changes", {
        status: 500,
        code: "db_error",
      });
    }

    // optional: compute AI fields in a safe way (don’t let it throw the whole route)
    let withAI = items ?? [];
    try {
      withAI = (items ?? []).map((it: any) => {
        try {
          return computeChangeAIFields(it);
        } catch {
          return it;
        }
      });
    } catch {
      // ignore
    }

    return ok({
      mode: "project",
      project_id: projectId,
      items: withAI,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, {
      status,
      code: status === 401 ? "unauthorized" : "server_error",
    });
  }
}