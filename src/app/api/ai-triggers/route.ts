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
function canWrite(role: MemberRole) {
  return role === "owner" || role === "admin";
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

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const projectId = String(searchParams.get("projectId") ?? "").trim();

    if (!projectId || !isUuid(projectId)) {
      return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    }

    const { supabase, user, role } = await requireAuthAndMembership(projectId);
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!role || !canRead(role)) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const { data, error } = await supabase
      .from("ai_triggers")
      .select("*")
      .or(`project_id.eq.${projectId},project_id.is.null`)
      .order("trigger_artifact", { ascending: true })
      .order("event_type", { ascending: true });

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, triggers: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = String(body?.projectId ?? "").trim();
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!projectId || !isUuid(projectId)) {
      return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    }

    const { supabase, user, role } = await requireAuthAndMembership(projectId);
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!role) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!canWrite(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const upserts = items.map((t: any) => ({
      id: t.id || undefined,
      project_id: t.project_id ? t.project_id : projectId,
      trigger_artifact: String(t.trigger_artifact ?? ""),
      event_type: String(t.event_type ?? ""),
      event_example: String(t.event_example ?? ""),
      ai_intent: String(t.ai_intent ?? ""),
      ai_steps: Array.isArray(t.ai_steps) ? t.ai_steps : [],
      affected_artifacts: Array.isArray(t.affected_artifacts) ? t.affected_artifacts : [],
      pm_benefit: String(t.pm_benefit ?? ""),
      governance_value: String(t.governance_value ?? ""),
      severity: String(t.severity ?? "info"),
      auto_execute: Boolean(t.auto_execute ?? false),
      explain_why: String(t.explain_why ?? ""),
      explain_data_used: Array.isArray(t.explain_data_used) ? t.explain_data_used : [],
      is_enabled: Boolean(t.is_enabled ?? true),
    }));

    const { data, error } = await supabase
      .from("ai_triggers")
      .upsert(upserts, { onConflict: "id" })
      .select("id");

    if (error) throw new Error(error.message);

    return NextResponse.json({ ok: true, saved: data ?? [] }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
