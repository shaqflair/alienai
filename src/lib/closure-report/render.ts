// src/lib/closure-report/render.ts
import "server-only";

type Rag = "green" | "amber" | "red";

type ClosureDocV1 = {
  version: 1;
  project: {
    project_name: string;
    project_code: string;
    client_name: string;
    sponsor: string;
    pm: string;
  };
  health: {
    rag: Rag;
    overall_health: "good" | "watch" | "critical";
    summary: string;
  };
  stakeholders: { key: { name: string; role: string }[] };
  achievements: { key_achievements: { text: string }[] };
  success: { criteria: { text: string; achieved: "yes" | "partial" | "no" }[] };
  deliverables: {
    delivered: { deliverable: string; accepted_by: string; accepted_on: string | null }[];
    outstanding: { item: string; owner: string; status: string; target: string }[];
    acceptance_checklist: {
      sponsor_signed: boolean;
      bau_accepted: boolean;
      knowledge_transfer_done: boolean;
    };
    sponsor_signoff_name: string;
    sponsor_signoff_date: string | null;
  };
  financial_closeout: {
    budget_rows: { category: string; budget: number | null; actual: number | null }[];
    roi: {
      annual_benefit: string;
      payback_achieved: string;
      payback_planned: string;
      npv: string;
    };
  };
  lessons: {
    went_well: { text: string; action?: string }[];
    didnt_go_well: { text: string; action?: string }[];
    surprises_risks: { text: string; action?: string }[];
  };
  handover: {
    risks_issues: { id: string; description: string; severity: "high" | "medium" | "low"; owner: string; status: string; next_action: string }[];
    team_moves: { person: string; change: string; date: string | null }[];
    knowledge_transfer: {
      docs_handed_over: boolean;
      final_demo_done: boolean;
      support_model_doc: boolean;
      runbook_finalised: boolean;
      notes: string;
    };
    support_model: { primary_support: string; escalation: string; hypercare_end: string | null };
  };
  recommendations: { items: { text: string; owner?: string; due?: string | null }[] };
  links: { items: { label: string; url: string }[] };
  attachments: { items: { label?: string | null; url: string; filename?: string | null; size_bytes?: number | null; uploaded_at?: string | null }[] };
  signoff: {
    sponsor_name: string;
    sponsor_date: string | null;
    sponsor_decision: "" | "approved" | "conditional" | "rejected";
    pm_name: string;
    pm_date: string | null;
    pm_approved: boolean;
  };
};

export function renderClosureReportHtml(params: {
  doc: ClosureDocV1;
  title?: string;
  generatedAtIso?: string;
  brandName?: string;
}) {
  const { doc, title = "Project Closure Report", generatedAtIso = new Date().toISOString(), brandName = "ALIENAI" } = params;

  const esc = (s: any) =>
    String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const fmtDate = (iso: string | null) => {
    if (!iso) return "";
    try {
      const d = new Date(iso);
      // UK-style date to match your app
      return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    } catch {
      return String(iso);
    }
  };

  const money = (n: number | null | undefined) => {
    if (n == null || !Number.isFinite(n)) return "";
    return Number(n).toLocaleString("en-GB");
  };

  const rag = doc.health?.rag || "green";
  const ragLabel = rag.toUpperCase();
  const ragColor =
    rag === "green" ? { bg: "#EAFBF1", fg: "#0F5132", bd: "#BDE7CD" } :
    rag === "amber" ? { bg: "#FFF6E6", fg: "#7A4B00", bd: "#F7D59A" } :
    { bg: "#FDECEC", fg: "#842029", bd: "#F3B6BE" };

  const overall = doc.health?.overall_health || "good";
  const overallMap: Record<string, { bg: string; fg: string; bd: string; label: string }> = {
    good: { bg: "#EAFBF1", fg: "#0F5132", bd: "#BDE7CD", label: "GOOD" },
    watch: { bg: "#FFF6E6", fg: "#7A4B00", bd: "#F7D59A", label: "WATCH" },
    critical: { bg: "#FDECEC", fg: "#842029", bd: "#F3B6BE", label: "CRITICAL" },
  };

  const budgetRows = doc.financial_closeout?.budget_rows || [];
  const budgetTotal = budgetRows.reduce((s, r) => s + (r.budget ?? 0), 0);
  const actualTotal = budgetRows.reduce((s, r) => s + (r.actual ?? 0), 0);
  const variance = actualTotal - budgetTotal;
  const variancePct = budgetTotal ? (variance / budgetTotal) * 100 : null;

  const yn = (b: boolean) => (b ? "Yes" : "No");

  const section = (label: string, inner: string) => `
    <div class="section">
      <div class="section-h">${esc(label)}</div>
      <div class="section-b">${inner}</div>
    </div>
  `;

  const table = (headers: string[], rows: string[][]) => `
    <table class="tbl">
      <thead>
        <tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;

  const bullets = (items: { text: string; action?: string }[]) => {
    if (!items?.length) return `<div class="muted">None.</div>`;
    return `
      <ul class="bul">
        ${items
          .map(
            (x) =>
              `<li><div class="bul-main">${esc(x.text)}</div>${
                x.action ? `<div class="bul-sub">Action: ${esc(x.action)}</div>` : ""
              }</li>`
          )
          .join("")}
      </ul>
    `;
  };

  const stakeholdersHtml = (() => {
    const s = doc.stakeholders?.key || [];
    if (!s.length) return `<div class="muted">No stakeholders added.</div>`;
    return table(
      ["Name", "Role"],
      s.map((x) => [esc(x.name), esc(x.role)])
    );
  })();

  const achievementsHtml = (() => {
    const a = doc.achievements?.key_achievements || [];
    if (!a.length) return `<div class="muted">No achievements recorded.</div>`;
    return `<ul class="bul">${a.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul>`;
  })();

  const successHtml = (() => {
    const c = doc.success?.criteria || [];
    if (!c.length) return `<div class="muted">No success criteria recorded.</div>`;
    return table(
      ["Criterion", "Status"],
      c.map((x) => [
        esc(x.text),
        esc(x.achieved === "yes" ? "Achieved" : x.achieved === "partial" ? "Partially achieved" : "Not achieved"),
      ])
    );
  })();

  const deliverablesHtml = (() => {
    const delivered = doc.deliverables?.delivered || [];
    const outstanding = doc.deliverables?.outstanding || [];
    const chk = doc.deliverables?.acceptance_checklist;

    const deliveredTbl =
      delivered.length === 0
        ? `<div class="muted">No delivered items recorded.</div>`
        : table(
            ["Deliverable", "Accepted by", "Accepted on"],
            delivered.map((x) => [esc(x.deliverable), esc(x.accepted_by), esc(fmtDate(x.accepted_on))])
          );

    const outstandingTbl =
      outstanding.length === 0
        ? `<div class="muted">No outstanding items.</div>`
        : table(
            ["Item", "Owner", "Status", "Target"],
            outstanding.map((x) => [esc(x.item), esc(x.owner), esc(x.status), esc(x.target)])
          );

    const checks = `
      <div class="grid3">
        <div class="kv"><div class="k">Sponsor signed off</div><div class="v">${yn(!!chk?.sponsor_signed)}</div></div>
        <div class="kv"><div class="k">BAU / Ops accepted</div><div class="v">${yn(!!chk?.bau_accepted)}</div></div>
        <div class="kv"><div class="k">Knowledge transfer completed</div><div class="v">${yn(!!chk?.knowledge_transfer_done)}</div></div>
      </div>
      <div class="grid2 mt8">
        <div class="kv"><div class="k">Sponsor sign-off name</div><div class="v">${esc(doc.deliverables?.sponsor_signoff_name)}</div></div>
        <div class="kv"><div class="k">Sign-off date</div><div class="v">${esc(fmtDate(doc.deliverables?.sponsor_signoff_date ?? null))}</div></div>
      </div>
    `;

    return `
      <div class="subh">Delivered Items</div>
      ${deliveredTbl}
      <div class="sp16"></div>
      <div class="subh">Outstanding Items</div>
      ${outstandingTbl}
      <div class="sp16"></div>
      <div class="subh">Acceptance Checklist</div>
      ${checks}
    `;
  })();

  const financialHtml = (() => {
    const roi = doc.financial_closeout?.roi;
    const rowsTbl =
      budgetRows.length === 0
        ? `<div class="muted">No financial rows.</div>`
        : table(
            ["Category", "Budget", "Actual"],
            budgetRows.map((r) => [esc(r.category), esc(money(r.budget)), esc(money(r.actual))])
          );

    return `
      <div class="kpi-row">
        <div class="kpi">
          <div class="kpi-l">Budget</div>
          <div class="kpi-v">${esc(money(budgetTotal))}</div>
        </div>
        <div class="kpi">
          <div class="kpi-l">Actual</div>
          <div class="kpi-v">${esc(money(actualTotal))}</div>
        </div>
        <div class="kpi">
          <div class="kpi-l">Variance</div>
          <div class="kpi-v">${esc(money(variance))}${variancePct != null ? ` <span class="muted">(${variancePct.toFixed(1)}%)</span>` : ""}</div>
        </div>
      </div>

      <div class="subh">Budget vs Actual</div>
      ${rowsTbl}

      <div class="sp16"></div>
      <div class="subh">ROI & Benefits</div>
      <div class="grid2">
        <div class="kv"><div class="k">Annual benefit</div><div class="v">${esc(roi?.annual_benefit)}</div></div>
        <div class="kv"><div class="k">Payback achieved</div><div class="v">${esc(roi?.payback_achieved)}</div></div>
        <div class="kv"><div class="k">Payback planned</div><div class="v">${esc(roi?.payback_planned)}</div></div>
        <div class="kv"><div class="k">NPV</div><div class="v">${esc(roi?.npv)}</div></div>
      </div>
    `;
  })();

  const handoverHtml = (() => {
    const ri = doc.handover?.risks_issues || [];
    const tm = doc.handover?.team_moves || [];
    const kt = doc.handover?.knowledge_transfer;
    const sm = doc.handover?.support_model;

    const riTbl =
      ri.length === 0
        ? `<div class="muted">No open risks or issues recorded.</div>`
        : table(
            ["ID", "Description", "Severity", "Owner", "Status", "Next action"],
            ri.map((x) => [esc(x.id), esc(x.description), esc(x.severity), esc(x.owner), esc(x.status), esc(x.next_action)])
          );

    const tmTbl =
      tm.length === 0
        ? `<div class="muted">No team changes recorded.</div>`
        : table(["Person", "Change", "Date"], tm.map((x) => [esc(x.person), esc(x.change), esc(fmtDate(x.date))]));

    return `
      <div class="subh">Open Risks & Issues</div>
      ${riTbl}
      <div class="sp16"></div>

      <div class="subh">Team Moves / Changes</div>
      ${tmTbl}
      <div class="sp16"></div>

      <div class="subh">Knowledge Transfer</div>
      <div class="grid2">
        <div class="kv"><div class="k">Documentation handed over</div><div class="v">${yn(!!kt?.docs_handed_over)}</div></div>
        <div class="kv"><div class="k">Final demo completed</div><div class="v">${yn(!!kt?.final_demo_done)}</div></div>
        <div class="kv"><div class="k">Support model documented</div><div class="v">${yn(!!kt?.support_model_doc)}</div></div>
        <div class="kv"><div class="k">Runbook finalised</div><div class="v">${yn(!!kt?.runbook_finalised)}</div></div>
      </div>
      <div class="kv mt8">
        <div class="k">Additional notes</div>
        <div class="v">${esc(kt?.notes)}</div>
      </div>

      <div class="sp16"></div>
      <div class="subh">Target Operating / Support Model</div>
      <div class="grid2">
        <div class="kv"><div class="k">Primary support</div><div class="v">${esc(sm?.primary_support)}</div></div>
        <div class="kv"><div class="k">Escalation</div><div class="v">${esc(sm?.escalation)}</div></div>
        <div class="kv"><div class="k">Hypercare end</div><div class="v">${esc(fmtDate(sm?.hypercare_end ?? null))}</div></div>
      </div>
    `;
  })();

  const recsHtml = (() => {
    const items = doc.recommendations?.items || [];
    if (!items.length) return `<div class="muted">No recommendations recorded.</div>`;
    return table(
      ["Action", "Owner", "Due"],
      items.map((x) => [esc(x.text), esc(x.owner ?? ""), esc(fmtDate(x.due ?? null))])
    );
  })();

  const linksHtml = (() => {
    const items = doc.links?.items || [];
    if (!items.length) return `<div class="muted">No links added yet.</div>`;
    return table(
      ["Label", "URL"],
      items.map((x) => [esc(x.label), `<a class="a" href="${esc(x.url)}">${esc(x.url)}</a>`])
    );
  })();

  const signoffHtml = (() => {
    const s = doc.signoff;
    const decision =
      s.sponsor_decision === "approved"
        ? "Approved"
        : s.sponsor_decision === "conditional"
        ? "Approved with conditions"
        : s.sponsor_decision === "rejected"
        ? "Not approved"
        : "";

    return `
      <div class="grid2">
        <div class="kv"><div class="k">Sponsor name</div><div class="v">${esc(s.sponsor_name)}</div></div>
        <div class="kv"><div class="k">Sponsor date</div><div class="v">${esc(fmtDate(s.sponsor_date))}</div></div>
        <div class="kv"><div class="k">Sponsor decision</div><div class="v">${esc(decision)}</div></div>
      </div>
      <div class="sp16"></div>
      <div class="grid2">
        <div class="kv"><div class="k">PM name</div><div class="v">${esc(s.pm_name)}</div></div>
        <div class="kv"><div class="k">PM date</div><div class="v">${esc(fmtDate(s.pm_date))}</div></div>
        <div class="kv"><div class="k">PM approved</div><div class="v">${yn(!!s.pm_approved)}</div></div>
      </div>
    `;
  })();

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    /* page */
    @page { margin: 18mm 16mm; }
    html, body { height: 100%; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
      color: #111827;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }

    /* header */
    .wrap { padding: 16mm 16mm 18mm; }
    .topbar {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
      margin-bottom: 14px;
    }
    .brand { font-weight: 800; letter-spacing: .08em; font-size: 12px; color: #111827; }
    .meta { font-size: 11px; color: #6B7280; text-align: right; }
    .title { font-size: 22px; font-weight: 800; margin: 2px 0 0; }
    .subtitle { font-size: 12px; color: #6B7280; margin-top: 6px; }

    /* pills */
    .pill {
      display: inline-flex; align-items: center; gap: 8px;
      border-radius: 999px; padding: 6px 10px;
      font-size: 11px; font-weight: 800; letter-spacing: .02em;
      border: 1px solid #E5E7EB; background: #F9FAFB; color: #111827;
      white-space: nowrap;
    }
    .pill + .pill { margin-left: 8px; }

    /* layout */
    .row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
    .card {
      border: 1px solid #E5E7EB; border-radius: 14px; background: #fff;
      padding: 12px;
    }
    .card .k { font-size: 11px; color: #6B7280; font-weight: 700; margin-bottom: 4px; }
    .card .v { font-size: 13px; color: #111827; font-weight: 700; }
    .grid5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .grid2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }

    /* sections */
    .section { margin-top: 14px; border: 1px solid #E5E7EB; border-radius: 14px; overflow: hidden; }
    .section-h { background: #F9FAFB; padding: 10px 12px; font-weight: 800; font-size: 12px; }
    .section-b { padding: 12px; }
    .subh { font-size: 12px; font-weight: 800; margin: 0 0 8px; color: #111827; }
    .muted { color: #6B7280; font-size: 12px; }

    /* kpis */
    .kpi-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 10px; }
    .kpi { border: 1px solid #E5E7EB; border-radius: 14px; padding: 10px 12px; background: #fff; }
    .kpi-l { font-size: 11px; color: #6B7280; font-weight: 700; }
    .kpi-v { font-size: 14px; font-weight: 900; }

    /* tables */
    .tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
    .tbl th {
      text-align: left; font-size: 11px; color: #374151; font-weight: 800;
      padding: 8px; border-bottom: 1px solid #E5E7EB; background: #F9FAFB;
    }
    .tbl td { padding: 8px; border-bottom: 1px solid #F3F4F6; vertical-align: top; }
    .tbl tr:last-child td { border-bottom: none; }

    /* bullets */
    .bul { margin: 0; padding-left: 18px; }
    .bul li { margin: 6px 0; }
    .bul-main { font-weight: 700; }
    .bul-sub { font-size: 11px; color: #6B7280; margin-top: 2px; }

    .kv { border: 1px solid #E5E7EB; border-radius: 14px; padding: 10px 12px; background: #fff; }
    .kv .k { font-size: 11px; color: #6B7280; font-weight: 800; margin-bottom: 4px; }
    .kv .v { font-size: 12px; font-weight: 800; color: #111827; white-space: pre-wrap; }

    .sp16 { height: 16px; }
    .mt8 { margin-top: 8px; }
    a.a { color: #2563EB; text-decoration: none; }
    a.a:hover { text-decoration: underline; }

    /* small screens (still fine for PDF) */
    @media (max-width: 900px) {
      .grid5 { grid-template-columns: repeat(2, 1fr); }
      .grid3 { grid-template-columns: 1fr; }
      .grid2 { grid-template-columns: 1fr; }
      .kpi-row { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div>
        <div class="brand">${esc(brandName)} • CONFIDENTIAL</div>
        <div class="title">${esc(title)}</div>
        <div class="subtitle">Generated: ${esc(fmtDate(generatedAtIso))}</div>
      </div>
      <div class="meta">
        <div>${esc(doc.project?.client_name)}</div>
        <div>${esc(doc.project?.project_code)}</div>
        <div style="margin-top:8px;">
          <span class="pill" style="background:${ragColor.bg};color:${ragColor.fg};border-color:${ragColor.bd};">RAG: ${esc(ragLabel)}</span>
          <span class="pill" style="background:${overallMap[overall].bg};color:${overallMap[overall].fg};border-color:${overallMap[overall].bd};">Overall: ${esc(overallMap[overall].label)}</span>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="grid5">
        <div>
          <div class="k">Project</div>
          <div class="v">${esc(doc.project?.project_name)}</div>
        </div>
        <div>
          <div class="k">Project Code / ID</div>
          <div class="v">${esc(doc.project?.project_code)}</div>
        </div>
        <div>
          <div class="k">Client / Business</div>
          <div class="v">${esc(doc.project?.client_name)}</div>
        </div>
        <div>
          <div class="k">Sponsor</div>
          <div class="v">${esc(doc.project?.sponsor)}</div>
        </div>
        <div>
          <div class="k">Project Manager</div>
          <div class="v">${esc(doc.project?.pm)}</div>
        </div>
      </div>

      <div style="margin-top:10px;">
        <div class="k">Health summary</div>
        <div class="v" style="font-weight:700;color:#111827;white-space:pre-wrap;">${esc(doc.health?.summary)}</div>
      </div>
    </div>

    ${section("Key Stakeholders", stakeholdersHtml)}
    ${section("Key Achievements", achievementsHtml)}
    ${section("Success Criteria", successHtml)}
    ${section("Deliverables & Acceptance", deliverablesHtml)}
    ${section("Financial Closeout", financialHtml)}
    ${section("Lessons Learned", `
      <div class="subh">What went well</div>
      ${bullets(doc.lessons?.went_well || [])}
      <div class="sp16"></div>
      <div class="subh">What didn’t go well</div>
      ${bullets(doc.lessons?.didnt_go_well || [])}
      <div class="sp16"></div>
      <div class="subh">Surprises / Risks encountered</div>
      ${bullets(doc.lessons?.surprises_risks || [])}
    `)}
    ${section("Handover & Support", handoverHtml)}
    ${section("Recommendations & Follow-up Actions", recsHtml)}
    ${section("Useful Links & References", linksHtml)}
    ${section("Final Sign-off", signoffHtml)}
  </div>
</body>
</html>`;
}
