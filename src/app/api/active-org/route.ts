import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

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
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

export async function POST(req: NextRequest) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return jsonErr(sbErrText(authErr), 401);
  if (!auth?.user) return jsonErr("Not authenticated", 401);

  const form = await req.formData();
  const orgId = safeStr(form.get("org_id")).trim();
  const next = safeStr(form.get("next")).trim() || "/settings";

  if (!orgId) return jsonErr("Missing org_id", 400);
  if (!isUuid(orgId)) return jsonErr("Invalid org_id", 400);

  const { data: member, error } = await sb
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", auth.user.id)
    .eq("organisation_id", orgId)
    .maybeSingle();

  if (error) return jsonErr(sbErrText(error), 400);
  if (!member) return jsonErr("You are not a member of that organisation.", 403);

  // âœ… Redirect back to settings so UI refreshes with new cookie
  const res = NextResponse.redirect(new URL(next, req.url), 303);

  res.cookies.set("active_org_id", orgId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  return res;
}


