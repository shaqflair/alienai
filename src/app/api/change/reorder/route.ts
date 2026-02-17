import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}
function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

async function requireUser(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

async function roleForProject(supabase: any, projectId: string, userId: string) {
  const { data: mem, error } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const role = String(mem?.role ?? "").toLowerCase();
  if (role !== "editor" && role !== "owner") return null;
  return role;
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Missing JSON body", 400);

    const projectId = safeStr(body.projectId).trim();
    const lane = safeStr(body.lane).trim().toLowerCase();
    const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds.map(String) : [];

    if (!projectId) return jsonError("Missing projectId", 400);
    if (!lane) return jsonError("Missing lane", 400);
    if (!orderedIds.length) return jsonError("Missing orderedIds", 400);

    const role = await roleForProject(supabase, projectId, user.id);
    if (!role) return jsonError("Forbidden", 403);

    // Update each row (simple + reliable)
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      const { error } = await supabase
        .from("change_requests")
        .update({
          lane_sort: i,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("project_id", projectId)
        .eq("delivery_status", lane);

      if (error) throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return jsonError(msg, status);
  }
}

