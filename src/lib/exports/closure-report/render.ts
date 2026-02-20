
modified_render = '''import "server-only";

import { escapeHtml } from "@/lib/exports/shared/registerPdfShell";

/* ---------------- UK formatting helpers ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeArr<T = any>(x: any): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

function ukDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeStr(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

function ukDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeStr(iso).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function formatDateUk(value: any): string {
  const s = String(value ?? "").trim();
  if (!s || s === "—") return "—";

  // Match YYYY-MM-DD
  const m1 = /^(\\d{4})-(\\d{2})-(\\d{2})$/.exec(s);
  if (m1) return `${m1[3]}/${m1[2]}/${m1[1]}`;

  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
}

function boolHuman(x: any) {
  if (x === true) return "Yes";
  if (x === false) return "No";
  const s = safeStr(x).trim();
  if (!s) return "—";
  return s;
}

function formatMoneyGBP(x: any): string {
  if (x == null || x === "" || x === "—") return "—";
  const n = typeof x === "number" ? x : Number(String(x).replace(/[^0-9.\\-]/g, ""));
  if (Number.isNaN(n)) return safeStr(x) || "—";
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `£${Math.round(n).toLocaleString("en-GB")}`;
  }
}

/* ---------------- HTML UI components ---------------- */

function bullets(items: any[], mapFn: (x: any) => string) {
  const arr = safeArr(items)
    .map(mapFn)
    .map((s) => String(s || "").trim())
    .filter(Boolean);

  if (!arr.length) return `<div class="muted">—</div>`;
  return `<ul class="bullets">${arr.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
}

function kvTable(rows: { k: string; v: string }[]) {
  const r = rows?.length ? rows : [{ k: "—", v: "—" }];
  return `
    <table class="kvTable">
      ${r
        .map(
          (x) =>
            `<tr><td class="kvK">${escapeHtml(x.k)}</td><td class="kvV">${escapeHtml((x.v || "—").trim() || "—")}</td></tr>`
        )
        .join("")}
    </table>
  `;
}

function section(title: string, note: string, bodyHtml: string) {
  return `
    <div class="section">
      <div class="sectionHead">
        <div class="t">${escapeHtml(title)}</div>
        <!-- REMOVED: count indicator <div class="n">${escapeHtml(note)}</div> -->
      </div>
      <div class="sectionBody">${bodyHtml || `<div class="muted">—</div>`}</div>
    </div>
  `;
}

function riskHumanId(r: any) {
  const v = r?.human_id ?? r?.humanId ?? r?.display_id ?? r?.displayId ?? null;
  if (v != null && String(v).trim() !== "") return String(v).trim();
  return r?.id != null ? String(r.id) : "—";
}

/**
 * Renders the narrative sections for a Project Closure Report.
 */
export function renderClosureReportSections(model: any) {
  const generatedDate = ukDate(model?.meta?.generatedIso || new Date().toISOString());
  const generatedDateTime = ukDateTime(model?.meta?.generatedIso || new Date().toISOString());

  const risksIssues = safeArr(model?.risksIssues);
  const stakeholders = safeArr(model?.stakeholders);
  const achievements = safeArr(model?.achievements);
  const criteria = safeArr(model?.criteria);
  const delivered = safeArr(model?.delivered);
  const outstanding = safeArr(model?.outstanding);
  const budgetRows = safeArr(model?.budgetRows);
  const wentWell = safeArr(model?.wentWell);
  const didntGoWell = safeArr(model?.didntGoWell);
  const surprises = safeArr(model?.surprises);
  const teamMoves = safeArr(model?.teamMoves);
  const recommendations = safeArr(model?.recommendations);

  const openRisksCount = risksIssues.filter((x: any) => String(x?.status || "").toLowerCase() !== "closed").length;

  const sectionsHtml =
    section(
      "Executive Summary",
      "High-level closeout",
      `<div>${escapeHtml(safeStr(model?.executiveSummary) || "—")}</div>`
    ) +
    // REMOVED: Health section (duplicate of header info)
    section(
      "Key Stakeholders",
      `${stakeholders.length} items`,
      bullets(stakeholders, (s) => {
        const name = safeStr(s?.name) || "—";
        const role = safeStr(s?.role);
        return role ? `${name} — ${role}` : name;
      })
    ) +
    section("Key Achievements", `${achievements.length} items`, bullets(achievements, (a) => safeStr(a?.text) || "—")) +
    section(
      "Success Criteria",
      `${criteria.length} items`,
      bullets(criteria, (c) => {
        const txt = safeStr(c?.text) || "—";
        const achieved = boolHuman(c?.achieved);
        return achieved !== "—" ? `${txt} (Achieved: ${achieved})` : txt;
      })
    ) +
    section(
      "Deliverables — Delivered",
      `${delivered.length} items`,
      bullets(delivered, (d) => {
        const deliverable = safeStr(d?.deliverable) || "—";
        const acceptedBy = safeStr(d?.accepted_by) || safeStr(d?.acceptedBy) || "—";
        const acceptedOn = formatDateUk(d?.accepted_on ?? d?.acceptedOn);
        return `${deliverable} — accepted by ${acceptedBy} (${acceptedOn})`;
      })
    ) +
    section(
      "Deliverables — Outstanding",
      `${outstanding.length} items`,
      bullets(outstanding, (o) => {
        const item = safeStr(o?.item) || safeStr(o?.deliverable) || "—";
        const owner = safeStr(o?.owner) || "—";
        const status = safeStr(o?.status) || "—";
        const target = formatDateUk(o?.target ?? o?.due_date ?? o?.dueDate);
        return `${item} — ${owner} (${status}) • Target ${target}`;
      })
    ) +
    section(
      "Handover — Open Risks & Issues",
      `${risksIssues.length} items`,
      risksIssues.length
        ? `
          <table class="dataTable" style="width:100%; border-collapse:collapse; font-size:10px; margin-top:8px;">
            <thead style="background:#f8fafc;">
              <tr>
                <th style="border:1px solid #e2e8f0; padding:6px;">ID</th>
                <th style="border:1px solid #e2e8f0; padding:6px;">Description</th>
                <th style="border:1px solid #e2e8f0; padding:6px;">Severity</th>
                <th style="border:1px solid #e2e8f0; padding:6px;">Owner</th>
                <th style="border:1px solid #e2e8f0; padding:6px;">Status</th>
                <th style="border:1px solid #e2e8f0; padding:6px;">Next Action</th>
              </tr>
            </thead>
            <tbody>
              ${risksIssues
                .map(
                  (r: any) => `
                <tr>
                  <td style="border:1px solid #e2e8f0; padding:6px;">${escapeHtml(riskHumanId(r))}</td>
                  <td style="border:1px solid #e2e8f0; padding:6px;">${escapeHtml(safeStr(r?.description) || "—")}</td>
                  <td style="border:1px solid #e2e8f0; padding:6px;">${escapeHtml(safeStr(r?.severity) || "—")}</td>
                  <td style="border:1px solid #e2e8f0; padding:6px;">${escapeHtml(safeStr(r?.owner) || "—")}</td>
                  <td style="border:1px solid #e2e8f0; padding:6px;">${escapeHtml(safeStr(r?.status) || "—")}</td>
                  <td style="border:1px solid #e2e8f0; padding:6px;">${escapeHtml(
                    safeStr(r?.next_action) || safeStr(r?.nextAction) || "—"
                  )}</td>
                </tr>
              `
                )
                .join("")}
            </tbody>
          </table>
        `
        : `<div class="muted">—</div>`
    ) +
    section(
      "Financial Closeout",
      `${budgetRows.length} budget lines`,
      kvTable([
        { k: "Budget Lines", v: String(budgetRows.length) },
        { k: "Annual Benefit", v: formatMoneyGBP(model?.roi?.annual_benefit ?? model?.roi?.annualBenefit) },
        { k: "NPV", v: formatMoneyGBP(model?.roi?.npv) },
      ])
    ) +
    section(
      "Lessons — What Went Well",
      `${wentWell.length} items`,
      bullets(wentWell, (l) => {
        const text = safeStr(l?.text) || "—";
        const action = safeStr(l?.action).trim();
        return action ? `${text} (Action: ${action})` : text;
      })
    ) +
    section(
      "Lessons — What Didn't Go Well",
      `${didntGoWell.length} items`,
      bullets(didntGoWell, (l) => {
        const text = safeStr(l?.text) || "—";
        const action = safeStr(l?.action).trim();
        return action ? `${text} (Action: ${action})` : text;
      })
    ) +
    section(
      "Lessons — Surprises & Risks",
      `${surprises.length} items`,
      bullets(surprises, (l) => {
        const text = safeStr(l?.text) || "—";
        const action = safeStr(l?.action).trim();
        return action ? `${text} (Action: ${action})` : text;
      })
    ) +
    section(
      "Handover — Team Moves",
      `${teamMoves.length} items`,
      bullets(teamMoves, (t) => {
        const person = safeStr(t?.person) || "—";
        const change = safeStr(t?.change) || "—";
        const date = formatDateUk(t?.date);
        return `${person} — ${change} (${date})`;
      })
    ) +
    section(
      "Recommendations & Follow-up",
      `${recommendations.length} items`,
      bullets(recommendations, (r) => {
        const text = safeStr(r?.text) || "—";
        const owner = safeStr(r?.owner) || "—";
        const due = formatDateUk(r?.due ?? r?.due_date ?? r?.dueDate);
        return `${text} — ${owner} (${due})`;
      })
    ) +
    section(
      "Final Sign-off",
      "Sponsor / PM",
      kvTable([
        { k: "Sponsor Name", v: safeStr(model?.signoff?.sponsor_name) || safeStr(model?.signoff?.sponsorName) || "—" },
        { k: "Sponsor Date", v: formatDateUk(model?.signoff?.sponsor_date ?? model?.signoff?.sponsorDate) },
        {
          k: "Sponsor Decision",
          v: safeStr(model?.signoff?.sponsor_decision) || safeStr(model?.signoff?.sponsorDecision) || "—",
        },
        { k: "PM Name", v: safeStr(model?.signoff?.pm_name) || safeStr(model?.signoff?.pmName) || "—" },
        { k: "PM Date", v: formatDateUk(model?.signoff?.pm_date ?? model?.signoff?.pmDate) },
        { k: "PM Approved", v: boolHuman(model?.signoff?.pm_approved ?? model?.signoff?.pmApproved) },
      ])
    );

  return {
    generatedDate,
    generatedDateTime,
    openRisksCount,
    sectionsHtml,
  };
}
'''

print(modified_render)
