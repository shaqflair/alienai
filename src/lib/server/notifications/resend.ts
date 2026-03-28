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

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

type ApprovalEntityKind = "artifact" | "change_request";

type GenericEntityArgs = {
  to: string;
  recipientName?: string | null;
  approverName?: string | null;
  entityKind: ApprovalEntityKind;
  entityTitle: string;
  entityType: string;
  projectTitle: string;
  projectRef: string;
  entityUrl: string;
  submittedByName?: string | null;
  approvedByName?: string | null;
  rejectedByName?: string | null;
  requestedByName?: string | null;
  reason?: string | null;
};

function entityLabel(kind: ApprovalEntityKind) {
  return kind === "change_request" ? "change request" : "artifact";
}
function reviewVerb(kind: ApprovalEntityKind) {
  return kind === "change_request" ? "Review change request" : "Review artifact";
}
function updateVerb(kind: ApprovalEntityKind) {
  return kind === "change_request" ? "Review and update change request" : "Review and update artifact";
}
function approvedVerb(kind: ApprovalEntityKind) {
  return kind === "change_request" ? "View approved change request" : "View approved artifact";
}
function rejectedVerb(kind: ApprovalEntityKind) {
  return kind === "change_request" ? "View change request" : "View artifact";
}

async function sendEmail(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
}) {
  const from = requiredEnv("RESEND_FROM");
  const { error } = await resend.emails.send({
    from,
    to: [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

export async function sendApprovalAssignedEmailGeneric(args: GenericEntityArgs) {
  const kindLabel = entityLabel(args.entityKind);
  const subject = `Action required -- ${args.entityTitle} awaiting your approval`;
  const greeting = args.approverName?.trim() ? `Hi ${args.approverName},` : "Hi,";
  const submittedBy = args.submittedByName?.trim() || "A team member";

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(submittedBy)}</strong> submitted a ${escapeHtml(kindLabel)} for your approval in Aliena AI.</p>
      <div style="margin:16px 0;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc">
        <div><strong>Project:</strong> ${escapeHtml(args.projectTitle)} (${escapeHtml(args.projectRef)})</div>
        <div><strong>${escapeHtml(args.entityKind === "change_request" ? "Change Request" : "Artifact")}:</strong> ${escapeHtml(args.entityTitle)}</div>
        <div><strong>Type:</strong> ${escapeHtml(args.entityType)}</div>
      </div>
      <p>
        <a href="${escapeHtml(args.entityUrl)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:600">
          ${escapeHtml(reviewVerb(args.entityKind))}
        </a>
      </p>
      <p style="color:#475569">Please review and approve, request changes, or reject as appropriate.</p>
    </div>
  `;

  const text = [
    greeting, "",
    `${submittedBy} submitted a ${kindLabel} for your approval in Aliena AI.`, "",
    `Project: ${args.projectTitle} (${args.projectRef})`,
    `${args.entityKind === "change_request" ? "Change Request" : "Artifact"}: ${args.entityTitle}`,
    `Type: ${args.entityType}`, "",
    `Review: ${args.entityUrl}`,
  ].join("\n");

  await sendEmail({ to: args.to, subject, html, text });
}

export async function sendChangesRequestedEmailGeneric(args: GenericEntityArgs) {
  const kindLabel = entityLabel(args.entityKind);
  const subject = `Changes requested -- ${args.entityTitle}`;
  const greeting = args.recipientName?.trim() ? `Hi ${args.recipientName},` : "Hi,";
  const requestedBy = args.requestedByName?.trim() || "An approver";
  const reason = safeStr(args.reason).trim();

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(requestedBy)}</strong> requested changes to a ${escapeHtml(kindLabel)} in Aliena AI.</p>
      <div style="margin:16px 0;padding:16px;border:1px solid #e2e8f0;border-radius:12px;background:#fff7ed">
        <div><strong>Project:</strong> ${escapeHtml(args.projectTitle)} (${escapeHtml(args.projectRef)})</div>
        <div><strong>${escapeHtml(args.entityKind === "change_request" ? "Change Request" : "Artifact")}:</strong> ${escapeHtml(args.entityTitle)}</div>
        <div><strong>Type:</strong> ${escapeHtml(args.entityType)}</div>
      </div>
      ${reason ? `
      <div style="margin:16px 0;padding:16px;border:1px solid #fed7aa;border-radius:12px;background:#fffaf5">
        <div style="font-weight:700;margin-bottom:8px">Reviewer feedback</div>
        <div>${escapeHtml(reason)}</div>
      </div>` : ""}
      <p>
        <a href="${escapeHtml(args.entityUrl)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#b45309;color:#ffffff;text-decoration:none;font-weight:600">
          ${escapeHtml(updateVerb(args.entityKind))}
        </a>
      </p>
      <p style="color:#475569">Update the ${escapeHtml(kindLabel)} and resubmit it for approval once ready.</p>
    </div>
  `;

  const text = [
    greeting, "",
    `${requestedBy} requested changes to a ${kindLabel} in Aliena AI.`, "",
    `Project: ${args.projectTitle} (${args.projectRef})`,
    `${args.entityKind === "change_request" ? "Change Request" : "Artifact"}: ${args.entityTitle}`,
    `Type: ${args.entityType}`,
    ...(reason ? ["", "Reviewer feedback:", reason] : []),
    "", `Open: ${args.entityUrl}`,
  ].join("\n");

  await sendEmail({ to: args.to, subject, html, text });
}

export async function sendApprovedEmailGeneric(args: GenericEntityArgs) {
  const kindLabel = entityLabel(args.entityKind);
  const subject = `Approved -- ${args.entityTitle}`;
  const greeting = args.recipientName?.trim() ? `Hi ${args.recipientName},` : "Hi,";
  const approvedBy = args.approvedByName?.trim() || "An approver";

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(approvedBy)}</strong> approved the ${escapeHtml(kindLabel)} in Aliena AI.</p>
      <div style="margin:16px 0;padding:16px;border:1px solid #dcfce7;border-radius:12px;background:#f0fdf4">
        <div><strong>Project:</strong> ${escapeHtml(args.projectTitle)} (${escapeHtml(args.projectRef)})</div>
        <div><strong>${escapeHtml(args.entityKind === "change_request" ? "Change Request" : "Artifact")}:</strong> ${escapeHtml(args.entityTitle)}</div>
        <div><strong>Type:</strong> ${escapeHtml(args.entityType)}</div>
      </div>
      <p>
        <a href="${escapeHtml(args.entityUrl)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#166534;color:#ffffff;text-decoration:none;font-weight:600">
          ${escapeHtml(approvedVerb(args.entityKind))}
        </a>
      </p>
    </div>
  `;

  const text = [
    greeting, "",
    `${approvedBy} approved the ${kindLabel} in Aliena AI.`, "",
    `Project: ${args.projectTitle} (${args.projectRef})`,
    `${args.entityKind === "change_request" ? "Change Request" : "Artifact"}: ${args.entityTitle}`,
    `Type: ${args.entityType}`, "",
    `View: ${args.entityUrl}`,
  ].join("\n");

  await sendEmail({ to: args.to, subject, html, text });
}

export async function sendRejectedEmailGeneric(args: GenericEntityArgs) {
  const kindLabel = entityLabel(args.entityKind);
  const subject = `Rejected -- ${args.entityTitle}`;
  const greeting = args.recipientName?.trim() ? `Hi ${args.recipientName},` : "Hi,";
  const rejectedBy = args.rejectedByName?.trim() || "An approver";
  const reason = safeStr(args.reason).trim();

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#0f172a">
      <p>${escapeHtml(greeting)}</p>
      <p><strong>${escapeHtml(rejectedBy)}</strong> rejected the ${escapeHtml(kindLabel)} in Aliena AI.</p>
      <div style="margin:16px 0;padding:16px;border:1px solid #fecaca;border-radius:12px;background:#fef2f2">
        <div><strong>Project:</strong> ${escapeHtml(args.projectTitle)} (${escapeHtml(args.projectRef)})</div>
        <div><strong>${escapeHtml(args.entityKind === "change_request" ? "Change Request" : "Artifact")}:</strong> ${escapeHtml(args.entityTitle)}</div>
        <div><strong>Type:</strong> ${escapeHtml(args.entityType)}</div>
      </div>
      ${reason ? `
      <div style="margin:16px 0;padding:16px;border:1px solid #fecaca;border-radius:12px;background:#fff1f2">
        <div style="font-weight:700;margin-bottom:8px">Rejection reason</div>
        <div>${escapeHtml(reason)}</div>
      </div>` : ""}
      <p>
        <a href="${escapeHtml(args.entityUrl)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#991b1b;color:#ffffff;text-decoration:none;font-weight:600">
          ${escapeHtml(rejectedVerb(args.entityKind))}
        </a>
      </p>
    </div>
  `;

  const text = [
    greeting, "",
    `${rejectedBy} rejected the ${kindLabel} in Aliena AI.`, "",
    `Project: ${args.projectTitle} (${args.projectRef})`,
    `${args.entityKind === "change_request" ? "Change Request" : "Artifact"}: ${args.entityTitle}`,
    `Type: ${args.entityType}`,
    ...(reason ? ["", "Rejection reason:", reason] : []),
    "", `View: ${args.entityUrl}`,
  ].join("\n");

  await sendEmail({ to: args.to, subject, html, text });
}

/* ------------------------------------------------------------------ */
/* Backward-compatible artifact wrappers                               */
/* ------------------------------------------------------------------ */

export async function sendApprovalAssignedEmail(args: {
  to: string; approverName?: string | null; artifactTitle: string;
  artifactType: string; projectTitle: string; projectRef: string;
  artifactUrl: string; submittedByName?: string | null;
}) {
  await sendApprovalAssignedEmailGeneric({
    to: args.to, approverName: args.approverName ?? null,
    entityKind: "artifact", entityTitle: args.artifactTitle,
    entityType: args.artifactType, projectTitle: args.projectTitle,
    projectRef: args.projectRef, entityUrl: args.artifactUrl,
    submittedByName: args.submittedByName ?? null,
  });
}

export async function sendChangesRequestedEmail(args: {
  to: string; recipientName?: string | null; artifactTitle: string;
  artifactType: string; projectTitle: string; projectRef: string;
  artifactUrl: string; requestedByName?: string | null; reason?: string | null;
}) {
  await sendChangesRequestedEmailGeneric({
    to: args.to, recipientName: args.recipientName ?? null,
    entityKind: "artifact", entityTitle: args.artifactTitle,
    entityType: args.artifactType, projectTitle: args.projectTitle,
    projectRef: args.projectRef, entityUrl: args.artifactUrl,
    requestedByName: args.requestedByName ?? null, reason: args.reason ?? null,
  });
}

export async function sendArtifactApprovedEmail(args: {
  to: string; recipientName?: string | null; artifactTitle: string;
  artifactType: string; projectTitle: string; projectRef: string;
  artifactUrl: string; approvedByName?: string | null;
}) {
  await sendApprovedEmailGeneric({
    to: args.to, recipientName: args.recipientName ?? null,
    entityKind: "artifact", entityTitle: args.artifactTitle,
    entityType: args.artifactType, projectTitle: args.projectTitle,
    projectRef: args.projectRef, entityUrl: args.artifactUrl,
    approvedByName: args.approvedByName ?? null,
  });
}

export async function sendArtifactRejectedEmail(args: {
  to: string; recipientName?: string | null; artifactTitle: string;
  artifactType: string; projectTitle: string; projectRef: string;
  artifactUrl: string; rejectedByName?: string | null; reason?: string | null;
}) {
  await sendRejectedEmailGeneric({
    to: args.to, recipientName: args.recipientName ?? null,
    entityKind: "artifact", entityTitle: args.artifactTitle,
    entityType: args.artifactType, projectTitle: args.projectTitle,
    projectRef: args.projectRef, entityUrl: args.artifactUrl,
    rejectedByName: args.rejectedByName ?? null, reason: args.reason ?? null,
  });
}

/* ------------------------------------------------------------------ */
/* Change-request wrappers                                             */
/* ------------------------------------------------------------------ */

export async function sendChangeApprovalAssignedEmail(args: {
  to: string; approverName?: string | null; changeTitle: string;
  changeType: string; projectTitle: string; projectRef: string;
  changeUrl: string; submittedByName?: string | null;
}) {
  await sendApprovalAssignedEmailGeneric({
    to: args.to, approverName: args.approverName ?? null,
    entityKind: "change_request", entityTitle: args.changeTitle,
    entityType: args.changeType, projectTitle: args.projectTitle,
    projectRef: args.projectRef, entityUrl: args.changeUrl,
    submittedByName: args.submittedByName ?? null,
  });
}

export async function sendChangeChangesRequestedEmail(args: {
  to: string; recipientName?: string | null; changeTitle: string;
  changeType: string; projectTitle: string; projectRef: string;
  changeUrl: string; requestedByName?: string | null; reason?: string | null;
}) {
  await sendChangesRequestedEmailGeneric({
    to: args.to, recipientName: args.recipientName ?? null,
    entityKind: "change_request", entityTitle: args.changeTitle,
    entityType: args.changeType, projectTitle: args.projectTitle,
    projectRef: args.projectRef, entityUrl: args.changeUrl,
    requestedByName: args.requestedByName ?? null, reason: args.reason ?? null,
  });
}

export async function sendChangeApprovedEmail(args: {
  to: string; recipientName?: string | null; changeTitle: string;
  changeType: string; projectTitle: string; projectRef: string;
  changeUrl: string; approvedByName?: string | null;
}) {
  await sendApprovedEmailGeneric({
    to: args.to, recipientName: args.recipientName ?? null,
    entityKind: "change_request", entityTitle: args.changeTitle,
    entityType: args.changeType, projectTitle: args.projectTitle,
    projectRef: args.projectRef, entityUrl: args.changeUrl,
    approvedByName: args.approvedByName ?? null,
  });
}

export async function sendChangeRejectedEmail(args: {
  to: string; recipientName?: string | null; changeTitle: string;
  changeType: string; projectTitle: string; projectRef: string;
  changeUrl: string; rejectedByName?: string | null; reason?: string | null;
}) {
  await sendRejectedEmailGeneric({
    to: args.to, recipientName: args.recipientName ?? null,
    entityKind: "change_request", entityTitle: args.changeTitle,
    entityType: args.changeType, projectTitle: args.projectTitle,
    projectRef: args.projectRef, entityUrl: args.changeUrl,
    rejectedByName: args.rejectedByName ?? null, reason: args.reason ?? null,
  });
}

