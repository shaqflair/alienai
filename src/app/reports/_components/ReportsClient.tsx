"use client";
// FILE: src/app/reports/_components/ReportsClient.tsx

import { useState, useEffect, useCallback } from "react";
import type { ReportBundle } from "../_lib/reports-data";

type ReportTab = "utilByPerson" | "utilByProject" | "cost" | "leave" | "pipeline";

const TABS: { id: ReportTab; label: string; icon: string }[] = [
  { id: "utilByPerson",  label: "Util by Person",   icon: "👤" },
  { id: "utilByProject", label: "Util by Project",  icon: "📁" },
  { id: "cost",          label: "Cost Report",       icon: "💷" },
  { id: "leave",         label: "Leave Summary",     icon: "🏖️" },
  { id: "pipeline",      label: "Pipeline Forecast", icon: "📊" },
];

const REASON_LABELS: Record<string, string> = {
  annual_leave: "Annual Leave", public_holiday: "Public Holiday",
  training: "Training", sick_leave: "Sick Leave",
  parental_leave: "Parental Leave", other: "Other",
};

function fmt(n: number, decimals = 1) {
  return n.toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtCurrency(n: number, currency = "GBP") {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}
function fmtDate(iso: string) {
  if (!iso) return "--";
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
}
function fmtWeek(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
function utilColour(pct: number) {
  if (pct > 110) return "#7c3aed";
  if (pct > 100) return "#ef4444";
  if (pct >= 75) return "#f59e0b";
  if (pct > 0)   return "#10b981";
  return "#94a3b8";
}
function utilBg(pct: number) {
  if (pct > 110) return "rgba(124,58,237,0.1)";
  if (pct > 100) return "rgba(239,68,68,0.1)";
  if (pct >= 75) return "rgba(245,158,11,0.1)";
  if (pct > 0)   return "rgba(16,185,129,0.1)";
  return "#f8fafc";
}

let xlsxLib: any = null;
async function loadXlsx(): Promise<any> {
  if (xlsxLib) return xlsxLib;
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = () => { xlsxLib = (window as any).XLSX; resolve(xlsxLib); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function exportXlsx(data: ReportBundle, tab: ReportTab, dateFrom: string, dateTo: string) {
  const XLSX = await loadXlsx();
  const wb   = XLSX.utils.book_new();
  const period = `${fmtDate(dateFrom)} - ${fmtDate(dateTo)}`;
  function addSheet(name: string, rows: any[][], colWidths: number[]) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = colWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  if (tab === "utilByPerson") {
    for (const p of data.utilisationByPerson) {
      addSheet(p.fullName.substring(0, 31), [
        [`Utilisation Report - ${p.fullName}`], [`Period: ${period}`],
        [`Dept: ${p.department || "--"} | Capacity: ${p.totals.totalCapacity}d | Allocated: ${p.totals.totalAllocated}d | Avg: ${p.totals.avgUtilPct}% | Peak: ${p.totals.peakUtilPct}%`],
        [], ["Week", "Allocated (d)", "Capacity (d)", "Utilisation %", "Exception"],
        ...p.weeks.filter(w => w.allocated > 0 || w.exceptions).map(w => [fmtWeek(w.weekStart), w.allocated, w.capacity, `${w.utilPct}%`, w.exceptions || ""]),
        [], ["TOTAL", p.totals.totalAllocated, p.totals.totalCapacity, `${p.totals.avgUtilPct}% avg`, `${p.totals.overAllocWeeks} over-alloc weeks`],
      ], [14, 14, 14, 14, 22]);
    }
    addSheet("Summary", [
      [`Utilisation Summary - ${period}`], [],
      ["Name", "Department", "Emp Type", "Allocated (d)", "Capacity (d)", "Avg Util %", "Peak Util %", "Over-alloc Weeks", "Rate Card"],
      ...data.utilisationByPerson.map(p => [p.fullName, p.department || "--", p.empType, p.totals.totalAllocated, p.totals.totalCapacity, `${p.totals.avgUtilPct}%`, `${p.totals.peakUtilPct}%`, p.totals.overAllocWeeks, p.rateLabel || "--"]),
    ], [22, 16, 14, 14, 14, 12, 12, 18, 20]);
  } else if (tab === "utilByProject") {
    addSheet("By Project", [
      [`Utilisation by Project - ${period}`], [],
      ["Project", "Code", "Status", "Start", "End", "People", "Total Days", "Peak Week Days"],
      ...data.utilisationByProject.map(p => [p.title, p.projectCode || "--", p.status, fmtDate(p.startDate || ""), fmtDate(p.endDate || ""), p.totals.uniquePeople, p.totals.totalDays, p.totals.peakWeekDays]),
    ], [30, 10, 12, 12, 12, 10, 12, 16]);
    for (const proj of data.utilisationByProject.slice(0, 10)) {
      addSheet(proj.title.replace(/[/\\?*[\]]/g, "").substring(0, 31), [
        [proj.title], [`Code: ${proj.projectCode || "--"} | ${fmtDate(proj.startDate || "")} - ${fmtDate(proj.endDate || "")}`],
        [], ["Person", "Total Days", "Weeks", "Avg Days/Wk"],
        ...proj.people.map(p => [p.fullName, p.totalDays, p.weekCount, p.avgDaysPerWk]),
        [], ["TOTAL", proj.totals.totalDays, "", ""],
      ], [24, 12, 10, 14]);
    }
  } else if (tab === "cost") {
    const byProject: any[][] = [[`Cost by Project - ${period}`], [], ["Person", "Department", "Project", "Project Code", "Days", "Cost"]];
    for (const person of data.costReport) for (const proj of person.projects) byProject.push([person.fullName, person.department || "--", proj.title, proj.projectCode || "--", proj.totalDays, proj.totalCost ?? "--"]);
    addSheet("Cost Summary", [
      [`Cost Report - ${period}`], [],
      ["Name", "Department", "Rate Card", "Rate/Day", "Currency", "Total Days", "Total Cost"],
      ...data.costReport.map(p => [p.fullName, p.department || "--", p.rateLabel || "No rate card", p.ratePerDay ?? "--", p.currency, p.totals.totalDays, p.totals.totalCost ?? "--"]),
      [], ["TOTAL", "", "", "", "", data.costReport.reduce((s, r) => s + r.totals.totalDays, 0), data.costReport.filter(r => r.totals.totalCost != null).reduce((s, r) => s + (r.totals.totalCost ?? 0), 0)],
    ], [22, 16, 20, 12, 10, 12, 14]);
    addSheet("By Project", byProject, [22, 16, 26, 14, 12, 14]);
  } else if (tab === "leave") {
    const detail: any[][] = [[`Leave Detail - ${period}`], [], ["Name", "Department", "Week", "Available Days", "Days Lost", "Reason", "Notes"]];
    for (const p of data.leaveSummary) for (const ex of p.exceptions) detail.push([p.fullName, p.department || "--", fmtWeek(ex.weekStart), ex.availDays, ex.daysLost, REASON_LABELS[ex.reason] || ex.reason, ex.notes || ""]);
    addSheet("Leave Summary", [
      [`Leave Summary - ${period}`], [],
      ["Name", "Department", "Total Days Lost", "Weeks", "Full Day Offs"],
      ...data.leaveSummary.map(p => [p.fullName, p.department || "--", p.totals.totalDaysLost, p.totals.totalWeeks, p.totals.fullDayOffs]),
    ], [22, 16, 16, 12, 14]);
    addSheet("Detail", detail, [22, 16, 12, 14, 12, 18, 24]);
  } else if (tab === "pipeline") {
    const roles: any[][] = [[`Role Requirements - ${period}`], [], ["Project", "Role", "Days/Wk", "Start", "End", "Total Days", "Filled", "Filled By"]];
    for (const proj of data.pipelineForecast) for (const role of proj.roles) roles.push([proj.title, role.roleTitle, role.daysPerWeek, fmtDate(role.startDate || ""), fmtDate(role.endDate || ""), role.totalDays, role.isFilled ? "Yes" : "No", role.filledBy || "--"]);
    addSheet("Pipeline Summary", [
      [`Pipeline Forecast - ${period}`], [],
      ["Project", "Code", "Win %", "Start", "End", "Roles", "Total Demand (d)", "Weighted (d)", "Unfilled (d)"],
      ...data.pipelineForecast.map(p => [p.title, p.projectCode || "--", `${p.winProbability}%`, fmtDate(p.startDate || ""), fmtDate(p.endDate || ""), p.roles.length, p.totals.totalDemandDays, p.totals.weightedDemandDays, p.totals.unfilledDays]),
      [], ["TOTAL", "", "", "", "", "", data.pipelineForecast.reduce((s, p) => s + p.totals.totalDemandDays, 0), data.pipelineForecast.reduce((s, p) => s + p.totals.weightedDemandDays, 0), data.pipelineForecast.reduce((s, p) => s + p.totals.unfilledDays, 0)],
    ], [28, 12, 8, 12, 12, 8, 18, 20, 14]);
    addSheet("Roles", roles, [28, 20, 10, 12, 12, 12, 10, 20]);
  }
  XLSX.writeFile(wb, `Aliena_${tab}_${dateFrom}_${dateTo}.xlsx`);
}

function buildClipboardText(data: ReportBundle, tab: ReportTab): string {
  const rows: string[][] = [];
  if (tab === "utilByPerson") {
    rows.push(["Name", "Department", "Allocated (d)", "Capacity (d)", "Avg Util %", "Peak Util %", "Over-alloc Weeks"]);
    for (const p of data.utilisationByPerson) rows.push([p.fullName, p.department || "--", String(p.totals.totalAllocated), String(p.totals.totalCapacity), `${p.totals.avgUtilPct}%`, `${p.totals.peakUtilPct}%`, String(p.totals.overAllocWeeks)]);
  } else if (tab === "utilByProject") {
    rows.push(["Project", "Code", "Total Days", "Peak Week Days", "People"]);
    for (const p of data.utilisationByProject) rows.push([p.title, p.projectCode || "--", String(p.totals.totalDays), String(p.totals.peakWeekDays), String(p.totals.uniquePeople)]);
  } else if (tab === "cost") {
    rows.push(["Name", "Department", "Rate Card", "Rate/Day", "Total Days", "Total Cost"]);
    for (const p of data.costReport) rows.push([p.fullName, p.department || "--", p.rateLabel || "--", p.ratePerDay ? String(p.ratePerDay) : "--", String(p.totals.totalDays), p.totals.totalCost != null ? fmtCurrency(p.totals.totalCost, p.currency) : "--"]);
  } else if (tab === "leave") {
    rows.push(["Name", "Department", "Days Lost", "Weeks", "Full Day Offs"]);
    for (const p of data.leaveSummary) rows.push([p.fullName, p.department || "--", String(p.totals.totalDaysLost), String(p.totals.totalWeeks), String(p.totals.fullDayOffs)]);
  } else if (tab === "pipeline") {
    rows.push(["Project", "Code", "Win %", "Total Demand (d)", "Weighted (d)", "Unfilled (d)"]);
    for (const p of data.pipelineForecast) rows.push([p.title, p.projectCode || "--", `${p.winProbability}%`, String(p.totals.totalDemandDays), String(p.totals.weightedDemandDays), String(p.totals.unfilledDays)]);
  }
  return rows.map(r => r.join("\t")).join("\n");
}

const inputStyle: React.CSSProperties = {
  padding: "8px 10px", borderRadius: "7px", border: "1.5px solid #e2e8f0",
  background: "white", fontSize: "13px", color: "#0f172a", outline: "none", fontFamily: "inherit",
};
const thStyle: React.CSSProperties = {
  padding: "9px 12px", textAlign: "left", fontWeight: 700, color: "#475569",
  fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: "2px solid #e2e8f0", whiteSpace: "nowrap",
};
const tdBase: React.CSSProperties = { padding: "9px 12px", borderBottom: "1px solid #f1f5f9" };

function StatPill({ label, value, colour }: { label: string; value: string | number; colour?: string }) {
  return (
    <div style={{ padding: "8px 14px", borderRadius: "8px", background: "white", border: "1.5px solid #e2e8f0", textAlign: "center" }}>
      <div style={{ fontSize: "16px", fontWeight: 800, color: colour || "#0f172a", fontFamily: "monospace" }}>{value}</div>
      <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
    </div>
  );
}
function EmptyState({ message }: { message: string }) {
  return <div style={{ padding: "48px 0", textAlign: "center", color: "#94a3b8", fontSize: "14px" }}>{message}</div>;
}

function UtilByPersonTable({ data }: { data: ReportBundle["utilisationByPerson"] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!data.length) return <EmptyState message="No allocation data in this period." />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {["Name", "Department", "Allocated", "Capacity", "Avg Util", "Peak Util", "Over-alloc Wks", "Rate Card"].map(h => <th key={h} style={thStyle}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((p, i) => (
            <>
              <tr key={p.personId} style={{ background: i % 2 === 0 ? "white" : "#fafafa", cursor: "pointer" }} onClick={() => setExpanded(expanded === p.personId ? null : p.personId)}>
                <td style={tdBase}>
                  <span style={{ marginRight: 6, color: "#94a3b8", fontSize: "10px" }}>{expanded === p.personId ? "▾" : "▸"}</span>
                  <span style={{ fontWeight: 600, color: "#0f172a" }}>{p.fullName}</span>
                </td>
                <td style={{ ...tdBase, color: "#64748b" }}>{p.department || "--"}</td>
                <td style={{ ...tdBase, fontFamily: "monospace" }}>{p.totals.totalAllocated}d</td>
                <td style={{ ...tdBase, fontFamily: "monospace" }}>{p.totals.totalCapacity}d</td>
                <td style={tdBase}>
                  <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: "5px", background: utilBg(p.totals.avgUtilPct), color: utilColour(p.totals.avgUtilPct), fontWeight: 700, fontFamily: "monospace", fontSize: "12px" }}>{p.totals.avgUtilPct}%</span>
                </td>
                <td style={{ ...tdBase, fontFamily: "monospace", fontWeight: 700, color: utilColour(p.totals.peakUtilPct) }}>{p.totals.peakUtilPct}%</td>
                <td style={{ ...tdBase, fontFamily: "monospace", color: p.totals.overAllocWeeks > 0 ? "#ef4444" : "#94a3b8" }}>{p.totals.overAllocWeeks}</td>
                <td style={{ ...tdBase, color: "#64748b", fontSize: "12px" }}>{p.rateLabel || <span style={{ color: "#e2e8f0" }}>--</span>}</td>
              </tr>
              {expanded === p.personId && (
                <tr key={`${p.personId}-exp`}>
                  <td colSpan={8} style={{ padding: "0 12px 12px", background: "#f8fafc" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", paddingTop: "8px" }}>
                      {p.weeks.filter(w => w.allocated > 0 || w.exceptions).map(w => (
                        <div key={w.weekStart} style={{ padding: "5px 8px", borderRadius: "6px", background: utilBg(w.utilPct), border: `1px solid ${utilColour(w.utilPct)}30`, fontSize: "11px", minWidth: "70px" }}>
                          <div style={{ color: "#64748b", marginBottom: "2px" }}>{fmtWeek(w.weekStart)}</div>
                          <div style={{ fontWeight: 800, fontFamily: "monospace", color: utilColour(w.utilPct) }}>{w.utilPct}%</div>
                          <div style={{ color: "#94a3b8", fontSize: "10px" }}>{w.allocated}d / {w.capacity}d</div>
                          {w.exceptions && <div style={{ color: "#f59e0b", fontSize: "9px", marginTop: "1px" }}>⚠ {w.exceptions}</div>}
                        </div>
                      ))}
                      {!p.weeks.some(w => w.allocated > 0 || w.exceptions) && (
                        <span style={{ fontSize: "12px", color: "#94a3b8", padding: "8px 0" }}>No allocated weeks in this period</span>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UtilByProjectTable({ data }: { data: ReportBundle["utilisationByProject"] }) {
  if (!data.length) return <EmptyState message="No project allocations in this period." />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr style={{ background: "#f8fafc" }}>
            {["Project", "Status", "Dates", "People", "Total Days", "Peak Week"].map(h => <th key={h} style={thStyle}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((p, i) => (
            <tr key={p.projectId} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
              <td style={tdBase}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.colour, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 700, color: "#0f172a" }}>{p.title}</div>
                    {p.projectCode && <div style={{ fontSize: "11px", color: "#94a3b8" }}>{p.projectCode}</div>}
                  </div>
                </div>
              </td>
              <td style={tdBase}><span style={{ fontSize: "11px", fontWeight: 700, padding: "2px 7px", borderRadius: "4px", background: p.status === "confirmed" ? "rgba(16,185,129,0.1)" : "rgba(124,58,237,0.1)", color: p.status === "confirmed" ? "#059669" : "#7c3aed" }}>{p.status}</span></td>
              <td style={{ ...tdBase, color: "#64748b", fontSize: "12px" }}>{fmtDate(p.startDate || "")} – {fmtDate(p.endDate || "")}</td>
              <td style={tdBase}>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {p.people.slice(0, 4).map(per => <span key={per.personId} style={{ fontSize: "11px", padding: "1px 6px", borderRadius: "4px", background: "#f1f5f9", color: "#475569" }}>{per.fullName.split(" ")[0]}</span>)}
                  {p.people.length > 4 && <span style={{ fontSize: "11px", color: "#94a3b8" }}>+{p.people.length - 4}</span>}
                </div>
              </td>
              <td style={{ ...tdBase, fontFamily: "monospace", fontWeight: 700, color: "#0f172a" }}>{fmt(p.totals.totalDays)}d</td>
              <td style={{ ...tdBase, fontFamily: "monospace", color: "#64748b" }}>{fmt(p.totals.peakWeekDays)}d/wk</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CostTable({ data }: { data: ReportBundle["costReport"] }) {
  if (!data.length) return <EmptyState message="No allocation data. Add rate cards to people to see costs." />;
  const totalDays = data.reduce((s, r) => s + r.totals.totalDays, 0);
  const totalCost = data.filter(r => r.totals.totalCost != null).reduce((s, r) => s + (r.totals.totalCost ?? 0), 0);
  const hasCosts  = data.some(r => r.totals.totalCost != null);
  return (
    <div>
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <StatPill label="Total days" value={`${fmt(totalDays)}d`} />
        {hasCosts && <StatPill label="Total cost" value={fmtCurrency(totalCost)} colour="#10b981" />}
        <StatPill label="People" value={data.length} />
        {!hasCosts && <div style={{ fontSize: "12px", color: "#f59e0b", alignSelf: "center" }}>⚠ Some people have no rate card — costs may be incomplete</div>}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Name", "Department", "Rate Card", "Rate/Day", "Projects", "Total Days", "Total Cost"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {data.map((p, i) => (
              <tr key={p.personId} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={{ ...tdBase, fontWeight: 700, color: "#0f172a" }}>{p.fullName}</td>
                <td style={{ ...tdBase, color: "#64748b" }}>{p.department || "--"}</td>
                <td style={{ ...tdBase, color: "#64748b", fontSize: "12px" }}>{p.rateLabel || "--"}</td>
                <td style={{ ...tdBase, fontFamily: "monospace" }}>{p.ratePerDay != null ? fmtCurrency(p.ratePerDay, p.currency) : <span style={{ color: "#e2e8f0" }}>--</span>}</td>
                <td style={tdBase}><div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>{p.projects.slice(0, 3).map(proj => <span key={proj.projectId} style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: `${proj.colour}15`, color: proj.colour, fontWeight: 700, border: `1px solid ${proj.colour}30` }}>{proj.projectCode || proj.title.substring(0, 8)}</span>)}</div></td>
                <td style={{ ...tdBase, fontFamily: "monospace", fontWeight: 700 }}>{fmt(p.totals.totalDays)}d</td>
                <td style={{ ...tdBase, fontFamily: "monospace", fontWeight: 700, color: "#10b981" }}>{p.totals.totalCost != null ? fmtCurrency(p.totals.totalCost, p.currency) : <span style={{ color: "#e2e8f0" }}>--</span>}</td>
              </tr>
            ))}
            <tr style={{ background: "#f0fdfe", fontWeight: 800 }}>
              <td colSpan={5} style={{ padding: "10px 12px", borderTop: "2px solid #e2e8f0" }}>TOTAL</td>
              <td style={{ padding: "10px 12px", fontFamily: "monospace", borderTop: "2px solid #e2e8f0" }}>{fmt(totalDays)}d</td>
              <td style={{ padding: "10px 12px", fontFamily: "monospace", color: "#10b981", borderTop: "2px solid #e2e8f0" }}>{hasCosts ? fmtCurrency(totalCost) : "--"}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LeaveTable({ data }: { data: ReportBundle["leaveSummary"] }) {
  if (!data.length) return <EmptyState message="No capacity exceptions in this period." />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead><tr style={{ background: "#f8fafc" }}>{["Name", "Department", "Days Lost", "Weeks", "Full Day Offs", "Breakdown"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
        <tbody>
          {data.map((p, i) => (
            <tr key={p.personId} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
              <td style={{ ...tdBase, fontWeight: 700, color: "#0f172a" }}>{p.fullName}</td>
              <td style={{ ...tdBase, color: "#64748b" }}>{p.department || "--"}</td>
              <td style={{ ...tdBase, fontFamily: "monospace", fontWeight: 700, color: "#ef4444" }}>{fmt(p.totals.totalDaysLost)}d</td>
              <td style={{ ...tdBase, fontFamily: "monospace" }}>{p.totals.totalWeeks}</td>
              <td style={{ ...tdBase, fontFamily: "monospace", color: p.totals.fullDayOffs > 0 ? "#ef4444" : "#94a3b8" }}>{p.totals.fullDayOffs}</td>
              <td style={tdBase}>
                <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
                  {p.exceptions.slice(0, 5).map(ex => <div key={ex.weekStart} style={{ fontSize: "10px", padding: "2px 6px", borderRadius: "4px", background: "#f1f5f9", color: "#475569" }}>{fmtWeek(ex.weekStart)} · {REASON_LABELS[ex.reason]?.split(" ")[0] || ex.reason} · {ex.availDays}d</div>)}
                  {p.exceptions.length > 5 && <span style={{ fontSize: "10px", color: "#94a3b8" }}>+{p.exceptions.length - 5} more</span>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipelineTable({ data }: { data: ReportBundle["pipelineForecast"] }) {
  if (!data.length) return <EmptyState message="No pipeline projects with role requirements." />;
  const totalDemand   = data.reduce((s, p) => s + p.totals.totalDemandDays, 0);
  const totalWeighted = data.reduce((s, p) => s + p.totals.weightedDemandDays, 0);
  const totalUnfilled = data.reduce((s, p) => s + p.totals.unfilledDays, 0);
  return (
    <div>
      <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap" }}>
        <StatPill label="Total demand"    value={`${fmt(totalDemand)}d`} />
        <StatPill label="Weighted demand" value={`${fmt(totalWeighted)}d`} colour="#7c3aed" />
        <StatPill label="Unfilled"        value={`${fmt(totalUnfilled)}d`} colour="#ef4444" />
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <thead><tr style={{ background: "#f8fafc" }}>{["Project", "Win %", "Start", "Roles", "Total Demand", "Weighted", "Unfilled"].map(h => <th key={h} style={thStyle}>{h}</th>)}</tr></thead>
          <tbody>
            {data.map((p, i) => (
              <tr key={p.projectId} style={{ background: i % 2 === 0 ? "white" : "#fafafa" }}>
                <td style={tdBase}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.colour, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>{p.title}</div>
                      {p.projectCode && <div style={{ fontSize: "11px", color: "#94a3b8" }}>{p.projectCode}</div>}
                    </div>
                  </div>
                </td>
                <td style={tdBase}><span style={{ fontWeight: 800, fontFamily: "monospace", color: p.winProbability >= 70 ? "#10b981" : p.winProbability >= 40 ? "#f59e0b" : "#ef4444" }}>{p.winProbability}%</span></td>
                <td style={{ ...tdBase, color: "#64748b", fontSize: "12px" }}>{p.startDate ? fmtDate(p.startDate) : "TBD"}</td>
                <td style={tdBase}><div style={{ display: "flex", gap: "3px", flexWrap: "wrap" }}>{p.roles.map((r, ri) => <span key={ri} style={{ fontSize: "10px", padding: "1px 5px", borderRadius: "3px", background: r.isFilled ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: r.isFilled ? "#059669" : "#dc2626", border: `1px solid ${r.isFilled ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.3)"}` }}>{r.roleTitle.split(" ").pop()}</span>)}</div></td>
                <td style={{ ...tdBase, fontFamily: "monospace", fontWeight: 700 }}>{fmt(p.totals.totalDemandDays)}d</td>
                <td style={{ ...tdBase, fontFamily: "monospace", color: "#7c3aed" }}>{fmt(p.totals.weightedDemandDays)}d</td>
                <td style={{ ...tdBase, fontFamily: "monospace", fontWeight: 700, color: p.totals.unfilledDays > 0 ? "#ef4444" : "#10b981" }}>{fmt(p.totals.unfilledDays)}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ReportsClient({ initialData, initialFrom, initialTo }: { initialData: ReportBundle; initialFrom: string; initialTo: string; }) {
  const [activeTab, setActiveTab] = useState<ReportTab>("utilByPerson");
  const [data,      setData]      = useState(initialData);
  const [from,      setFrom]      = useState(initialFrom);
  const [to,        setTo]        = useState(initialTo);
  const [loading,   setLoading]   = useState(false);
  const [copied,    setCopied]    = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchData = useCallback(async (f: string, t: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports?from=${f}&to=${t}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) { console.error("Reports fetch error:", e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (from && to && to >= from) fetchData(from, to);
  }, [from, to, fetchData]);

  async function handleExport() {
    setExporting(true);
    try { await exportXlsx(data, activeTab, from, to); }
    catch (e) { console.error(e); }
    finally { setExporting(false); }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(buildClipboardText(data, activeTab));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const currentTabData = { utilByPerson: data.utilisationByPerson, utilByProject: data.utilisationByProject, cost: data.costReport, leave: data.leaveSummary, pipeline: data.pipelineForecast }[activeTab];
  const rowCount = Array.isArray(currentTabData) ? currentTabData.length : 0;
  const activeTabMeta = TABS.find(t => t.id === activeTab)!;

  const presets: { l: string; f: () => [string, string] }[] = [
    { l: "This month",    f: () => { const d = new Date(); return [`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`, new Date().toISOString().split("T")[0]]; }},
    { l: "Last 3 months", f: () => { const d = new Date(); d.setMonth(d.getMonth()-3); return [d.toISOString().split("T")[0], new Date().toISOString().split("T")[0]]; }},
    { l: "Last 6 months", f: () => { const d = new Date(); d.setMonth(d.getMonth()-6); return [d.toISOString().split("T")[0], new Date().toISOString().split("T")[0]]; }},
    { l: "This year",     f: () => [`${new Date().getFullYear()}-01-01`, new Date().toISOString().split("T")[0]]},
    { l: "Next quarter",  f: () => { const s = new Date().toISOString().split("T")[0]; const d = new Date(); d.setMonth(d.getMonth()+3); return [s, d.toISOString().split("T")[0]]; }},
  ];

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#f8fafc", padding: "36px 28px" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>

          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "12px" }}>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", margin: 0, marginBottom: "4px" }}>Reports</h1>
              <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
                {data.meta.peopleCount} {data.meta.peopleCount === 1 ? "person" : "people"} · {data.meta.weeks} weeks · Generated{" "}
                {new Date(data.meta.generatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={inputStyle} />
              <span style={{ color: "#94a3b8", fontSize: "12px" }}>→</span>
              <input type="date" value={to}   onChange={e => setTo(e.target.value)}   style={inputStyle} />
              <button type="button" onClick={handleCopy} style={{ padding: "8px 14px", borderRadius: "8px", border: "1.5px solid #e2e8f0", background: "white", color: copied ? "#10b981" : "#475569", fontSize: "12px", fontWeight: 600, cursor: "pointer", transition: "color 0.2s" }}>
                {copied ? "✓ Copied" : "📋 Copy table"}
              </button>
              <button type="button" onClick={handleExport} disabled={exporting} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: exporting ? "#94a3b8" : "#10b981", color: "white", fontSize: "12px", fontWeight: 700, cursor: exporting ? "not-allowed" : "pointer", boxShadow: "0 2px 10px rgba(16,185,129,0.25)" }}>
                {exporting ? "Exporting..." : "⬇ Export XLSX"}
              </button>
            </div>
          </div>

          {/* Presets */}
          <div style={{ display: "flex", gap: "6px", marginBottom: "20px", flexWrap: "wrap" }}>
            {presets.map(p => (
              <button key={p.l} type="button" onClick={() => { const [f, t] = p.f(); setFrom(f); setTo(t); }} style={{ padding: "5px 12px", borderRadius: "6px", border: "1.5px solid #e2e8f0", background: "white", color: "#64748b", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>{p.l}</button>
            ))}
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", gap: "2px", background: "#f1f5f9", borderRadius: "10px", padding: "3px", marginBottom: "16px", width: "fit-content" }}>
            {TABS.map(tab => (
              <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} style={{ padding: "7px 16px", borderRadius: "8px", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer", background: activeTab === tab.id ? "white" : "transparent", color: activeTab === tab.id ? "#0f172a" : "#64748b", boxShadow: activeTab === tab.id ? "0 1px 4px rgba(0,0,0,0.08)" : "none", transition: "all 0.15s", display: "flex", alignItems: "center", gap: "5px" }}>
                {tab.icon} {tab.label}
              </button>
            ))}
          </div>

          {/* Report card */}
          <div style={{ background: "white", borderRadius: "14px", border: "1.5px solid #e2e8f0", boxShadow: "0 1px 8px rgba(0,0,0,0.04)", overflow: "hidden" }}>
            <div style={{ padding: "16px 20px 12px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>{activeTabMeta.icon} {activeTabMeta.label}</div>
                <div style={{ fontSize: "11px", color: "#94a3b8" }}>{rowCount} row{rowCount !== 1 ? "s" : ""} · {from && to ? `${fmtDate(from)} – ${fmtDate(to)}` : ""}</div>
              </div>
              {loading && <div style={{ fontSize: "12px", color: "#94a3b8" }}>⟳ Loading…</div>}
            </div>
            <div style={{ padding: "20px", opacity: loading ? 0.5 : 1, transition: "opacity 0.2s" }}>
              {activeTab === "utilByPerson"  && <UtilByPersonTable  data={data.utilisationByPerson}  />}
              {activeTab === "utilByProject" && <UtilByProjectTable data={data.utilisationByProject} />}
              {activeTab === "cost"          && <CostTable          data={data.costReport}            />}
              {activeTab === "leave"         && <LeaveTable         data={data.leaveSummary}          />}
              {activeTab === "pipeline"      && <PipelineTable      data={data.pipelineForecast}      />}
            </div>
          </div>

        </div>
      </div>
    </>
  );
}