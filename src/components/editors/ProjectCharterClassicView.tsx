// src/components/editors/ProjectCharterClassicView.tsx
"use client";

import React, { useMemo } from "react";

function asText(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function pickSection(doc: any, key: string) {
  const d = doc ?? {};
  if (Array.isArray(d.sections)) {
    const hit = d.sections.find(
      (s: any) => String(s?.key ?? s?.id ?? s?.slug ?? "").toLowerCase() === key.toLowerCase()
    );
    if (hit) return hit;
  }
  if (d[key] != null) return d[key];
  if (d?.content?.[key] != null) return d.content[key];
  if (d?.byKey?.[key] != null) return d.byKey[key];
  return null;
}

function pickField(obj: any, candidates: string[]) {
  for (const k of candidates) {
    if (obj && obj[k] != null && String(obj[k]).trim() !== "") return obj[k];
  }
  return "";
}

function sectionBody(section: any) {
  if (!section) return "";
  const direct =
    pickField(section, ["text", "body", "value", "content", "markdown", "html"]) ||
    pickField(section, ["bullets", "items", "lines"]) ||
    "";

  if (Array.isArray(direct)) return direct.map(asText).filter(Boolean).join("\n");

  if (Array.isArray(section?.rows)) {
    return section.rows
      .map((r: any) => {
        if (Array.isArray(r)) return r.map(asText).join(" | ");
        if (typeof r === "object") return Object.values(r).map(asText).join(" | ");
        return asText(r);
      })
      .filter(Boolean)
      .join("\n");
  }

  if (typeof direct === "object") return asText(direct);
  return asText(direct);
}

/* -----------------------------
   v2 helpers (tables + meta)
------------------------------ */

type V2RowObj = { type: "header" | "data"; cells: string[] };

function pad(arr: string[], n: number) {
  const out = [...arr.map((x) => String(x ?? ""))];
  while (out.length < n) out.push("");
  return out.slice(0, n);
}

/** UK date display for classic view */
function formatUkDateMaybe(value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  // YYYY-MM-DD -> DD/MM/YYYY
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;

  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/** Canonical bullet normaliser */
function stripLeadingBullets(line: string) {
  return String(line || "").replace(/^(\s*([•‣▪◦\-*]+)\s*)+/g, "").trim();
}

function normalizeBulletsForDisplay(text: any) {
  const lines = String(text ?? "")
    .split("\n")
    .map((l) => l.replace(/\r/g, ""));
  const out: string[] = [];
  for (const line of lines) {
    const t = stripLeadingBullets(line);
    if (!t) continue;
    out.push(`• ${t}`);
  }
  return out.join("\n");
}

/** Money formatting */
function isMoneyHeader(header: string) {
  const h = String(header || "").toLowerCase();
  return h.includes("amount") || h.includes("budget") || h.includes("cost") || h.includes("value") || h.includes("price");
}

function formatUkMoneyMaybe(value: any) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^[£$€]\s?[\d,.]+/.test(raw)) return raw;

  const num = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(num)) return raw;

  return `£${num.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function normalizeV2Table(section: any): { columns: number; rows: V2RowObj[] } | null {
  if (section?.table?.rows?.length) {
    const cols = Math.max(1, Number(section.table.columns || section.table.rows[0]?.cells?.length || 4));
    return {
      columns: cols,
      rows: section.table.rows.map((r: any) => ({
        type: r?.type === "header" ? "header" : "data",
        cells: Array.isArray(r?.cells) ? r.cells.map((x: any) => String(x ?? "")) : [],
      })),
    };
  }

  if (Array.isArray(section?.columns) || Array.isArray(section?.rows)) {
    const colsArr = Array.isArray(section.columns) ? section.columns.map((x: any) => String(x ?? "")) : [];
    const rowsArr = Array.isArray(section.rows) ? section.rows : [];
    const colCount = Math.max(1, colsArr.length || rowsArr[0]?.length || 4);

    const out: V2RowObj[] = [];
    if (colsArr.length) out.push({ type: "header", cells: pad(colsArr, colCount) });
    for (const r of rowsArr) {
      out.push({
        type: "data",
        cells: pad(Array.isArray(r) ? r.map((x: any) => String(x ?? "")) : [], colCount),
      });
    }

    if (out.length === 0) {
      out.push({ type: "header", cells: pad(["", "", "", ""], colCount) });
      out.push({ type: "data", cells: pad(["", "", "", ""], colCount) });
    }

    return { columns: colCount, rows: out };
  }

  return null;
}

function renderV2TableRows(table: { columns: number; rows: V2RowObj[] }) {
  const headerRow = table.rows.find((r) => r.type === "header");
  const headers = pad(headerRow?.cells ?? [], table.columns).map((x) => String(x ?? ""));

  const isDateCol = (idx: number) => headers[idx].toLowerCase().includes("date");
  const isMoneyCol = (idx: number) => isMoneyHeader(headers[idx]);

  return table.rows.map((row, idx) => (
    <tr key={idx} className={row.type === "header" ? "bg-slate-100" : "hover:bg-slate-50/50"}>
      {pad(row.cells, table.columns).map((cell, cIdx) => {
        const val = String(cell ?? "");
        const display =
          row.type === "header"
            ? val
            : isDateCol(cIdx)
            ? formatUkDateMaybe(val)
            : isMoneyCol(cIdx)
            ? formatUkMoneyMaybe(val)
            : val;

        return (
          <td
            key={cIdx}
            className={`border border-slate-200 px-4 py-3 text-sm align-top whitespace-pre-wrap ${
              row.type === "header" ? "font-semibold text-slate-700 bg-slate-50" : "text-slate-600"
            }`}
          >
            {display || " "}
          </td>
        );
      })}
    </tr>
  ));
}

/* -----------------------------
   Special section rules
------------------------------ */

function isFreeTextSectionKey(k: string) {
  const key = String(k ?? "").toLowerCase();
  return key === "business_case" || key === "objectives";
}

/* -----------------------------
   Styling helpers
------------------------------ */

function sectionTitleRow(title: string) {
  return (
    <tr>
      <td
        colSpan={4}
        className="border border-slate-300 bg-slate-800 text-white text-center py-3 text-sm font-semibold tracking-wide uppercase"
      >
        {title}
      </td>
    </tr>
  );
}

function metaCellHeader(text: string) {
  return (
    <td className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider w-1/6">
      {text}
    </td>
  );
}

function metaCell(value: string, className = "") {
  return <td className={`border border-slate-200 px-4 py-3 text-sm text-slate-700 ${className}`}>{value || " "}</td>;
}

/* -----------------------------
   Component
------------------------------ */

export default function ProjectCharterClassicView({
  doc,
  // ✅ align with current callers (ProjectCharterEditorFormLazy passes projectId/artifactId)
  projectId,
  artifactId,
  // ✅ new preferred prop
  projectTitle,
  // ✅ keep backward compat
  projectTitleFromProject,
}: {
  doc: any;
  projectId?: string;
  artifactId?: string;
  projectTitle?: string;
  projectTitleFromProject?: string;
}) {
  void projectId;
  void artifactId;

  const meta = (doc?.meta && typeof doc.meta === "object" ? doc.meta : {}) || {};
  const projectTitleMeta = pickField(meta, ["project_title", "title", "projectName", "name"]);
  const projectMgr = pickField(meta, ["project_manager", "pm", "projectManager"]);
  const sponsor = pickField(meta, ["project_sponsor", "sponsor"]);
  const startDate = pickField(meta, ["project_start_date", "start_date", "startDate"]);
  const endDate = pickField(meta, ["project_end_date", "end_date", "endDate"]);
  const customer = pickField(meta, ["customer_account", "customer", "account", "client"]);

  const displayProjectTitle = (() => {
    const s = String(projectTitleMeta ?? "").trim().toLowerCase();
    if (!s || s === "(from project)" || s === "from project" || s === "from_project") {
      const fromProps = String(projectTitle ?? projectTitleFromProject ?? "").trim();
      return fromProps;
    }
    return String(projectTitleMeta ?? "").trim();
  })();

  // Sections
  const businessCase = pickSection(doc, "business_case") || pickSection(doc, "business_need");
  const objectives = pickSection(doc, "objectives");
  const scopeInOut = pickSection(doc, "scope_in_out") || pickSection(doc, "scope");
  const inScope = pickSection(doc, "in_scope");
  const outScope = pickSection(doc, "out_of_scope");
  const deliverables = pickSection(doc, "key_deliverables") || pickSection(doc, "deliverables");
  const milestones = pickSection(doc, "milestones_timeline") || pickSection(doc, "key_milestones");
  const financials = pickSection(doc, "financials");
  const risks = pickSection(doc, "risks");
  const issues = pickSection(doc, "issues");
  const assumptions = pickSection(doc, "assumptions");
  const dependencies = pickSection(doc, "dependencies");
  const projectTeam = pickSection(doc, "project_team");
  const stakeholders = pickSection(doc, "stakeholders");
  const approval = pickSection(doc, "approval_committee") || pickSection(doc, "approval");

  // ✅ Business Case + Objectives are FREE TEXT in v2 (render as prose, not forced bullets)
  const businessCaseText = useMemo(() => String(sectionBody(businessCase) ?? "").trim(), [businessCase]);
  const objectivesText = useMemo(() => String(sectionBody(objectives) ?? "").trim(), [objectives]);

  const deliverablesText = useMemo(() => normalizeBulletsForDisplay(sectionBody(deliverables)), [deliverables]);
  const risksText = useMemo(() => normalizeBulletsForDisplay(sectionBody(risks)), [risks]);
  const issuesText = useMemo(() => normalizeBulletsForDisplay(sectionBody(issues)), [issues]);
  const assumptionsText = useMemo(() => normalizeBulletsForDisplay(sectionBody(assumptions)), [assumptions]);
  const dependenciesText = useMemo(() => normalizeBulletsForDisplay(sectionBody(dependencies)), [dependencies]);

  function proseCell(text: string) {
    return (
      <tr>
        <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
          {text || " "}
        </td>
      </tr>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-lg border border-slate-200 overflow-hidden">
      <div className="p-6 md:p-8 overflow-x-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight uppercase mb-2">Project Charter</h1>
          <div className="w-24 h-1 bg-indigo-500 mx-auto rounded-full" />
        </div>

        <table className="w-full border-collapse shadow-sm rounded-lg overflow-hidden min-w-[900px]">
          <tbody>
            {/* Meta rows */}
            <tr>
              {metaCellHeader("Project Title")}
              {metaCell(displayProjectTitle || "—", "font-semibold text-slate-900")}
              {metaCellHeader("Project Manager")}
              {metaCell(projectMgr)}
            </tr>

            <tr>
              {metaCellHeader("Start Date")}
              {metaCell(formatUkDateMaybe(startDate))}
              {metaCellHeader("End Date")}
              {metaCell(formatUkDateMaybe(endDate))}
            </tr>

            <tr>
              {metaCellHeader("Project Sponsor")}
              {metaCell(sponsor)}
              {metaCellHeader("Customer / Account")}
              {metaCell(customer)}
            </tr>

            {/* Sections */}
            {sectionTitleRow("1. Business Case")}
            {(() => {
              const t = normalizeV2Table(businessCase);
              if (t) return renderV2TableRows(t);
              // ✅ prose (no forced bullets)
              return proseCell(businessCaseText);
            })()}

            {sectionTitleRow("2. Objectives")}
            {(() => {
              const t = normalizeV2Table(objectives);
              if (t) return renderV2TableRows(t);
              // ✅ prose (no forced bullets)
              return proseCell(objectivesText);
            })()}

            {sectionTitleRow("3. Scope")}
            {(() => {
              const t = normalizeV2Table(scopeInOut);
              if (t && t.columns >= 2) {
                const header = t.rows.find((r) => r.type === "header")?.cells ?? ["In Scope", "Out of Scope"];
                const dataRows = t.rows.filter((r) => r.type === "data");

                return (
                  <>
                    <tr>
                      <td
                        colSpan={2}
                        className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider"
                      >
                        {String(header[0] || "In Scope")}
                      </td>
                      <td
                        colSpan={2}
                        className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider"
                      >
                        {String(header[1] || "Out of Scope")}
                      </td>
                    </tr>

                    {dataRows.length ? (
                      dataRows.map((r, idx) => (
                        <tr key={idx}>
                          <td colSpan={2} className="border border-slate-200 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
                            {normalizeBulletsForDisplay(String((r.cells ?? [])[0] ?? "")) || " "}
                          </td>
                          <td colSpan={2} className="border border-slate-200 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
                            {normalizeBulletsForDisplay(String((r.cells ?? [])[1] ?? "")) || " "}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={2} className="border border-slate-200 px-4 py-3 text-sm text-slate-700">
                          {" "}
                        </td>
                        <td colSpan={2} className="border border-slate-200 px-4 py-3 text-sm text-slate-700">
                          {" "}
                        </td>
                      </tr>
                    )}
                  </>
                );
              }

              return (
                <>
                  <tr>
                    <td
                      colSpan={2}
                      className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider"
                    >
                      In Scope
                    </td>
                    <td
                      colSpan={2}
                      className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider"
                    >
                      Out of Scope
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={2} className="border border-slate-200 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
                      {normalizeBulletsForDisplay(sectionBody(inScope || scopeInOut)) || " "}
                    </td>
                    <td colSpan={2} className="border border-slate-200 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">
                      {normalizeBulletsForDisplay(sectionBody(outScope)) || " "}
                    </td>
                  </tr>
                </>
              );
            })()}

            {sectionTitleRow("4. Key Deliverables")}
            {(() => {
              const t = normalizeV2Table(deliverables);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {deliverablesText || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("5. Milestones & Timeline")}
            {(() => {
              const t = normalizeV2Table(milestones);
              if (t) return renderV2TableRows(t);
              return (
                <>
                  <tr>
                    <td className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Milestone
                    </td>
                    <td className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Target Date
                    </td>
                    <td className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Actual Date
                    </td>
                    <td className="border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600 uppercase tracking-wider">
                      Notes
                    </td>
                  </tr>
                  <tr>
                    <td className="border border-slate-200 px-4 py-3 text-sm text-slate-700"> </td>
                    <td className="border border-slate-200 px-4 py-3 text-sm text-slate-700"> </td>
                    <td className="border border-slate-200 px-4 py-3 text-sm text-slate-700"> </td>
                    <td className="border border-slate-200 px-4 py-3 text-sm text-slate-700"> </td>
                  </tr>
                </>
              );
            })()}

            {sectionTitleRow("6. Financials")}
            {(() => {
              const t = normalizeV2Table(financials);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap">
                    {sectionBody(financials) || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("7. Risks")}
            {(() => {
              const t = normalizeV2Table(risks);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {risksText || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("8. Issues")}
            {(() => {
              const t = normalizeV2Table(issues);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {issuesText || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("9. Assumptions")}
            {(() => {
              const t = normalizeV2Table(assumptions);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {assumptionsText || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("10. Dependencies")}
            {(() => {
              const t = normalizeV2Table(dependencies);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
                    {dependenciesText || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("11. Project Team")}
            {(() => {
              const t = normalizeV2Table(projectTeam);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap">
                    {sectionBody(projectTeam) || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("12. Stakeholders")}
            {(() => {
              const t = normalizeV2Table(stakeholders);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap">
                    {sectionBody(stakeholders) || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("13. Approval / Review Committee")}
            {(() => {
              const t = normalizeV2Table(approval);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-4 py-4 text-sm text-slate-700 whitespace-pre-wrap">
                    {sectionBody(approval) || " "}
                  </td>
                </tr>
              );
            })()}
          </tbody>
        </table>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-slate-200 text-center">
          <p className="text-xs text-slate-400 uppercase tracking-widest font-medium">End of Project Charter</p>
        </div>
      </div>
    </div>
  );
}