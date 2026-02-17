// src/app/api/ai-suggestions/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
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
function canAct(role: MemberRole) {
  // Accept/Dismiss is an action; keep it editor+
  return role === "owner" || role === "admin" || role === "editor";
}

async function requireAuthAndMembership(projectId: string) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) return { supabase, user: null as any, role: null as any };

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);

  return {
    supabase,
    user: auth.user,
    role: mem ? normalizeRole((mem as any).role) : null,
  };
}

const ALLOWED_STATUSES = new Set(["proposed", "suggested", "accepted", "dismissed"]);

/**
 * GET /api/ai-suggestions?projectId=...&status=suggested|accepted|dismissed|proposed
 * Returns project suggestions.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = String(searchParams.get("projectId") ?? "").trim();
    const status = String(searchParams.get("status") ?? "").trim().toLowerCase();

    if (!projectId || !isUuid(projectId)) {
      return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    }

    const { supabase, user, role } = await requireAuthAndMembership(projectId);
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!role || !canRead(role)) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    let q = supabase
      .from("ai_suggestions")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });

    if (status && ALLOWED_STATUSES.has(status)) {
      q = q.eq("status", status);
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, suggestions: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

/**
 * POST /api/ai-suggestions
 * Body: { projectId, id, status: "accepted"|"dismissed" }
 *
 * âœ… uses:
 * - updated_at
 * - actioned_by
 * - decided_at (accepted)
 * - rejected_at (dismissed)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.projectId ?? "").trim();
    const id = String(body?.id ?? "").trim();
    const nextStatus = String(body?.status ?? "").trim().toLowerCase();

    if (!projectId || !isUuid(projectId)) {
      return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    }
    if (!id || !isUuid(id)) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }
    if (!(nextStatus === "accepted" || nextStatus === "dismissed")) {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }

    const { supabase, user, role } = await requireAuthAndMembership(projectId);
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!role) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!canAct(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const now = new Date().toISOString();

    const update: any = {
      status: nextStatus,
      updated_at: now,
      actioned_by: user.id,
    };

    if (nextStatus === "accepted") {
      update.decided_at = now;
      update.rejected_at = null;
    } else if (nextStatus === "dismissed") {
      update.rejected_at = now;
      update.decided_at = null;
    }

    const { data, error } = await supabase
      .from("ai_suggestions")
      .update(update)
      .eq("id", id)
      .eq("project_id", projectId)
      .select("id, status, decided_at, rejected_at, updated_at, actioned_by")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true, suggestion: data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}


