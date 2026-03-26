import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonErr(error: string, status = 400, extra?: Record<string, any>) {
  return noStoreJson({ ok: false, error, ...(extra || {}) }, status);
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function isSafeNext(next: string) {
  if (!next) return false;
  if (!next.startsWith("/")) return false;
  if (next.startsWith("//")) return false;
  return true;
}

async function updateActiveOrganisation(sb: any, userId: string, orgId: string) {
  const first = await sb
    .from("profiles")
    .update({ active_organisation_id: orgId })
    .eq("user_id", userId);

  if (!first.error) return { ok: true as const, used: "user_id" as const };

  const firstMsg = sbErrText(first.error).toLowerCase();
  const looksLikeColumnIssue =
    firstMsg.includes("column") ||
    firstMsg.includes("user_id") ||
    firstMsg.includes("schema") ||
    firstMsg.includes("does not exist");

  if (!looksLikeColumnIssue) {
    return { ok: false as const, error: first.error };
  }

  const second = await sb
    .from("profiles")
    .update({ active_organisation_id: orgId })
    .eq("id", userId);

  if (!second.error) return { ok: true as const, used: "id" as const };

  return { ok: false as const, error: second.error };
}

export async function POST(req: Request) {
  try {
    const sb = await createClient();

    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) return jsonErr(sbErrText(authErr), 401);
    if (!auth?.user) return jsonErr("Not authenticated", 401);

    const userId = safeStr(auth.user.id).trim();
    if (!userId || !isUuid(userId)) {
      return jsonErr("Invalid authenticated user", 401);
    }

    const form = await req.formData();
    const orgId = safeStr(form.get("org_id")).trim();
    const nextRaw = safeStr(form.get("next")).trim();
    const next = isSafeNext(nextRaw) ? nextRaw : "/settings";

    if (!orgId) return jsonErr("Missing org_id", 400);
    if (!isUuid(orgId)) return jsonErr("Invalid org_id", 400);

    const { data: member, error: memberErr } = await sb
      .from("organisation_members")
      .select("organisation_id, removed_at")
      .eq("user_id", userId)
      .eq("organisation_id", orgId)
      .is("removed_at", null)
      .maybeSingle();

    if (memberErr) return jsonErr(sbErrText(memberErr), 400);
    if (!member) return jsonErr("You are not a member of that organisation.", 403);

    const profileUpdate = await updateActiveOrganisation(sb, userId, orgId);

    if (!profileUpdate.ok) {
      return jsonErr(
        `Failed to switch active organisation: ${sbErrText(profileUpdate.error)}`,
        500
      );
    }

    const res = NextResponse.redirect(new URL(next, req.url), 303);
    res.headers.set("Cache-Control", "no-store, max-age=0");

    res.cookies.set("active_org_id", orgId, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 30,
    });

    return res;
  } catch (e: any) {
    return jsonErr(e?.message || "Unknown error", 500);
  }
}