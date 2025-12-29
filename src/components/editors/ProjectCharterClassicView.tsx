// src/components/editors/ProjectCharterClassicView.tsx
"use client";

import React from "react";

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

function isV2(doc: any) {
  return !!doc && typeof doc === "object" && Array.isArray(doc.sections);
}

function pad(arr: string[], n: number) {
  const out = [...arr.map((x) => String(x ?? ""))];
  while (out.length < n) out.push("");
  return out.slice(0, n);
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
  return table.rows.map((row, idx) => (
    <tr key={idx} className={row.type === "header" ? "bg-gray-100 font-medium" : ""}>
      {pad(row.cells, table.columns).map((cell, cIdx) => (
        <td key={cIdx} className="border px-3 py-2 text-sm align-top whitespace-pre-wrap">
          {cell || " "}
        </td>
      ))}
    </tr>
  ));
}

/* -----------------------------
   Classic styling helpers
------------------------------ */

function cellHeader(clsExtra = "") {
  return `px-3 py-2 text-xs font-medium border ${clsExtra}`;
}

function cell(clsExtra = "") {
  return `px-3 py-2 text-sm border align-top whitespace-pre-wrap ${clsExtra}`;
}

const TITLE_BAR = "bg-gray-200";
const META_HDR = "bg-gray-50";

/* -----------------------------
   Project title placeholder logic
------------------------------ */

function isPlaceholderProjectTitle(x: any) {
  const s = String(x ?? "").trim().toLowerCase();
  return !s || s === "(from project)" || s === "from project" || s === "from_project";
}

/* -----------------------------
   Component
------------------------------ */

export default function ProjectCharterClassicView({
  doc,
  projectTitleFromProject,
}: {
  doc: any;
  projectTitleFromProject?: string;
}) {
  const v2 = isV2(doc);

  const meta = (doc?.meta && typeof doc.meta === "object" ? doc.meta : {}) || {};
  const projectTitleMeta = pickField(meta, ["project_title", "title", "projectName", "name"]);
  const projectMgr = pickField(meta, ["project_manager", "pm", "projectManager"]);
  const sponsor = pickField(meta, ["project_sponsor", "sponsor"]);
  const startDate = pickField(meta, ["project_start_date", "start_date", "startDate"]);
  const endDate = pickField(meta, ["project_end_date", "end_date", "endDate"]);
  const customer = pickField(meta, ["customer_account", "customer", "account", "client"]);

  const displayProjectTitle = isPlaceholderProjectTitle(projectTitleMeta)
    ? String(projectTitleFromProject ?? "").trim()
    : String(projectTitleMeta ?? "").trim();

  // v2 sections by key
  const businessCase = pickSection(doc, "business_case") || pickSection(doc, "business_need");
  const objectives = pickSection(doc, "objectives");
  const scope = pickSection(doc, "scope");
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
  const approval = pickSection(doc, "approval") || pickSection(doc, "approval_committee");

  function sectionTitleRow(title: string) {
    return (
      <tr>
        <td colSpan={4} className="border bg-gray-100 text-center py-2 text-sm font-semibold">
          {title}
        </td>
      </tr>
    );
  }

  return (
    <div className="border rounded-2xl bg-white p-4 overflow-auto">
      <div className="min-w-[980px]">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th colSpan={4} className={`border ${TITLE_BAR} text-center py-2 text-sm font-semibold`}>
                PROJECT CHARTER
              </th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td className={cellHeader(META_HDR)}>Project Title</td>
              <td className={cell("text-neutral-700")}>{displayProjectTitle || "—"}</td>
              <td className={cellHeader(META_HDR)}>Project Manager</td>
              <td className={cell()}>{projectMgr || " "}</td>
            </tr>

            <tr>
              <td className={cellHeader(META_HDR)}>Project Start Date</td>
              <td className={cell()}>{startDate || " "}</td>
              <td className={cellHeader(META_HDR)}>Project End Date</td>
              <td className={cell()}>{endDate || " "}</td>
            </tr>

            <tr>
              <td className={cellHeader(META_HDR)}>Project Sponsor</td>
              <td className={cell()}>{sponsor || " "}</td>
              <td className={cellHeader(META_HDR)}>Customer / Account</td>
              <td className={cell()}>{customer || " "}</td>
            </tr>

            {sectionTitleRow("1. Business Case")}
            {(() => {
              const t = normalizeV2Table(businessCase);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className={cell()}>
                    {sectionBody(businessCase) || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("2. Objectives")}
            {(() => {
              const t = normalizeV2Table(objectives);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className={cell()}>
                    {sectionBody(objectives) || " "}
                  </td>
                </tr>
              );
            })()}

            {sectionTitleRow("3. Scope")}
            <tr>
              <td colSpan={2} className={cellHeader(META_HDR)}>
                In Scope
              </td>
              <td colSpan={2} className={cellHeader(META_HDR)}>
                Out of Scope
              </td>
            </tr>
            <tr>
              <td colSpan={2} className={cell()}>
                {sectionBody(inScope || scope) || " "}
              </td>
              <td colSpan={2} className={cell()}>
                {sectionBody(outScope) || " "}
              </td>
            </tr>

            {sectionTitleRow("4. Key Deliverables")}
            {(() => {
              const t = normalizeV2Table(deliverables);
              if (t) return renderV2TableRows(t);
              return (
                <tr>
                  <td colSpan={4} className={cell()}>
                    {sectionBody(deliverables) || " "}
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
                    <td className={cellHeader(META_HDR)}>Milestone</td>
                    <td className={cellHeader(META_HDR)}>Target Completion Date</td>
                    <td className={cellHeader(META_HDR)}>Actual Date</td>
                    <td className={cellHeader(META_HDR)}>Notes</td>
                  </tr>
                  <tr>
                    <td className={cell()}></td>
                    <td className={cell()}></td>
                    <td className={cell()}></td>
                    <td className={cell()}></td>
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
                  <td colSpan={4} className={cell()}>
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
                  <td colSpan={4} className={cell()}>
                    {sectionBody(risks) || " "}
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
                  <td colSpan={4} className={cell()}>
                    {sectionBody(issues) || " "}
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
                  <td colSpan={4} className={cell()}>
                    {sectionBody(assumptions) || " "}
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
                  <td colSpan={4} className={cell()}>
                    {sectionBody(dependencies) || " "}
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
                  <td colSpan={4} className={cell()}>
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
                  <td colSpan={4} className={cell()}>
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
                  <td colSpan={4} className={cell()}>
                    {sectionBody(approval) || " "}
                  </td>
                </tr>
              );
            })()}
          </tbody>
        </table>

        <div className="mt-3 text-xs text-gray-500">
          Classic view is a stakeholder-friendly preview. Edit content in{" "}
          <span className="font-medium">Section view</span>.
        </div>
      </div>
    </div>
  );
}
