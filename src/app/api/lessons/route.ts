import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error, details }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}
function normRole(x: any) {
  return String(x || "").trim().toLowerCase();
}

/* ---------------- auth & membership ---------------- */

async function requireUser(sb: any) {
  const { data: auth } = await sb.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) return { ok: false, error: "Not authenticated" as const };
  return { ok: true, uid };
}

/** member gate: viewer/editor/owner */
async function requireMember(sb: any, project_id: string) {
  const u = await requireUser(sb);
  if (!u.ok) return u;

  const { data, error } = await sb
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", project_id)
    .eq("user_id", u.uid)
    .is("removed_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: error.message as const };
  const role = normRole(data?.role);
  const allowed = role === "owner" || role === "editor" || role === "viewer";
  if (!allowed) return { ok: false, error: "Forbidden" as const };
  return { ok: true, uid: u.uid, role };
}

/** editor gate: owner/editor only */
async function requireEditor(sb: any, project_id: string) {
  const u = await requireUser(sb);
  if (!u.ok) return u;

  const { data, error } = await sb
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", project_id)
    .eq("user_id", u.uid)
    .is("removed_at", null)
    .maybeSingle();

  if (error) return { ok: false, error: error.message as const };
  const role = normRole(data?.role);
  const allowed = role === "owner" || role === "editor";
  if (!allowed) return { ok: false, error: "Forbidden" as const };
  return { ok: true, uid: u.uid, role };
}

/* ---------------- project resolution ---------------- */

async function resolveProjectUuid(sb: any, projectId: string) {
  const pid = safeStr(projectId).trim();
  if (!pid) return { ok: false, error: "Missing projectId" as const };

  if (isUuid(pid)) {
    return { ok: true, projectUuid: pid };
  }

  const candidates = ["project_code", "human_id", "project_code_human", "code", "public_id"];

  for (const col of candidates) {
    const { data, error } = await sb.from("projects").select("id").eq(col, pid).maybeSingle();

    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("does not exist") || msg.includes("column")) continue;
      return { ok: false, error: error.message as const };
    }

    if (data?.id) return { ok: true, projectUuid: data.id as string };
  }

  return { ok: false, error: "Project not found" as const };
}

/* ---------------- handlers ---------------- */

export async function GET(req: NextRequest) {
  const sb = await createClient();

  const url = new URL(req.url);
  const projectId = safeStr(url.searchParams.get("projectId")).trim();
  if (!projectId) return jsonErr("Missing projectId", 400);

  const resolved = await resolveProjectUuid(sb, projectId);
  if (!resolved.ok) return jsonErr(resolved.error, resolved.error === "Project not found" ? 404 : 400);

  const gate = await requireMember(sb, resolved.projectUuid);
  if (!gate.ok) return jsonErr(gate.error, gate.error === "Forbidden" ? 403 : 401);

  // ? Explicit select ensures we return the true UUID `id`
  const { data, error } = await sb
    .from("lessons_learned")
    .select(
      [
        "id",
        "project_id",
        "category",
        "description",
        "action_for_future",
        "created_at",
        "status",
        "impact",
        "severity",
        "project_stage",
        "ai_generated",
        "ai_summary",
        "is_published",
        "published_at",
        "library_tags",
        "action_owner_label",
      ].join(",")
    )
    .eq("project_id", resolved.projectUuid)
    .order("created_at", { ascending: false });

  if (error) return jsonErr(error.message, 400);
  return jsonOk({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const sb = await createClient();

  const body = await req.json().catch(() => ({} as any));

  const project_id_raw = safeStr(body?.project_id).trim();
  if (!project_id_raw) return jsonErr("Missing project_id", 400);

  const resolved = await resolveProjectUuid(sb, project_id_raw);
  if (!resolved.ok) return jsonErr(resolved.error, resolved.error === "Project not found" ? 404 : 400);

  const gate = await requireEditor(sb, resolved.projectUuid);
  if (!gate.ok) return jsonErr(gate.error, gate.error === "Forbidden" ? 403 : 401);

  const category = safeStr(body?.category).trim();
  const description = safeStr(body?.description).trim();
  if (!category) return jsonErr("category cannot be empty", 400);
  if (!description) return jsonErr("description cannot be empty", 400);

  const insertRow: any = {
    project_id: resolved.projectUuid,
    category,
    description,
    action_for_future: safeStr(body?.action_for_future).trim() || null,
    status: safeStr(body?.status).trim() || "Open",
    impact: safeStr(body?.impact).trim() || null,
    severity: safeStr(body?.severity).trim() || null,
    project_stage: safeStr(body?.project_stage).trim() || null,
    action_owner_label: safeStr(body?.action_owner_label).trim() || null,
  };

  const { data, error } = await sb.from("lessons_learned").insert(insertRow).select("*").single();
  if (error) return jsonErr(error.message, 400);

  return jsonOk({ item: data }, 201);
}


