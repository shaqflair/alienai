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
  // Supports multiple shapes:
  // 1) doc.sections: [{ key, ... }]
  // 2) doc[key]
  // 3) doc.content[key]
  // 4) doc.byKey[key]
  const d = doc ?? {};
  if (Array.isArray(d.sections)) {
    const hit = d.sections.find((s: any) => String(s?.key ?? s?.id ?? s?.slug ?? "").toLowerCase() === key.toLowerCase());
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
  // Common fields to look for
  const direct =
    pickField(section, ["text", "body", "value", "content", "markdown", "html"]) ||
    pickField(section, ["bullets", "items", "lines"]) ||
    "";

  // If it's an array of bullets/rows, join nicely
  if (Array.isArray(direct)) return direct.map(asText).filter(Boolean).join("\n");

  // If section has "rows" like table rows, best-effort stringify
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

  // If section has nested data, stringify
  if (typeof direct === "object") return asText(direct);

  return asText(direct);
}

function cellHeader(clsExtra = "") {
  return `px-3 py-2 text-xs font-medium border ${clsExtra}`;
}

function cell(clsExtra = "") {
  return `px-3 py-2 text-sm border align-top whitespace-pre-wrap ${clsExtra}`;
}

export default function ProjectCharterClassicView({ doc }: { doc: any }) {
  // Map canonical keys (you can rename these later if your schema uses different keys)
  const businessNeed = pickSection(doc, "business_need");
  const scope = pickSection(doc, "scope_assumptions");
  const milestones = pickSection(doc, "key_milestones");
  const financials = pickSection(doc, "financials");
  const risks = pickSection(doc, "top_risks_issues");
  const deps = pickSection(doc, "dependencies");
  const decision = pickSection(doc, "decision_ask");

  // Basic "meta" (optional)
  const meta = pickSection(doc, "meta") || doc?.meta || doc?.header || {};
  const projectTitle = pickField(meta, ["project_title", "title", "projectName", "name"]);
  const projectMgr = pickField(meta, ["project_manager", "pm", "projectManager"]);
  const sponsor = pickField(meta, ["project_sponsor", "sponsor"]);
  const startDate = pickField(meta, ["project_start_date", "start_date", "startDate"]);
  const endDate = pickField(meta, ["project_end_date", "end_date", "endDate"]);

  const approval = pickSection(doc, "approval") || doc?.approval || pickSection(doc, "approval_committee");

  return (
    <div className="border rounded-2xl bg-white p-4 overflow-auto">
      <div className="min-w-[980px]">
        <table className="w-full border-collapse">
          {/* Header */}
          <thead>
            <tr>
              <th colSpan={4} className="border bg-yellow-200 text-center py-2 text-sm font-semibold">
                PROJECT CHARTER
              </th>
            </tr>
          </thead>

          <tbody>
            {/* Top meta rows (2x2 layout) */}
            <tr>
              <td className={cellHeader("bg-green-50")}>Project Title</td>
              <td className={cell()}>{projectTitle || " "}</td>
              <td className={cellHeader("bg-green-50")}>Project Manager</td>
              <td className={cell()}>{projectMgr || " "}</td>
            </tr>
            <tr>
              <td className={cellHeader("bg-green-50")}>Project Start Date</td>
              <td className={cell()}>{startDate || " "}</td>
              <td className={cellHeader("bg-green-50")}>Project End Date</td>
              <td className={cell()}>{endDate || " "}</td>
            </tr>
            <tr>
              <td className={cellHeader("bg-green-50")}>Project Sponsor</td>
              <td className={cell()}>{sponsor || " "}</td>
              <td className={cellHeader("bg-green-50")}></td>
              <td className={cell()}></td>
            </tr>

            {/* Section: Business Need */}
            <tr>
              <td colSpan={4} className="border bg-green-200 text-center py-2 text-sm font-semibold">
                Business Need
              </td>
            </tr>
            <tr>
              <td colSpan={4} className={cell()}>
                {sectionBody(businessNeed) || " "}
              </td>
            </tr>

            {/* Section: Scope & Deliverables */}
            <tr>
              <td colSpan={4} className="border bg-green-200 text-center py-2 text-sm font-semibold">
                Project Scope
              </td>
            </tr>
            <tr>
              <td colSpan={2} className={cellHeader("bg-green-50")}>Scope</td>
              <td colSpan={2} className={cellHeader("bg-green-50")}>Deliverables</td>
            </tr>
            <tr>
              <td colSpan={2} className={cell()}>{sectionBody(scope) || " "}</td>
              <td colSpan={2} className={cell()}>{/* optional: if you store deliverables separately later */}</td>
            </tr>

            {/* Milestones */}
            <tr>
              <td colSpan={4} className="border bg-green-200 text-center py-2 text-sm font-semibold">
                Milestone Schedule
              </td>
            </tr>
            <tr>
              <td className={cellHeader("bg-green-50")}>Milestone</td>
              <td className={cellHeader("bg-green-50")}>Target Completion Date</td>
              <td className={cellHeader("bg-green-50")}>Actual Date</td>
              <td className={cellHeader("bg-green-50")}>Notes</td>
            </tr>
            {(() => {
              // best-effort milestones rendering
              const m = milestones;
              const rows =
                (Array.isArray(m?.rows) && m.rows) ||
                (Array.isArray(m?.items) && m.items) ||
                (Array.isArray(m?.milestones) && m.milestones) ||
                null;

              if (!rows || rows.length === 0) {
                return (
                  <tr>
                    <td className={cell()}></td>
                    <td className={cell()}></td>
                    <td className={cell()}></td>
                    <td className={cell()}></td>
                  </tr>
                );
              }

              return rows.slice(0, 10).map((r: any, idx: number) => {
                // support object or array rows
                const milestone = Array.isArray(r) ? r[0] : pickField(r, ["milestone", "name", "title"]);
                const target = Array.isArray(r) ? r[1] : pickField(r, ["target", "target_date", "targetDate"]);
                const actual = Array.isArray(r) ? r[2] : pickField(r, ["actual", "actual_date", "actualDate"]);
                const notes = Array.isArray(r) ? r[3] : pickField(r, ["notes", "comment", "remarks"]);
                return (
                  <tr key={idx}>
                    <td className={cell()}>{asText(milestone) || " "}</td>
                    <td className={cell()}>{asText(target) || " "}</td>
                    <td className={cell()}>{asText(actual) || " "}</td>
                    <td className={cell()}>{asText(notes) || " "}</td>
                  </tr>
                );
              });
            })()}

            {/* Financials */}
            <tr>
              <td colSpan={4} className="border bg-green-200 text-center py-2 text-sm font-semibold">
                Financials
              </td>
            </tr>
            <tr>
              <td colSpan={4} className={cell()}>{sectionBody(financials) || " "}</td>
            </tr>

            {/* Risks */}
            <tr>
              <td colSpan={4} className="border bg-green-200 text-center py-2 text-sm font-semibold">
                Top Risks & Issues
              </td>
            </tr>
            <tr>
              <td colSpan={4} className={cell()}>{sectionBody(risks) || " "}</td>
            </tr>

            {/* Dependencies */}
            <tr>
              <td colSpan={4} className="border bg-green-200 text-center py-2 text-sm font-semibold">
                Dependencies
              </td>
            </tr>
            <tr>
              <td colSpan={4} className={cell()}>{sectionBody(deps) || " "}</td>
            </tr>

            {/* Decision / Ask */}
            <tr>
              <td colSpan={4} className="border bg-green-200 text-center py-2 text-sm font-semibold">
                Decision / Ask
              </td>
            </tr>
            <tr>
              <td colSpan={4} className={cell()}>{sectionBody(decision) || " "}</td>
            </tr>

            {/* Approval */}
            <tr>
              <td colSpan={4} className="border bg-green-200 text-center py-2 text-sm font-semibold">
                Approval / Review Committee
              </td>
            </tr>
            <tr>
              <td className={cellHeader("bg-green-50")}>Role</td>
              <td className={cellHeader("bg-green-50")}>Name</td>
              <td className={cellHeader("bg-green-50")}></td>
              <td className={cellHeader("bg-green-50")}></td>
            </tr>
            {(() => {
              const a = approval;
              const rows =
                (Array.isArray(a?.rows) && a.rows) ||
                (Array.isArray(a?.items) && a.items) ||
                (Array.isArray(a?.approvers) && a.approvers) ||
                null;

              if (!rows || rows.length === 0) {
                return (
                  <>
                    <tr>
                      <td className={cell()}>Project Manager</td>
                      <td className={cell()}></td>
                      <td className={cell()}></td>
                      <td className={cell()}></td>
                    </tr>
                    <tr>
                      <td className={cell()}>Sponsor</td>
                      <td className={cell()}></td>
                      <td className={cell()}></td>
                      <td className={cell()}></td>
                    </tr>
                  </>
                );
              }

              return rows.slice(0, 10).map((r: any, idx: number) => {
                const role = Array.isArray(r) ? r[0] : pickField(r, ["role", "title"]);
                const name = Array.isArray(r) ? r[1] : pickField(r, ["name", "full_name", "email"]);
                return (
                  <tr key={idx}>
                    <td className={cell()}>{asText(role) || " "}</td>
                    <td className={cell()}>{asText(name) || " "}</td>
                    <td className={cell()}></td>
                    <td className={cell()}></td>
                  </tr>
                );
              });
            })()}
          </tbody>
        </table>

        <div className="mt-3 text-xs text-gray-500">
          Classic view is a stakeholder-friendly preview. Edit content in <span className="font-medium">Section view</span>.
        </div>
      </div>
    </div>
  );
}
