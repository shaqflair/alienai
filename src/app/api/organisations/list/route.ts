import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function GET() {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return err("Not authenticated", 401);

  const { data, error } = await sb
    .from("organisation_members")
    .select(
      `
      role,
      organisations:organisations ( id, name )
    `
    )
    .eq("user_id", auth.user.id);

  if (error) return err(error.message, 400);

  const items =
    (data ?? [])
      .map((r: any) => {
        const org = r.organisations;
        if (!org?.id) return null;
        return { orgId: org.id, orgName: org.name, role: r.role };
      })
      .filter(Boolean) ?? [];

  return ok({ items });
}

