import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function escapeHtml(value: string) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function sendApprovalAssignedEmail(args: {
  to: string;
  approverName?: string | null;
  artifactTitle: string;
  artifactType: string;
  projectTitle: string;
  projectRef: string;
  artifactUrl: string;
  submittedByName?: string | null;
}) {
  const from = requiredEnv("APP_FROM_EMAIL");

  const subject = `Action required — ${args.artifactTitle} awaiting your approval`;
  const greeting = args.approverName?.trim() ? `Hi ${args.approverName},` : "Hi,";
  const submittedBy = args.submittedByName?.trim() || "A team member";

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(submittedBy)}</strong> submitted an artifact for your approval in Aliena AI.</p>

      <div style="margin:16px 0;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">
        <div><strong>Project:</strong> ${escapeHtml(args.projectTitle)} (${escapeHtml(args.projectRef)})</div>
        <div><strong>Artifact:</strong> ${escapeHtml(args.artifactTitle)}</div>
        <div><strong>Type:</strong> ${escapeHtml(args.artifactType)}</div>
      </div>

      <p>
        <a
          href="${escapeHtml(args.artifactUrl)}"
          style="display:inline-block;padding:10px 16px;border-radius:10px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600"
        >
          Review artifact
        </a>
      </p>

      <p style="color:#475569">Please review and approve, request changes, or reject as appropriate.</p>
    </div>
  `;

  const text = [
    greeting,
    "",
    `${submittedBy} submitted an artifact for your approval in Aliena AI.`,
    "",
    `Project: ${args.projectTitle} (${args.projectRef})`,
    `Artifact: ${args.artifactTitle}`,
    `Type: ${args.artifactType}`,
    "",
    `Review: ${args.artifactUrl}`,
  ].join("\n");

  const { error } = await resend.emails.send({
    from,
    to: [args.to],
    subject,
    html,
    text,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
}
