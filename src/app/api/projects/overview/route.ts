import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET() {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return jsonErr("Not authenticated", 401);

  // ✅ projects user can access via project_members (RLS should also enforce)
  const { data, error } = await supabase
    .from("project_members")
    .select(
      `
      role,
      projects:project_id (
        id,
        title,
        client_name,
        created_at
      )
    `
    )
    .is("removed_at", null)
    .order("created_at", { ascending: false, referencedTable: "projects" });

  if (error) return jsonErr(error.message, 400);

  const items =
    (data || [])
      .map((r: any) => ({
        id: r?.projects?.id,
        title: r?.projects?.title ?? "Untitled",
        client_name: r?.projects?.client_name ?? null,
        role: r?.role ?? null,
        created_at: r?.projects?.created_at ?? null,
      }))
      .filter((x) => x.id) ?? [];

  // de-dupe in case of multiple membership rows
  const seen = new Set<string>();
  const projects = items.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));

  return jsonOk({ projects });
}

