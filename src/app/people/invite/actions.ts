"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { sendOrgInviteEmail } from "@/lib/email/sendOrgInviteEmail";
import crypto from "crypto";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isEmail(x: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}
function token64() {
  return crypto.randomBytes(32).toString("hex");
}
function expiresAt7Days(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}
function requireOrigin(): string {
  const o =
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL;
  if (!o) throw new Error("Missing APP_ORIGIN env var");
  return o.replace(/\/+$/, "");
}

async function adminClient() {
  const url        = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !serviceKey) throw new Error("Missing service role env vars");
  return createAdminClient(url, serviceKey);
}

async function requireAdmin(supabase: any, organisationId: string, userId: string) {
  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (!mem || safeStr(mem.role).toLowerCase() !== "admin")
    throw new Error("Admin access required");
  return true;
}

/**
 * sendInviteAction
 * Creates or re-sends a single org invite and fires the branded email.
 */
export async function sendInviteAction(formData: FormData) {
  const supabase       = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const organisationId = safeStr(formData.get("organisation_id")).trim();
  const emailRaw       = safeStr(formData.get("email")).trim().toLowerCase();
  const role           = safeStr(formData.get("role")).trim().toLowerCase() as "admin" | "member";
  const isResend       = safeStr(formData.get("resend")) === "true";

  if (!isEmail(emailRaw)) throw new Error("Invalid email address");

  await requireAdmin(supabase, organisationId, auth.user.id);

  const admin = await adminClient();

  // Fetch org name + inviter name
  const [{ data: org }, { data: profile }] = await Promise.all([
    admin.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
    admin.from("profiles").select("full_name").eq("user_id", auth.user.id).maybeSingle(),
  ]);

  const orgName     = safeStr(org?.name || "your organisation");
  const inviterName = safeStr(profile?.full_name || "");

  let inviteId: string;
  let inviteToken: string;
  let expiresAt: string;

  if (isResend) {
    // Refresh token + expiry on existing pending invite
    const { data: existing } = await supabase
      .from("organisation_invites")
      .select("id")
      .eq("organisation_id", organisationId)
      .eq("email", emailRaw)
      .eq("status", "pending")
      .maybeSingle();

    if (!existing) throw new Error("No pending invite found for this email");

    const newToken   = token64();
    expiresAt        = expiresAt7Days();
    const { error }  = await supabase
      .from("organisation_invites")
      .update({ token: newToken, expires_at: expiresAt })
      .eq("id", existing.id);

    if (error) throw new Error(error.message);
    inviteId    = existing.id;
    inviteToken = newToken;
  } else {
    // New invite
    const newToken = token64();
    expiresAt      = expiresAt7Days();

    const { data, error } = await supabase
      .from("organisation_invites")
      .insert({
        organisation_id: organisationId,
        email:           emailRaw,
        role,
        token:           newToken,
        invited_by:      auth.user.id,
        status:          "pending",
        expires_at:      expiresAt,
      })
      .select("id")
      .single();

    if (error) {
      const code = safeStr((error as any)?.code);
      if (code === "23505")
        throw new Error("An invite is already pending for this email.");
      throw new Error(error.message);
    }

    inviteId    = data.id;
    inviteToken = newToken;
  }

  // Build URL + send email
  const origin    = requireOrigin();
  const inviteUrl = `${origin}/organisations/invite/${encodeURIComponent(inviteToken)}`;

  await sendOrgInviteEmail({
    to:           emailRaw,
    orgName,
    inviterName:  inviterName || null,
    inviterEmail: safeStr(auth.user.email) || null,
    role:          role === "admin" ? "admin" : "member",
    inviteUrl,
    inviteId,
    orgId:        organisationId,
    expiresAt,
  });

  revalidatePath("/people/invite");
}

/**
 * bulkInviteAction
 * Sends invites to multiple emails (newline / comma separated).
 */
export async function bulkInviteAction(formData: FormData) {
  const supabase       = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const organisationId = safeStr(formData.get("organisation_id")).trim();
  const rawEmails      = safeStr(formData.get("emails"));
  const role           = safeStr(formData.get("role")).trim().toLowerCase() as "admin" | "member";

  await requireAdmin(supabase, organisationId, auth.user.id);

  const emails = rawEmails
    .split(/[\n,;]+/)
    .map(e => e.trim().toLowerCase())
    .filter(e => isEmail(e));

  if (!emails.length) throw new Error("No valid emails found");

  const results: Array<{ email: string; ok: boolean; error?: string }> = [];

  for (const email of emails) {
    const fd = new FormData();
    fd.set("organisation_id", organisationId);
    fd.set("email", email);
    fd.set("role", role);
    try {
      await sendInviteAction(fd);
      results.push({ email, ok: true });
    } catch (e: any) {
      results.push({ email, ok: false, error: safeStr(e?.message) });
    }
  }

  revalidatePath("/people/invite");
  return results;
}

/**
 * revokeInviteAction
 */
export async function revokeInviteAction(formData: FormData) {
  const supabase       = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const inviteId       = safeStr(formData.get("invite_id")).trim();
  const organisationId = safeStr(formData.get("organisation_id")).trim();

  await requireAdmin(supabase, organisationId, auth.user.id);

  const { error } = await supabase
    .from("organisation_invites")
    .update({ status: "revoked" })
    .eq("id", inviteId)
    .eq("status", "pending");

  if (error) throw new Error(error.message);
  revalidatePath("/people/invite");
}
