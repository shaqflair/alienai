"use server";
// src/app/actions/active-org.ts

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

const COOKIE_NAME = "active_org_id";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function isSafeNextPath(nextPath: string) {
  if (!nextPath) return false;
  if (!nextPath.startsWith("/")) return false;
  if (nextPath.startsWith("//")) return false;
  return true;
}

function resolveNextPath(input: unknown, fallback = "/projects") {
  const v = safeStr(input).trim();
  return isSafeNextPath(v) ? v : fallback;
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

async function updateActiveOrganisationInProfile(
  supabase: any,
  userId: string,
  organisationId: string | null
) {
  const first = await supabase
    .from("profiles")
    .update({ active_organisation_id: organisationId })
    .eq("user_id", userId);

  if (!first.error) return;

  const msg = sbErrText(first.error).toLowerCase();
  const looksLikeColumnMismatch =
    msg.includes("column") ||
    msg.includes("user_id") ||
    msg.includes("schema") ||
    msg.includes("does not exist");

  if (!looksLikeColumnMismatch) {
    throw new Error(sbErrText(first.error));
  }

  const second = await supabase
    .from("profiles")
    .update({ active_organisation_id: organisationId })
    .eq("id", userId);

  if (second.error) {
    throw new Error(sbErrText(second.error));
  }
}

export async function setActiveOrg(formData: FormData) {
  const orgId = safeStr(formData.get("orgId")).trim();
  const nextPath = resolveNextPath(formData.get("nextPath"), "/projects");

  if (!orgId || !isUuid(orgId)) redirect(nextPath);

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) redirect("/login");

  const userId = safeStr(user.id).trim();
  if (!userId || !isUuid(userId)) redirect("/login");

  const { data: membership, error: memErr } = await supabase
    .from("organisation_members")
    .select("organisation_id, removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr || !membership) redirect(nextPath);

  try {
    await updateActiveOrganisationInProfile(supabase, userId, orgId);
  } catch {
    redirect(nextPath);
  }

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  redirect(nextPath);
}

export async function clearActiveOrg(nextPathInput: string = "/projects") {
  const nextPath = resolveNextPath(nextPathInput, "/projects");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.id) {
    const userId = safeStr(user.id).trim();
    if (userId) {
      try {
        await updateActiveOrganisationInProfile(supabase, userId, null);
      } catch {
        // fail open on profile clear; still clear cookie
      }
    }
  }

  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);

  redirect(nextPath);
}