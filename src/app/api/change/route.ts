// src/app/api/change/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABLE = "change_requests";

/* ---------------- headers ---------------- */

const NO_STORE_HEADERS: HeadersInit = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
};

/* ---------------- helpers ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function jsonError(message: string, status = 400, extra?: any, headers?: HeadersInit) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { extra } : {}) },
    { status, headers }
  );
}

function jsonOk(data: any, status = 200, headers?: HeadersInit) {
  return NextResponse.json({ ok: true, ...data }, { status, headers });
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function normalizePriority(p: unknown): "Low" | "Medium" | "High" | "Critical" {
  const v = safeStr(p).toLowerCase();
  if (v === "low") return "Low";
  if (v === "high") return "High";
  if (v === "critical") return "Critical";
  return "Medium";
}

function normalizeTags(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((t) => safeStr(t))
    .filter(Boolean)
    .slice(0, 25);
}

function normalizeImpactAnalysis(body: any): any {
  const ia = body?.impact_analysis ?? body?.impactAnalysis ?? body?.aiImpact;
  if (ia && typeof ia === "object" && !Array.isArray(ia)) return ia;
  return {};
}

const ALLOWED_DELIVERY = new Set([
  "intake",
  "analysis",
  "review",
  "in_progress",
  "implemented",
  "closed",
]);

function normalizeDeliveryStatus(x: unknown): string {
  const v = safeStr(x).toLowerCase();
  if (!v) return "intake";
  const norm = v === "in-progress" || v === "in progress" ? "in_progress" : v;
  if (norm === "new") return "intake";
  return ALLOWED_DELIVERY.has(norm) ? norm : "intake";
}

/** Accept both UI camelCase and DB snake_case inputs */
function pickPlan(body: any) {
  const implementationPlan =
    safeStr(body?.implementationPlan) ||
    safeStr(body?.implementation_plan) ||
    safeStr(body?.implementation) ||
    "";

  const rollbackPlan =
    safeStr(body?.rollbackPlan) ||
    safeStr(body?.rollback_plan) ||
    safeStr(body?.rollback) ||
    "";

  return {
    implementation_plan: implementationPlan ? clamp(implementationPlan, 8000) : null,
    rollback_plan: rollbackPlan ? clamp(rollbackPlan, 8000) : null,
  };
}

/** Persist long-form narrative fields used by ChangeCreateModal */
function pickNarratives(body: any) {
  const out: Record<string, any> = {};
  const j = safeStr(body?.justification);
  const f = safeStr(body?.financial);
  const s = safeStr(body?.schedule);
  const r = safeStr(body?.risks);
  const d = safeStr(body?.dependencies);
  const a = safeStr(body?.assumptions);

  if (j) out.justification = clamp(j, 8000);
  if (f) out.financial = clamp(f, 8000);
  if (s) out.schedule = clamp(s, 8000);
  if (r) out.risks = clamp(r, 8000);
  if (d) out.dependencies = clamp(d, 8000);
  if (a) out.assumptions = clamp(a, 8000);

  return out;
}

/**
 * ✅ review_by parser
 * Accepts:
 * - "YYYY-MM-DD" (preferred)
 * - ISO strings (takes UTC date part)
 * - "DD/MM/YYYY"
 */
function parseDateToIso(value: any): string | null {
  if (value == null) return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const s = safeStr(value);
  if (!s) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // ISO / anything Date can parse
  const d1 = new Date(s);
  if (!Number.isNaN(d1.getTime())) {
    return new Date(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), d1.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  }

  // DD/MM/YYYY
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const dd = Math.max(1, Math.min(31, Number(m[1] || 1)));
    const mm = Math.max(1, Math.min(12, Number(m[2] || 1)));
    const yyyy = Math.max(1900, Math.min(3000, Number(m[3] || 2000)));
    return new Date(Date.UTC(yyyy, mm - 1, dd)).toISOString().slice(0, 10);
  }

  return null;
}

function hasOwn(obj: any, key: string) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}

function pickReviewBy(body: any): { present: boolean; value: string | null; raw: any } {
  const present = hasOwn(body, "reviewBy") || hasOwn(body, "review_by");
  if (!present) return { present: false, value: null, raw: null };

  const raw = hasOwn(body, "reviewBy") ? body.reviewBy : body.review_by;
  if (raw == null) return { present: true, value: null, raw };

  const parsed = parseDateToIso(raw);
  return { present: true, value: parsed, raw };
}

function missingColumnName(msg: string): string | null {
  const m = String(msg || "").match(
    /column\s+"([^"]+)"\s+of\s+relation\s+"[^"]+"\s+does\s+not\s+exist/i
  );
  return m?.[1] || null;
}

async function insertWithStripRetry(supabase: any, row: Record<string, any>) {
  const first = await supabase.from(TABLE).insert(row).select("*").single();
  if (!first.error) return first;

  const col = missingColumnName(safeStr(first.error.message));
  if (!col) return first;

  const cleaned = { ...row };
  delete cleaned[col];

  const second = await supabase.from(TABLE).insert(cleaned).select("*").single();
  return second.error ? first : second;
}

type LaneKey = "intake" | "analysis" | "review" | "in_progress" | "implemented" | "closed";

function laneKey(raw: any): LaneKey {
  const v = safeStr(raw).trim().toLowerCase();
  if (v === "in-progress" || v === "in progress") return "in_progress";
  if (v === "new") return "intake";
  if (v === "analysis") return "analysis";
  if (v === "review") return "review";
  if (v === "in_progress") return "in_progress";
  if (v === "implemented") return "implemented";
  if (v === "closed") return "closed";
  return "intake";
}

/* ---------------- enterprise auth/access ---------------- */

async function requireAuth(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw Object.assign(new Error(error.message), { status: 401 });
  if (!data?.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return data.user;
}

async function requireProjectMember(
  supabase: any,
  projectId: string,
  userId: string,
  minRole: "viewer" | "editor" = "viewer"
) {
  const pid = safeStr(projectId);
  if (!pid) throw Object.assign(new Error("Missing projectId"), { status: 400 });

  const { data, error } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", pid)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw Object.assign(new Error("Forbidden"), { status: 403 });

  const role = safeStr(data.role).toLowerCase();
  const isEditor = role === "owner" || role === "editor";
  if (minRole === "editor" && !isEditor) {
    throw Object.assign(new Error("Forbidden"), { status: 403 });
  }

  return { role };
}

function normalizeLinks(x: any) {
  // ensure links is an object, not array; keep it shallow-ish
  if (!x || typeof x !== "object" || Array.isArray(x)) return null;

  // Optional: clamp number of keys to reduce abuse
  const out: Record<string, any> = {};
  const keys = Object.keys(x).slice(0, 50);
  for (const k of keys) {
    const key = safeStr(k);
    if (!key) continue;
    const v = (x as any)[k];
    // allow string/number/bool/null or small objects
    if (v == null) out[key] = null;
    else if (typeof v === "string") out[key] = clamp(v, 1000);
    else if (typeof v === "number" || typeof v === "boolean") out[key] = v;
    else if (typeof v === "object" && !Array.isArray(v)) out[key] = v;
  }
  return Object.keys(out).length ? out : null;
}

/* ---------------- handlers ---------------- */

export async function GET(req: Request) {
  const supabase = await createClient();

  try {
    const user = await requireAuth(supabase);

    const { searchParams } = new URL(req.url);
    const projectId = safeStr(searchParams.get("projectId"));
    if (!projectId) return jsonError("Missing projectId", 400, undefined, NO_STORE_HEADERS);

    // ✅ enterprise: ensure membership before reading
    await requireProjectMember(supabase, projectId, user.id, "viewer");

    const shape = safeStr(searchParams.get("shape")).toLowerCase(); // "items" | "lanes"

    const selectLite = [
      "id",
      "seq",
      "public_id",
      "title",
      "description",
      "project_id",
      "artifact_id",
      "delivery_status",
      "decision_status",
      "priority",
      "impact_analysis",
      "ai_score",
      "updated_at",
      "created_at",
      "requester_name",
      "assignee_id",
      "links",
      "review_by",
    ].join(",");

    const { data, error } = await supabase
      .from(TABLE)
      .select(selectLite)
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (error) return jsonError(error.message, 400, error, NO_STORE_HEADERS);

    const items = (Array.isArray(data) ? data : []) as any[];

    if (shape === "lanes") {
      const lanes: Record<LaneKey, any[]> = {
        intake: [],
        analysis: [],
        review: [],
        in_progress: [],
        implemented: [],
        closed: [],
      };

      for (const it of items) {
        lanes[laneKey(it.delivery_status)].push(it);
      }

      return jsonOk({ lanes, count: items.length }, 200, NO_STORE_HEADERS);
    }

    return jsonOk({ items, count: items.length }, 200, NO_STORE_HEADERS);
  } catch (e: any) {
    const status =
      typeof e?.status === "number" && e.status >= 400 && e.status <= 599 ? e.status : 500;
    return jsonError(e?.message || "Server error", status, undefined, NO_STORE_HEADERS);
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();

  try {
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({} as any));

    const project_id = safeStr(body?.project_id || body?.projectId);
    if (!project_id) return jsonError("Missing project_id", 400, undefined, NO_STORE_HEADERS);

    // ✅ enterprise: only editors/owners can create changes
    await requireProjectMember(supabase, project_id, user.id, "editor");

    const artifact_id = safeStr(body?.artifact_id || body?.artifactId) || null;

    const title = clamp(safeStr(body?.title) || "Untitled change", 160);

    // ✅ description is NOT NULL in your table — enforce minimum
    const description = clamp(safeStr(body?.description ?? body?.summary), 1200);
    if (!description) return jsonError("Missing description/summary", 400, undefined, NO_STORE_HEADERS);

    const plans = pickPlan(body);
    const narratives = pickNarratives(body);

    // ✅ review_by
    const rb = pickReviewBy(body);
    if (rb.present && rb.raw != null && !rb.value) {
      return jsonError(
        "Invalid reviewBy/review_by (expected YYYY-MM-DD or DD/MM/YYYY)",
        400,
        { code: "invalid_review_by" },
        NO_STORE_HEADERS
      );
    }
    const review_by = rb.present ? rb.value : null;

    // 🔒 requester_id must be the authenticated user (prevent impersonation)
    const requester_name =
      safeStr(body?.requester_name || body?.requesterName || body?.requester) || "Unknown requester";

    const row: any = {
      project_id,
      artifact_id,

      title,
      description,

      proposed_change: safeStr(body?.proposed_change ?? body?.proposedChange) || null,
      impact_analysis: normalizeImpactAnalysis(body),

      status: "new",
      decision_status: "draft" as const,

      delivery_status: normalizeDeliveryStatus(
        body?.delivery_status ?? body?.deliveryStatus ?? body?.lane ?? "intake"
      ),

      requester_id: user.id,
      requester_name: clamp(requester_name, 200),

      priority: normalizePriority(body?.priority),
      tags: normalizeTags(body?.tags),

      links: normalizeLinks(body?.links),

      implementation_plan: plans.implementation_plan,
      rollback_plan: plans.rollback_plan,
      ...narratives,

      review_by,

      ai_score: body?.ai_score ?? null,
      ai_schedule: body?.ai_schedule ?? null,
      ai_cost: body?.ai_cost ?? null,
      ai_scope: body?.ai_scope ?? null,

      assignee_id: safeStr(body?.assignee_id || body?.assigneeId) || null,
    };

    const ins = await insertWithStripRetry(supabase, row);
    if (ins.error) {
      return jsonError(
        ins.error.message,
        400,
        {
          hint: "Insert into change_requests failed",
          rowKeys: Object.keys(row),
          supabase: ins.error,
        },
        NO_STORE_HEADERS
      );
    }

    return jsonOk(
      {
        item: ins.data,
        data: ins.data,
        id: ins.data?.id ?? null,
      },
      200,
      NO_STORE_HEADERS
    );
  } catch (e: any) {
    const status =
      typeof e?.status === "number" && e.status >= 400 && e.status <= 599 ? e.status : 500;
    return jsonError(e?.message || "Server error", status, undefined, NO_STORE_HEADERS);
  }
}