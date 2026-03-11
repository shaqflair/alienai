// FILE: src/lib/email/sendOrgInviteEmail.ts
//
// Sends a branded Aliena org invite email via Resend.
// Reuses the existing sendEmail() utility from src/lib/email/send.ts

import { sendEmail } from "./send";

export async function sendOrgInviteEmail(args: {
  to:           string;
  orgName:      string;
  inviterName:  string | null;
  inviterEmail: string | null;
  role:         "admin" | "member";
  inviteUrl:    string;
  inviteId?:    string;
  orgId?:       string;
  expiresAt?:   string | null;
}) {
  const inviter   = args.inviterName || args.inviterEmail || "Someone";
  const roleLabel = args.role === "admin" ? "Admin" : "Member";
  const expiry    = args.expiresAt
    ? new Date(args.expiresAt).toLocaleDateString("en-GB", {
        day: "numeric", month: "long", year: "numeric",
      })
    : null;

  const subject = `${inviter} invited you to join ${args.orgName} on Aliena`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:40px auto;background:white;border-radius:16px;
              border:1px solid #e2e8f0;box-shadow:0 4px 24px rgba(0,0,0,0.06);overflow:hidden;">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#0e7490 0%,#0891b2 100%);padding:28px 32px;">
      <div style="font-size:22px;font-weight:900;color:white;letter-spacing:-0.5px;">Aliena</div>
      <div style="font-size:13px;color:rgba(255,255,255,0.7);margin-top:4px;">Governance intelligence</div>
    </div>

    <!-- Body -->
    <div style="padding:32px;">
      <h1 style="font-size:20px;font-weight:800;color:#0f172a;margin:0 0 12px;">
        You've been invited
      </h1>
      <p style="font-size:14px;color:#475569;margin:0 0 8px;line-height:1.6;">
        <strong style="color:#0f172a;">${inviter}</strong> has invited you to join
        <strong style="color:#0f172a;">${args.orgName}</strong> on Aliena
        as a <strong style="color:#0e7490;">${roleLabel}</strong>.
      </p>

      ${expiry ? `<p style="font-size:12px;color:#94a3b8;margin:0 0 24px;">This invite expires on ${expiry}.</p>` : '<div style="margin-bottom:24px;"></div>'}

      <!-- CTA -->
      <a href="${args.inviteUrl}"
         style="display:inline-block;background:#0e7490;color:white;
                font-size:14px;font-weight:700;padding:12px 24px;
                border-radius:10px;text-decoration:none;
                box-shadow:0 4px 12px rgba(14,116,144,0.3);">
        Accept invite
      </a>

      <!-- Fallback URL -->
      <div style="margin-top:24px;padding:14px 16px;background:#f8fafc;
                  border-radius:8px;border:1px solid #e2e8f0;">
        <p style="font-size:11px;color:#94a3b8;margin:0 0 4px;">Or copy and paste this link:</p>
        <p style="font-size:11px;color:#0891b2;word-break:break-all;margin:0;">${args.inviteUrl}</p>
      </div>

      <!-- What is Aliena -->
      <div style="margin-top:24px;padding-top:20px;border-top:1px solid #f1f5f9;">
        <p style="font-size:12px;color:#94a3b8;margin:0;line-height:1.6;">
          Aliena is a governance intelligence platform for portfolio oversight,
          delivery governance, and executive reporting. Once you accept, you'll be able to
          access portfolio intelligence, governance dashboards, and project oversight.
        </p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background:#f8fafc;border-top:1px solid #e2e8f0;
                padding:16px 32px;font-size:11px;color:#94a3b8;">
      If you didn't expect this invite, you can safely ignore this email.
      &nbsp;&middot;&nbsp;
      <a href="https://aliena.co.uk" style="color:#0891b2;text-decoration:none;">aliena.co.uk</a>
    </div>
  </div>
</body>
</html>
  `.trim();

  const text =
    `${inviter} invited you to join ${args.orgName} on Aliena as a ${roleLabel}.\n\n` +
    `Accept your invite: ${args.inviteUrl}\n\n` +
    (expiry ? `This invite expires on ${expiry}.\n\n` : "") +
    `If you didn't expect this, ignore this email.`;

  return sendEmail({
    to:      args.to,
    subject,
    html,
    text,
    replyTo: "support@aliena.co.uk",
    tags: [
      { name: "type", value: "org_invite" },
      ...(args.orgId    ? [{ name: "org_id",    value: args.orgId    }] : []),
      ...(args.inviteId ? [{ name: "invite_id", value: args.inviteId }] : []),
    ],
  });
}