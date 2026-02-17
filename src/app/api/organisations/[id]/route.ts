import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function requireAdmin(sb: any, userId: string, organisationId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || String(data.role) !== "admin") throw new Error("Admin permission required");
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }>}) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return err("Not authenticated", 401);

  const organisationId = params.id;

  try {
    await requireAdmin(sb, auth.user.id, organisationId);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // cascade will remove memberships/invites
  const { error } = await sb.from("organisations").delete().eq("id", organisationId);
  if (error) return err(error.message, 400);

  return ok({ deleted: true });
}

