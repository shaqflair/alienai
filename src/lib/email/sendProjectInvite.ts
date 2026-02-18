import { getResendClient, getFromAddress } from "./resend";

export async function sendProjectInviteEmail(args: {
  to: string;
  projectTitle: string;
  inviterEmail?: string | null;
  inviteUrl: string;
  // optional observability metadata
  inviteId?: string;
  projectId?: string;
}) {
  // Guardrails: common source of “emails not received”
  if (!args.to || !args.to.includes("@")) {
    throw new Error(`Invalid recipient: ${args.to}`);
  }
  if (!/^https?:\/\//i.test(args.inviteUrl)) {
    throw new Error(`inviteUrl must be absolute (got: ${args.inviteUrl})`);
  }

  const resend = getResendClient();
  const from = getFromAddress();

  const subject = `You’ve been invited to join ${args.projectTitle}`;

  const inviter = escapeHtml(args.inviterEmail || "Someone");
  const project = escapeHtml(args.projectTitle);
  const inviteUrl = escapeHtml(args.inviteUrl);

  const html = `
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height: 1.5;">
    <h2 style="margin:0 0 12px;">You’ve been invited</h2>
    <p style="margin:0 0 8px;"><b>${inviter}</b> invited you to join:</p>
    <p style="margin:0 0 16px; font-size:16px;"><b>${project}</b></p>
    <p style="margin:0 0 18px;">
      <a href="${inviteUrl}"
         style="display:inline-block;padding:10px 14px;border:1px solid #ddd;border-radius:8px;text-decoration:none">
         Accept invite
      </a>
    </p>
    <p style="color:#666;font-size:12px;margin:0;">
      If the button doesn’t work, copy and paste this link:<br/>
      <span>${inviteUrl}</span>
    </p>
  </div>
  `;

  const text =
    `You’ve been invited to join ${args.projectTitle}\n\n` +
    `Accept: ${args.inviteUrl}\n`;

  const { data, error } = await resend.emails.send({
    from,
    to: args.to,
    subject,
    html,
    text,

    // Improves deliverability + makes replies sensible
    replyTo: "support@aliena.co.uk",

    // Helps you filter/search in Resend + later webhook processing
    tags: [
      { name: "type", value: "project_invite" },
      ...(args.projectId ? [{ name: "project_id", value: args.projectId }] : []),
      ...(args.inviteId ? [{ name: "invite_id", value: args.inviteId }] : []),
    ],
  } as any);

  if (error) {
    // Resend errors often include name/message/statusCode
    const details = [
      error.name ? `name=${error.name}` : null,
      (error as any).statusCode ? `status=${(error as any).statusCode}` : null,
    ]
      .filter(Boolean)
      .join(" ");
    throw new Error(`Resend failed: ${error.message}${details ? ` (${details})` : ""}`);
  }

  // data.id is your message id — store it in DB for traceability
  return data; // { id: "..." }
}

function escapeHtml(s: string) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
