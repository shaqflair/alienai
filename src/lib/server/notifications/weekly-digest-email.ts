import "server-only";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

function requiredEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function esc(v: any): string {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function ragColor(rag: string): string {
  const r = safeStr(rag).toUpperCase();
  if (r === "R" || r === "RED")    return "#dc2626";
  if (r === "A" || r === "AMBER")  return "#d97706";
  return "#16a34a";
}

function ragLabel(rag: string): string {
  const r = safeStr(rag).toUpperCase();
  if (r === "R" || r === "RED")    return "RED";
  if (r === "A" || r === "AMBER")  return "AMBER";
  return "GREEN";
}

/* ── Types ──────────────────────────────────────────────────────────── */

export type DigestProject = {
  project_id: string;
  project_code: string | null;
  project_title: string;
  rag: "R" | "A" | "G" | string;
  pending_approvals: number;
  sla_breaches: number;
  overdue_raid: number;
  milestones_due_7d: number;
  budget_variance_pct: number | null;   // negative = under, positive = over
  forecast_alert: boolean;              // timesheet burn > forecast by >10%
};

export type WeeklyDigestArgs = {
  to: string;
  recipientName: string | null;
  weekOf: string;           // e.g. "14 Apr 2026"
  baseUrl: string;
  projects: DigestProject[];
  totalPendingApprovals: number;
  totalSlaBreaches: number;
  totalOverdueRaid: number;
  totalMilestonesDue: number;
};

/* ── Email builder ──────────────────────────────────────────────────── */

function buildHtml(args: WeeklyDigestArgs): string {
  const greeting = args.recipientName ? `Hi ${esc(args.recipientName)},` : "Hi,";
  const hasAlerts = args.totalSlaBreaches > 0 || args.totalOverdueRaid > 0 || args.totalPendingApprovals > 0;

  const summaryRow = (label: string, val: number, color: string, href: string) =>
    val > 0
      ? `<tr>
          <td style="padding:6px 0;font-size:13px;color:#475569">${esc(label)}</td>
          <td style="padding:6px 0;text-align:right">
            <a href="${esc(href)}" style="font-size:13px;font-weight:700;color:${color};text-decoration:none">${val}</a>
          </td>
        </tr>`
      : `<tr>
          <td style="padding:6px 0;font-size:13px;color:#94a3b8">${esc(label)}</td>
          <td style="padding:6px 0;text-align:right;font-size:13px;color:#94a3b8">0</td>
        </tr>`;

  const projectRows = args.projects.map(p => {
    const rc = ragColor(p.rag);
    const rl = ragLabel(p.rag);
    const alerts: string[] = [];
    if (p.sla_breaches > 0)      alerts.push(`${p.sla_breaches} SLA breach${p.sla_breaches !== 1 ? "es" : ""}`);
    if (p.overdue_raid > 0)      alerts.push(`${p.overdue_raid} overdue RAID`);
    if (p.milestones_due_7d > 0) alerts.push(`${p.milestones_due_7d} milestone${p.milestones_due_7d !== 1 ? "s" : ""} due`);
    if (p.forecast_alert)        alerts.push("forecast may need updating");

    const budgetStr = p.budget_variance_pct != null
      ? `${p.budget_variance_pct > 0 ? "+" : ""}${p.budget_variance_pct.toFixed(1)}% vs approved`
      : null;

    const href = `${args.baseUrl}/projects/${p.project_id}`;

    return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid #f1f5f9">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
            <span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:${rc}18;color:${rc};border:1px solid ${rc}40">${esc(rl)}</span>
            ${p.project_code ? `<span style="font-size:10px;font-weight:700;color:#4338ca;background:#eef2ff;border:1px solid #c7d2fe;border-radius:5px;padding:2px 6px">${esc(p.project_code)}</span>` : ""}
            <a href="${esc(href)}" style="font-size:13px;font-weight:700;color:#0f172a;text-decoration:none">${esc(p.project_title)}</a>
          </div>
          <div style="font-size:11px;color:#94a3b8">
            ${alerts.length ? alerts.map(a => `<span style="margin-right:10px">· ${esc(a)}</span>`).join("") : '<span style="color:#16a34a">· No alerts</span>'}
            ${budgetStr ? `<span style="margin-right:10px;color:${p.budget_variance_pct! > 10 ? "#dc2626" : "#475569"}">· Budget: ${esc(budgetStr)}</span>` : ""}
          </div>
          ${p.pending_approvals > 0 ? `<div style="margin-top:4px"><a href="${esc(`${args.baseUrl}/projects/${p.project_id}?tab=approvals`)}" style="font-size:11px;color:#6366f1;font-weight:600;text-decoration:none">${p.pending_approvals} approval${p.pending_approvals !== 1 ? "s" : ""} awaiting action →</a></div>` : ""}
        </td>
      </tr>`;
  }).join("");

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Inter,Arial,sans-serif">
  <div style="max-width:600px;margin:0 auto;padding:32px 16px">

    <div style="background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:16px 16px 0 0;padding:24px 28px;margin-bottom:0">
      <div style="font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#6366f1;margin-bottom:6px">Aliena · Governance Intelligence</div>
      <div style="font-size:20px;font-weight:800;color:#ffffff;margin-bottom:4px">Weekly Project Digest</div>
      <div style="font-size:12px;color:#94a3b8">Week of ${esc(args.weekOf)}</div>
    </div>

    <div style="background:#ffffff;border-radius:0 0 16px 16px;padding:28px;border:1px solid #e2e8f0;border-top:none">
      <p style="margin:0 0 20px;font-size:14px;color:#475569">${greeting}</p>
      <p style="margin:0 0 24px;font-size:14px;color:#475569">
        Here's your weekly governance summary for the projects you manage.
        ${hasAlerts ? "There are items that need your attention this week." : "Everything looks on track this week."}
      </p>

      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px 20px;margin-bottom:24px">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8;margin-bottom:12px">Portfolio Summary</div>
        <table style="width:100%;border-collapse:collapse">
          <tbody>
            ${summaryRow("Pending Approvals",   args.totalPendingApprovals, "#6366f1", `${args.baseUrl}/approvals`)}
            ${summaryRow("SLA Breaches",        args.totalSlaBreaches,      "#dc2626", `${args.baseUrl}/approvals`)}
            ${summaryRow("Overdue RAID Items",  args.totalOverdueRaid,      "#d97706", `${args.baseUrl}/portfolio/raid`)}
            ${summaryRow("Milestones Due (7d)", args.totalMilestonesDue,    "#0e7490", `${args.baseUrl}/milestones`)}
          </tbody>
        </table>
      </div>

      ${args.projects.length > 0 ? `
      <div style="font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#94a3b8;margin-bottom:12px">Your Projects</div>
      <table style="width:100%;border-collapse:collapse">
        <tbody>${projectRows}</tbody>
      </table>
      ` : ""}

      <div style="margin-top:28px;text-align:center">
        <a href="${esc(args.baseUrl)}/portfolio"
          style="display:inline-block;padding:12px 28px;border-radius:12px;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px">
          Open Portfolio Dashboard
        </a>
      </div>

      <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;text-align:center">
        You're receiving this because you're a project manager on Aliena.<br>
        Digest sent every Monday · <a href="${esc(args.baseUrl)}/settings" style="color:#6366f1;text-decoration:none">Manage notifications</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}

function buildText(args: WeeklyDigestArgs): string {
  const lines: string[] = [
    `ALIENA — Weekly Project Digest`,
    `Week of ${args.weekOf}`,
    "",
    args.recipientName ? `Hi ${args.recipientName},` : "Hi,",
    "",
    "Your weekly governance summary:",
    "",
    `Pending Approvals : ${args.totalPendingApprovals}`,
    `SLA Breaches      : ${args.totalSlaBreaches}`,
    `Overdue RAID      : ${args.totalOverdueRaid}`,
    `Milestones Due 7d : ${args.totalMilestonesDue}`,
    "",
    "PROJECTS",
    "--------",
  ];

  for (const p of args.projects) {
    lines.push(`[${ragLabel(p.rag)}] ${p.project_code ? p.project_code + " – " : ""}${p.project_title}`);
    if (p.pending_approvals > 0) lines.push(`  · ${p.pending_approvals} pending approval(s)`);
    if (p.sla_breaches > 0)      lines.push(`  · ${p.sla_breaches} SLA breach(es)`);
    if (p.overdue_raid > 0)      lines.push(`  · ${p.overdue_raid} overdue RAID item(s)`);
    if (p.milestones_due_7d > 0) lines.push(`  · ${p.milestones_due_7d} milestone(s) due this week`);
    if (p.forecast_alert)        lines.push(`  · Forecast may need updating (timesheet burn mismatch)`);
    lines.push(`  ${args.baseUrl}/projects/${p.project_id}`);
    lines.push("");
  }

  lines.push(`Open dashboard: ${args.baseUrl}/portfolio`);
  return lines.join("\n");
}

/* ── Export ─────────────────────────────────────────────────────────── */

export async function sendWeeklyDigestEmail(args: WeeklyDigestArgs): Promise<void> {
  const from = requiredEnv("RESEND_FROM");
  const subject = args.totalSlaBreaches > 0 || args.totalPendingApprovals > 0
    ? `⚠ Weekly digest — ${args.totalPendingApprovals} pending, ${args.totalSlaBreaches} SLA breach${args.totalSlaBreaches !== 1 ? "es" : ""}`
    : `✓ Weekly digest — ${args.weekOf} · All on track`;

  const { error } = await resend.emails.send({
    from,
    to: [args.to],
    subject,
    html: buildHtml(args),
    text: buildText(args),
  });

  if (error) throw new Error(`Resend weekly digest failed: ${error.message}`);
}
