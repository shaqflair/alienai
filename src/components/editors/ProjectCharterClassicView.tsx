// src/components/editors/ProjectCharterClassicView.tsx
"use client";

import React, { useMemo } from "react";

/* =====================================================================
   DATA HELPERS — unchanged logic, all functions preserved
   ===================================================================== */

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

/* =====================================================================
   REDESIGNED RENDER HELPERS — world-class editorial aesthetic
   ===================================================================== */

function renderV2TableRows(table: { columns: number; rows: V2RowObj[] }) {
  const headerRow = table.rows.find((r) => r.type === "header");
  const headers = pad(headerRow?.cells ?? [], table.columns).map((x) => String(x ?? ""));

  const isDateCol = (idx: number) => headers[idx].toLowerCase().includes("date");
  const isMoneyCol = (idx: number) => isMoneyHeader(headers[idx]);

  return table.rows.map((row, idx) => (
    <tr
      key={idx}
      className={
        row.type === "header"
          ? ""
          : "transition-colors duration-200 hover:bg-[#f8f6f1]"
      }
    >
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

        return row.type === "header" ? (
          <th
            key={cIdx}
            className="border-b-2 border-[#c9b99a] bg-[#faf8f4] px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b5c3e]"
          >
            {display || "\u00A0"}
          </th>
        ) : (
          <td
            key={cIdx}
            className="border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] leading-relaxed text-[#3d3529] align-top whitespace-pre-wrap"
          >
            {display || "\u00A0"}
          </td>
        );
      })}
    </tr>
  ));
}

/* Special section rules — preserved */
function isFreeTextSectionKey(k: string) {
  const key = String(k ?? "").toLowerCase();
  return key === "business_case" || key === "objectives";
}

/* =====================================================================
   STYLING HELPERS — refined editorial look
   ===================================================================== */

function SectionTitle({ number, title }: { number: string; title: string }) {
  return (
    <tr>
      <td colSpan={4} className="pt-8 pb-0 bg-transparent border-0">
        <div className="flex items-center gap-4 pb-3 border-b-2 border-[#1a1a1a]">
          <span
            className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[12px] font-bold tracking-wide text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg, #2c2418 0%, #5a4a32 100%)" }}
          >
            {number}
          </span>
          <span className="text-[14px] font-bold uppercase tracking-[0.15em] text-[#1a1a1a]">
            {title}
          </span>
        </div>
      </td>
    </tr>
  );
}

function MetaLabel({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-[#e8e2d6] bg-[#faf8f4] px-5 py-3.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#8a7d68] w-[15%] align-middle">
      {children}
    </td>
  );
}

function MetaValue({ children, highlight }: { children: React.ReactNode; highlight?: boolean }) {
  return (
    <td
      className={`border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] align-middle ${
        highlight ? "font-semibold text-[#1a1a1a]" : "text-[#3d3529]"
      }`}
    >
      {children || "\u00A0"}
    </td>
  );
}

function ProseRow({ text }: { text: string }) {
  return (
    <tr>
      <td
        colSpan={4}
        className="px-5 py-5 text-[13.5px] text-[#3d3529] whitespace-pre-wrap leading-[1.75] border-b border-[#e8e2d6]"
      >
        {text || "\u00A0"}
      </td>
    </tr>
  );
}

function ScopeHeader({ left, right }: { left: string; right: string }) {
  return (
    <tr>
      <td
        colSpan={2}
        className="border-b-2 border-[#c9b99a] bg-[#faf8f4] px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b5c3e]"
      >
        {left}
      </td>
      <td
        colSpan={2}
        className="border-b-2 border-[#c9b99a] bg-[#faf8f4] px-5 py-3.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b5c3e]"
      >
        {right}
      </td>
    </tr>
  );
}

/* =====================================================================
   COMPONENT — redesigned with all original props & logic preserved
   ===================================================================== */

export default function ProjectCharterClassicView({
  doc,
  projectId,
  artifactId,
  projectTitle,
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

  // ✅ Business Case + Objectives are FREE TEXT in v2
  const businessCaseText = useMemo(() => String(sectionBody(businessCase) ?? "").trim(), [businessCase]);
  const objectivesText = useMemo(() => String(sectionBody(objectives) ?? "").trim(), [objectives]);

  const deliverablesText = useMemo(() => normalizeBulletsForDisplay(sectionBody(deliverables)), [deliverables]);
  const risksText = useMemo(() => normalizeBulletsForDisplay(sectionBody(risks)), [risks]);
  const issuesText = useMemo(() => normalizeBulletsForDisplay(sectionBody(issues)), [issues]);
  const assumptionsText = useMemo(() => normalizeBulletsForDisplay(sectionBody(assumptions)), [assumptions]);
  const dependenciesText = useMemo(() => normalizeBulletsForDisplay(sectionBody(dependencies)), [dependencies]);

  return (
    <div
      className="relative overflow-hidden rounded-xl shadow-2xl"
      style={{
        background: "linear-gradient(180deg, #fffcf7 0%, #f5f0e8 100%)",
        fontFamily: "'Georgia', 'Times New Roman', serif",
      }}
    >
      {/* Decorative top edge */}
      <div
        className="h-1.5 w-full"
        style={{ background: "linear-gradient(90deg, #b8975a 0%, #d4b97a 30%, #8c6d3a 60%, #c4a55e 100%)" }}
      />

      <div className="p-8 md:p-12 lg:p-14">
        {/* ── HEADER ────────────────────────────────────────── */}
        <header className="mb-10 text-center">
          <div className="flex items-center justify-center gap-4 mb-4">
            <div className="h-px flex-1 max-w-[80px]" style={{ background: "linear-gradient(90deg, transparent, #c9b99a)" }} />
            <span
              className="text-[10px] font-bold uppercase tracking-[0.3em]"
              style={{ color: "#a08e6c", fontFamily: "'Georgia', serif" }}
            >
              Official Document
            </span>
            <div className="h-px flex-1 max-w-[80px]" style={{ background: "linear-gradient(270deg, transparent, #c9b99a)" }} />
          </div>

          <h1
            className="text-[28px] md:text-[34px] font-bold tracking-[0.06em] uppercase mb-3"
            style={{
              color: "#1a1a1a",
              fontFamily: "'Georgia', 'Palatino Linotype', 'Book Antiqua', serif",
            }}
          >
            Project Charter
          </h1>

          <div className="flex items-center justify-center gap-2">
            <div className="w-3 h-3 rotate-45 border border-[#c9b99a]" />
            <div className="w-16 h-[2px] bg-[#c9b99a]" />
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: "linear-gradient(135deg, #b8975a, #d4b97a)" }}
            />
            <div className="w-16 h-[2px] bg-[#c9b99a]" />
            <div className="w-3 h-3 rotate-45 border border-[#c9b99a]" />
          </div>
        </header>

        {/* ── TABLE ─────────────────────────────────────────── */}
        <div className="overflow-x-auto">
          <table
            className="w-full border-collapse min-w-[860px]"
            style={{ fontFamily: "'Segoe UI', 'Helvetica Neue', sans-serif" }}
          >
            <tbody>
              {/* ── META ROWS ─────────────────────────────────── */}
              <tr>
                <MetaLabel>Project Title</MetaLabel>
                <MetaValue highlight>{displayProjectTitle || "—"}</MetaValue>
                <MetaLabel>Project Manager</MetaLabel>
                <MetaValue>{projectMgr}</MetaValue>
              </tr>
              <tr>
                <MetaLabel>Start Date</MetaLabel>
                <MetaValue>{formatUkDateMaybe(startDate)}</MetaValue>
                <MetaLabel>End Date</MetaLabel>
                <MetaValue>{formatUkDateMaybe(endDate)}</MetaValue>
              </tr>
              <tr>
                <MetaLabel>Project Sponsor</MetaLabel>
                <MetaValue>{sponsor}</MetaValue>
                <MetaLabel>Customer / Account</MetaLabel>
                <MetaValue>{customer}</MetaValue>
              </tr>

              {/* ── 1. BUSINESS CASE ──────────────────────────── */}
              <SectionTitle number="1" title="Business Case" />
              {(() => {
                const t = normalizeV2Table(businessCase);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={businessCaseText} />;
              })()}

              {/* ── 2. OBJECTIVES ─────────────────────────────── */}
              <SectionTitle number="2" title="Objectives" />
              {(() => {
                const t = normalizeV2Table(objectives);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={objectivesText} />;
              })()}

              {/* ── 3. SCOPE ─────────────────────────────────── */}
              <SectionTitle number="3" title="Scope" />
              {(() => {
                const t = normalizeV2Table(scopeInOut);
                if (t && t.columns >= 2) {
                  const header = t.rows.find((r) => r.type === "header")?.cells ?? ["In Scope", "Out of Scope"];
                  const dataRows = t.rows.filter((r) => r.type === "data");

                  return (
                    <>
                      <ScopeHeader
                        left={String(header[0] || "In Scope")}
                        right={String(header[1] || "Out of Scope")}
                      />
                      {dataRows.length ? (
                        dataRows.map((r, idx) => (
                          <tr key={idx} className="hover:bg-[#f8f6f1] transition-colors duration-200">
                            <td colSpan={2} className="border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] text-[#3d3529] whitespace-pre-wrap">
                              {normalizeBulletsForDisplay(String((r.cells ?? [])[0] ?? "")) || "\u00A0"}
                            </td>
                            <td colSpan={2} className="border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] text-[#3d3529] whitespace-pre-wrap">
                              {normalizeBulletsForDisplay(String((r.cells ?? [])[1] ?? "")) || "\u00A0"}
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={2} className="border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] text-[#3d3529]">{"\u00A0"}</td>
                          <td colSpan={2} className="border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] text-[#3d3529]">{"\u00A0"}</td>
                        </tr>
                      )}
                    </>
                  );
                }

                return (
                  <>
                    <ScopeHeader left="In Scope" right="Out of Scope" />
                    <tr>
                      <td colSpan={2} className="border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] text-[#3d3529] whitespace-pre-wrap">
                        {normalizeBulletsForDisplay(sectionBody(inScope || scopeInOut)) || "\u00A0"}
                      </td>
                      <td colSpan={2} className="border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] text-[#3d3529] whitespace-pre-wrap">
                        {normalizeBulletsForDisplay(sectionBody(outScope)) || "\u00A0"}
                      </td>
                    </tr>
                  </>
                );
              })()}

              {/* ── 4. KEY DELIVERABLES ───────────────────────── */}
              <SectionTitle number="4" title="Key Deliverables" />
              {(() => {
                const t = normalizeV2Table(deliverables);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={deliverablesText} />;
              })()}

              {/* ── 5. MILESTONES & TIMELINE ──────────────────── */}
              <SectionTitle number="5" title="Milestones & Timeline" />
              {(() => {
                const t = normalizeV2Table(milestones);
                if (t) return renderV2TableRows(t);
                return (
                  <>
                    <tr>
                      {["Milestone", "Target Date", "Actual Date", "Notes"].map((h) => (
                        <th
                          key={h}
                          className="border-b-2 border-[#c9b99a] bg-[#faf8f4] px-5 py-3.5 text-left text-[11px] font-bold uppercase tracking-[0.12em] text-[#6b5c3e]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {[0, 1, 2, 3].map((i) => (
                        <td key={i} className="border-b border-[#e8e2d6] px-5 py-3.5 text-[13.5px] text-[#3d3529]">{"\u00A0"}</td>
                      ))}
                    </tr>
                  </>
                );
              })()}

              {/* ── 6. FINANCIALS ─────────────────────────────── */}
              <SectionTitle number="6" title="Financials" />
              {(() => {
                const t = normalizeV2Table(financials);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={sectionBody(financials)} />;
              })()}

              {/* ── 7. RISKS ─────────────────────────────────── */}
              <SectionTitle number="7" title="Risks" />
              {(() => {
                const t = normalizeV2Table(risks);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={risksText} />;
              })()}

              {/* ── 8. ISSUES ────────────────────────────────── */}
              <SectionTitle number="8" title="Issues" />
              {(() => {
                const t = normalizeV2Table(issues);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={issuesText} />;
              })()}

              {/* ── 9. ASSUMPTIONS ────────────────────────────── */}
              <SectionTitle number="9" title="Assumptions" />
              {(() => {
                const t = normalizeV2Table(assumptions);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={assumptionsText} />;
              })()}

              {/* ── 10. DEPENDENCIES ──────────────────────────── */}
              <SectionTitle number="10" title="Dependencies" />
              {(() => {
                const t = normalizeV2Table(dependencies);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={dependenciesText} />;
              })()}

              {/* ── 11. PROJECT TEAM ──────────────────────────── */}
              <SectionTitle number="11" title="Project Team" />
              {(() => {
                const t = normalizeV2Table(projectTeam);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={sectionBody(projectTeam)} />;
              })()}

              {/* ── 12. STAKEHOLDERS ──────────────────────────── */}
              <SectionTitle number="12" title="Stakeholders" />
              {(() => {
                const t = normalizeV2Table(stakeholders);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={sectionBody(stakeholders)} />;
              })()}

              {/* ── 13. APPROVAL / REVIEW COMMITTEE ───────────── */}
              <SectionTitle number="13" title="Approval / Review Committee" />
              {(() => {
                const t = normalizeV2Table(approval);
                if (t) return renderV2TableRows(t);
                return <ProseRow text={sectionBody(approval)} />;
              })()}
            </tbody>
          </table>
        </div>

        {/* ── FOOTER ────────────────────────────────────────── */}
        <footer className="mt-12 pt-6">
          <div className="flex items-center justify-center gap-3 mb-4">
            <div className="h-px flex-1 max-w-[120px]" style={{ background: "linear-gradient(90deg, transparent, #d4c9b0)" }} />
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: "linear-gradient(135deg, #b8975a, #d4b97a)" }}
            />
            <div className="h-px flex-1 max-w-[120px]" style={{ background: "linear-gradient(270deg, transparent, #d4c9b0)" }} />
          </div>
          <p
            className="text-center text-[10px] uppercase tracking-[0.25em] font-semibold"
            style={{ color: "#b0a48a", fontFamily: "'Georgia', serif" }}
          >
            End of Project Charter
          </p>
        </footer>
      </div>

      {/* Decorative bottom edge */}
      <div
        className="h-1 w-full"
        style={{ background: "linear-gradient(90deg, #b8975a 0%, #d4b97a 30%, #8c6d3a 60%, #c4a55e 100%)" }}
      />
    </div>
  );
}