import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import crypto from "crypto";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function bad(error: string, status = 400) {
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

function token32() {
  return crypto.randomBytes(16).toString("hex"); // 32 chars
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return bad(sbErrText(authErr), 401);
  if (!auth?.user) return bad("Not authenticated", 401);

  const url = new URL(req.url);
  const organisationId = safeStr(url.searchParams.get("organisationId")).trim();
  if (!organisationId) return bad("Missing organisationId", 400);
  if (!isUuid(organisationId)) return bad("Invalid organisationId", 400);

  const { data, error } = await sb
    .from("organisation_invites")
    .select("id, organisation_id, email, role, status, created_at, accepted_at")
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false });

  if (error) {
    // If RLS blocks, PostgREST often returns 404/permission-ish messages.
    // Give a clean response without leaking internal details.
    return bad(sbErrText(error), 403);
  }

  return ok({ items: data ?? [] });
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return bad(sbErrText(authErr), 401);
  if (!auth?.user) return bad("Not authenticated", 401);

  const body = await req.json().catch(() => ({}));
  const organisation_id = safeStr(body?.organisation_id).trim();
  const email = safeStr(body?.email).trim().toLowerCase();
  const roleRaw = safeStr(body?.role).trim().toLowerCase();
  const role = (roleRaw || "member") as "admin" | "member";

  if (!organisation_id) return bad("Missing organisation_id", 400);
  if (!isUuid(organisation_id)) return bad("Invalid organisation_id", 400);
  if (!email || !email.includes("@")) return bad("Valid email required", 400);
  if (!(role === "admin" || role === "member")) return bad("Invalid role", 400);

  const token = token32();

  const { data, error } = await sb
    .from("organisation_invites")
    .insert({
      organisation_id,
      email,
      role,
      token,
      invited_by: auth.user.id,
      status: "pending",
    })
    .select("id, organisation_id, email, role, status, created_at, token")
    .single();

  if (error) {
    // If you add the unique pending index, duplicates will hit a constraint error.
    const msg = sbErrText(error);
    if (msg.toLowerCase().includes("duplicate") || msg.toLowerCase().includes("unique")) {
      return bad("An invite is already pending for this email in this organisation.", 409);
    }
    return bad(msg, 400);
  }

  // NOTE: not emailing yet. UI can show a copyable link.
  return ok({ invite: data });
}

export async function PATCH(req: Request) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return bad(sbErrText(authErr), 401);
  if (!auth?.user) return bad("Not authenticated", 401);

  const body = await req.json().catch(() => ({}));
  const id = safeStr(body?.id).trim();
  const status = safeStr(body?.status).trim().toLowerCase(); // only "revoked"

  if (!id) return bad("Missing id", 400);
  if (!isUuid(id)) return bad("Invalid id", 400);
  if (status !== "revoked") return bad("Invalid status", 400);

  const { data, error } = await sb
    .from("organisation_invites")
    .update({ status })
    .eq("id", id)
    .select("id, status")
    .single();

  if (error) return bad(sbErrText(error), 400);
  return ok({ invite: data });
}

