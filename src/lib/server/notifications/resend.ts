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

async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const from = requiredEnv("APP_FROM_EMAIL");

  const { error } = await resend.emails.send({
    from,
    to: [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
  });

  if (error) {
    throw new Error(`Resend send failed: ${error.message}`);
  }
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

  await sendEmail({
    to: args.to,
    subject,
    html,
    text,
  });
}

export async function sendChangesRequestedEmail(args: {
  to: string;
  recipientName?: string | null;
  artifactTitle: string;
  artifactType: string;
  projectTitle: string;
  projectRef: string;
  artifactUrl: string;
  requestedByName?: string | null;
  reason?: string | null;
}) {
  const subject = `Changes requested — ${args.artifactTitle}`;
  const greeting = args.recipientName?.trim() ? `Hi ${args.recipientName},` : "Hi,";
  const requestedBy = args.requestedByName?.trim() || "An approver";
  const reason = (args.reason || "").trim();

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(requestedBy)}</strong> requested changes to an artifact in Aliena AI.</p>

      <div style="margin:16px 0;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff7ed">
        <div><strong>Project:</strong> ${escapeHtml(args.projectTitle)} (${escapeHtml(args.projectRef)})</div>
        <div><strong>Artifact:</strong> ${escapeHtml(args.artifactTitle)}</div>
        <div><strong>Type:</strong> ${escapeHtml(args.artifactType)}</div>
      </div>

      ${
        reason
          ? `
      <div style="margin:16px 0;padding:16px;border:1px solid #fed7aa;border-radius:12px;background:#fffaf5">
        <div style="font-weight:700;margin-bottom:8px">Reviewer feedback</div>
        <div>${escapeHtml(reason)}</div>
      </div>
      `
          : ""
      }

      <p>
        <a
          href="${escapeHtml(args.artifactUrl)}"
          style="display:inline-block;padding:10px 16px;border-radius:10px;background:#b45309;color:#ffffff;text-decoration:none;font-weight:600"
        >
          Review and update artifact
        </a>
      </p>

      <p style="color:#475569">Update the artifact and resubmit it for approval once ready.</p>
    </div>
  `;

  const text = [
    greeting,
    "",
    `${requestedBy} requested changes to an artifact in Aliena AI.`,
    "",
    `Project: ${args.projectTitle} (${args.projectRef})`,
    `Artifact: ${args.artifactTitle}`,
    `Type: ${args.artifactType}`,
    ...(reason ? ["", "Reviewer feedback:", reason] : []),
    "",
    `Open: ${args.artifactUrl}`,
  ].join("\n");

  await sendEmail({
    to: args.to,
    subject,
    html,
    text,
  });
}

export async function sendArtifactApprovedEmail(args: {
  to: string;
  recipientName?: string | null;
  artifactTitle: string;
  artifactType: string;
  projectTitle: string;
  projectRef: string;
  artifactUrl: string;
  approvedByName?: string | null;
}) {
  const subject = `Approved — ${args.artifactTitle}`;
  const greeting = args.recipientName?.trim() ? `Hi ${args.recipientName},` : "Hi,";
  const approvedBy = args.approvedByName?.trim() || "An approver";

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(approvedBy)}</strong> approved the artifact in Aliena AI.</p>

      <div style="margin:16px 0;padding:16px;border:1px solid #dcfce7;border-radius:12px;background:#f0fdf4">
        <div><strong>Project:</strong> ${escapeHtml(args.projectTitle)} (${escapeHtml(args.projectRef)})</div>
        <div><strong>Artifact:</strong> ${escapeHtml(args.artifactTitle)}</div>
        <div><strong>Type:</strong> ${escapeHtml(args.artifactType)}</div>
      </div>

      <p>
        <a
          href="${escapeHtml(args.artifactUrl)}"
          style="display:inline-block;padding:10px 16px;border-radius:10px;background:#166534;color:#ffffff;text-decoration:none;font-weight:600"
        >
          View approved artifact
        </a>
      </p>
    </div>
  `;

  const text = [
    greeting,
    "",
    `${approvedBy} approved the artifact in Aliena AI.`,
    "",
    `Project: ${args.projectTitle} (${args.projectRef})`,
    `Artifact: ${args.artifactTitle}`,
    `Type: ${args.artifactType}`,
    "",
    `View: ${args.artifactUrl}`,
  ].join("\n");

  await sendEmail({
    to: args.to,
    subject,
    html,
    text,
  });
}

export async function sendArtifactRejectedEmail(args: {
  to: string;
  recipientName?: string | null;
  artifactTitle: string;
  artifactType: string;
  projectTitle: string;
  projectRef: string;
  artifactUrl: string;
  rejectedByName?: string | null;
  reason?: string | null;
}) {
  const subject = `Rejected — ${args.artifactTitle}`;
  const greeting = args.recipientName?.trim() ? `Hi ${args.recipientName},` : "Hi,";
  const rejectedBy = args.rejectedByName?.trim() || "An approver";
  const reason = (args.reason || "").trim();

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(rejectedBy)}</strong> rejected the artifact in Aliena AI.</p>

      <div style="margin:16px 0;padding:16px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2">
        <div><strong>Project:</strong> ${escapeHtml(args.projectTitle)} (${escapeHtml(args.projectRef)})</div>
        <div><strong>Artifact:</strong> ${escapeHtml(args.artifactTitle)}</div>
        <div><strong>Type:</strong> ${escapeHtml(args.artifactType)}</div>
      </div>

      ${
        reason
          ? `
      <div style="margin:16px 0;padding:16px;border:1px solid #fecaca;border-radius:12px;background:#fff1f2">
        <div style="font-weight:700;margin-bottom:8px">Rejection reason</div>
        <div>${escapeHtml(reason)}</div>
      </div>
      `
          : ""
      }

      <p>
        <a
          href="${escapeHtml(args.artifactUrl)}"
          style="display:inline-block;padding:10px 16px;border-radius:10px;background:#991b1b;color:#ffffff;text-decoration:none;font-weight:600"
        >
          View artifact
        </a>
      </p>
    </div>
  `;

  const text = [
    greeting,
    "",
    `${rejectedBy} rejected the artifact in Aliena AI.`,
    "",
    `Project: ${args.projectTitle} (${args.projectRef})`,
    `Artifact: ${args.artifactTitle}`,
    `Type: ${args.artifactType}`,
    ...(reason ? ["", "Rejection reason:", reason] : []),
    "",
    `View: ${args.artifactUrl}`,
  ].join("\n");

  await sendEmail({
    to: args.to,
    subject,
    html,
    text,
  });
}