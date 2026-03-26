// Sends in-app + email notifications from the agent.
// Email uses Resend (or any SMTP provider via RESEND_API_KEY / EMAIL_FROM env vars).

import "server-only";
import { createServiceClient } from "@/lib/supabase/service";

export type NotifyPayload = {
  organisationId:    string;
  recipientUserIds?: string[];   // if omitted, sends to all org admins
  title:              string;
  body:               string;
  link?:              string;
  type:               "alert" | "digest" | "action_required" | "info";
  emailSubject?:      string;
  emailHtml?:         string;
};

export async function sendAgentNotification(payload: NotifyPayload): Promise<void> {
  const supabase = createServiceClient();

  // Resolve recipients
  let recipientIds = payload.recipientUserIds ?? [];

  if (!recipientIds.length) {
    const { data: members } = await supabase
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", payload.organisationId)
      .in("role", ["admin", "owner"])
      .is("removed_at", null)
      .limit(50);
    recipientIds = (members ?? []).map((m: any) => m.user_id);
  }

  if (!recipientIds.length) return;

  // ── In-app notifications ─────────────────────────────────────────────────
  await supabase.from("notifications").insert(
    recipientIds.map((uid) => ({
      user_id:  uid,
      type:     payload.type,
      title:    payload.title,
      body:     payload.body,
      link:     payload.link ?? null,
      is_read:  false,
      metadata: { source: "agent", organisation_id: payload.organisationId },
    }))
  );

  // ── Email notifications ──────────────────────────────────────────────────
  const resendKey = process.env.RESEND_API_KEY;
  const emailFrom = process.env.EMAIL_FROM ?? "Aliena <noreply@aliena.co.uk>";

  if (!resendKey) return; // Email not configured — in-app only

  // Get email addresses for recipients
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, email")
    .in("user_id", recipientIds)
    .limit(50);

  const emails = (profiles ?? [])
    .map((p: any) => p.email)
    .filter(Boolean) as string[];

  if (!emails.length) return;

  const subject = payload.emailSubject ?? `Aliena — ${payload.title}`;
  const html    = payload.emailHtml ?? buildDefaultEmailHtml(payload);

  // Send via Resend API
  await Promise.allSettled(
    emails.map((to) =>
      fetch("https://api.resend.com/emails", {
        method:  "POST",
        headers: {
          "Content-Type":  "application/json",
          "Authorization": `Bearer ${resendKey}`,
        },
        body: JSON.stringify({ from: emailFrom, to, subject, html }),
      })
    )
  );
}

function buildDefaultEmailHtml(payload: NotifyPayload): string {
  const linkHtml = payload.link
    ? `<p style="margin:24px 0 0"><a href="https://aliena.co.uk${payload.link}"
        style="background:#00B8DB;color:#fff;padding:10px 22px;border-radius:4px;
               text-decoration:none;font-weight:600;font-size:14px;">
        View in Aliena →</a></p>`
    : "";

  const typeLabel: Record<string, string> = {
    alert:          "⚠ Alert",
    digest:         "📋 Daily Digest",
    action_required:"🔴 Action Required",
    info:            "ℹ Info",
  };

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f0f4f8;font-family:Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table width="560" cellpadding="0" cellspacing="0"
               style="background:#fff;border-radius:8px;overflow:hidden;
                      border:1px solid #e2e8f0;max-width:100%">
          <tr>
            <td style="background:#0A1628;padding:24px 32px">
              <span style="font-family:Arial,sans-serif;font-size:20px;font-weight:900;
                           color:#00B8DB;letter-spacing:4px">ΛLIΞNΛ</span>
              <span style="display:block;font-size:10px;color:rgba(150,220,255,0.6);
                           letter-spacing:2px;margin-top:2px">PROJECT INTELLIGENCE PLATFORM</span>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 32px 0">
              <span style="background:#f0f9ff;color:#0369a1;font-size:12px;font-weight:600;
                           padding:4px 10px;border-radius:4px;border:1px solid #bae6fd">
                ${typeLabel[payload.type] ?? payload.type}
              </span>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px">
              <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;font-weight:700">
                ${payload.title}
              </h2>
              <p style="margin:0;font-size:15px;color:#334155;line-height:1.7;
                        white-space:pre-wrap">${payload.body}</p>
              ${linkHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;border-top:1px solid #e2e8f0;background:#f8fafc">
              <p style="margin:0;font-size:12px;color:#94a3b8">
                Sent by Aliena Intelligence Agent · 
                <a href="https://aliena.co.uk/settings" style="color:#00B8DB">
                  Manage notifications
                </a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
