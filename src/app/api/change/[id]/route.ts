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

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    // FIX: Now await the async pickId
    const id = await pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    // ... rest of DELETE remains the same
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

/* =========================
   GET single
========================= */

export async function GET(req: Request, ctx: Ctx) {
  try {
    // FIX: Now await the async pickId
    const id = await pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    // ... rest of GET remains the same
  } catch (e: any) {
    return err(safeStr(e?.message) || "Unexpected error", { status: 500, code: "server_error" });
  }
}

/* =========================
   UPDATE (PATCH/POST)
========================= */

export async function POST(req: Request, ctx: Ctx) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (!isObj(body)) body = {};

    // FIX: Now await the async pickId
    const id = await pickId(req, ctx, body);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    // ... rest of POST remains the same
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  return POST(req, ctx);
}