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
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}
function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export async function POST(req: Request) {
  const sb = await createClient();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return jsonErr(sbErrText(authErr), 401);
  if (!auth?.user) return jsonErr("Not authenticated", 401);

  const body = await req.json().catch(() => ({}));
  const name = safeStr(body?.name).trim();
  if (!name) return jsonErr("Organisation name required", 400);

  // 1) create org
  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .insert({ name, created_by: auth.user.id })
    .select("id, name")
    .single();

  if (orgErr) return jsonErr(sbErrText(orgErr), 400);

  // 2) create membership for creator (owner)
  const { error: memErr } = await sb.from("organisation_members").insert({
    organisation_id: org.id,
    user_id: auth.user.id,
    role: "owner",
  });

  if (memErr) {
    // If membership insert fails, you probably want to not leave an orphan org around.
    // With user-level client + RLS, delete may fail; so return clear message.
    return jsonErr(`Organisation created but failed to create owner membership: ${sbErrText(memErr)}`, 400);
  }

  return jsonOk({ organisation: org });
}

