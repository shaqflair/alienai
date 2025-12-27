import { sendEmail } from "./send";

export async function sendProjectInviteEmail(args: {
  to: string;
  projectTitle: string;
  inviterEmail?: string | null;
  inviteUrl: string;
  inviteId?: string;
  projectId?: string;
}) {
  const subject = `You’ve been invited to join ${args.projectTitle}`;

  const inviter = args.inviterEmail ?? "Someone";

  const html = `
    <div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;">
      <h2>You’ve been invited</h2>
      <p><strong>${inviter}</strong> invited you to join:</p>
      <p><strong>${args.projectTitle}</strong></p>
      <p>
        <a href="${args.inviteUrl}"
           style="display:inline-block;padding:10px 14px;border:1px solid #ddd;border-radius:8px;text-decoration:none">
          Accept invite
        </a>
      </p>
      <p style="font-size:12px;color:#666">
        If the button doesn’t work, copy and paste this link:<br/>
        ${args.inviteUrl}
      </p>
    </div>
  `;

  const text =
    `You’ve been invited to join ${args.projectTitle}\n\n` +
    `Accept: ${args.inviteUrl}`;

  return sendEmail({
    to: args.to,
    subject,
    html,
    text,
    replyTo: "support@aliena.co.uk",
    tags: [
      { name: "type", value: "project_invite" },
      ...(args.projectId ? [{ name: "project_id", value: args.projectId }] : []),
      ...(args.inviteId ? [{ name: "invite_id", value: args.inviteId }] : []),
    ],
  });
}
