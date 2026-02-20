import "server-only";

import ExcelJS from "exceljs";

export type StakeholderRegisterXlsxMeta = {
  projectName?: string;
  projectCode?: string;
  organisationName?: string;
  clientName?: string;
  generatedAt?: string;
  generatedDate?: string;
  generatedDateTime?: string;
};

function safeStr(x: any): string {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function safeFilename(name: string) {
  return String(name || "Stakeholder_Register")
    .replace(/[\r\n"]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 120);
}

function influenceLabel(v: any) {
  const s = safeStr(v).toLowerCase();
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return safeStr(v) || "Medium";
}

function contactInfoToString(ci: any) {
  if (!ci) return "—";
  if (typeof ci === "string") return safeStr(ci) || "—";
  if (typeof ci !== "object") return safeStr(ci) || "—";

  const email = safeStr(ci?.email);
  const phone = safeStr(ci?.phone);
  const org = safeStr(ci?.organisation || ci?.organization);
  const notes = safeStr(ci?.notes);

  const parts = [email, phone, org, notes].filter(Boolean);
  if (parts.length) return parts.join(" | ");

  try {
    const s = JSON.stringify(ci);
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  } catch {
    return "—";
  }
}

type XlsxRow = {
  name: string;
  role: string;
  influence_level: string;
  expectations: string;
  communication_strategy: string;
  contact_info: string;
};

function mapRow(raw: any): XlsxRow {
  const r = typeof raw === "object" && raw ? raw : {};
  const name = safeStr(r?.name ?? r?.stakeholder);
  const role = safeStr(r?.role);
  const influence_level = influenceLabel(r?.influence_level ?? r?.influence);
  const expectations = safeStr(r?.expectations ?? r?.impact_notes ?? r?.stakeholder_impact ?? r?.notes);
  const communication_strategy = safeStr(r?.communication_strategy ?? r?.channels ?? r?.communication);
  const contact_info = contactInfoToString(r?.contact_info) || safeStr(r?.contact) || "—";

  return {
    name: name || "—",
    role: role || "—",
    influence_level: influence_level || "Medium",
    expectations: expectations || "—",
    communication_strategy: communication_strategy || "—",
    contact_info: contact_info || "—",
  };
}

function thinBorder(argb = "FFE5E7EB"): ExcelJS.Border {
  return {
    top: { style: "thin", color: { argb } },
    left: { style: "thin", color: { argb } },
    bottom: { style: "thin", color: { argb } },
    right: { style: "thin", color: { argb } },
  };
}

export async function renderStakeholderRegisterXlsx(args: {
  meta?: StakeholderRegisterXlsxMeta | any;
  rows: any[];
}): Promise<{ xlsx: Uint8Array; baseName: string }> {
  const meta = (args?.meta ?? {}) as any;
  const rows = Array.isArray(args?.rows) ? args.rows : [];

  const projectCode = safeStr(meta?.projectCode || meta?.project_code);
  const projectName = safeStr(meta?.projectName || meta?.projectTitle || meta?.project_title);

  const baseName = safeFilename(`Stakeholder_Register_${projectCode || projectName || "Project"}`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aliena AI";
  wb.created = new Date();

  const ws = wb.addWorksheet("Stakeholders", {
    properties: { defaultRowHeight: 18 },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // ✅ Correct DB schema columns
  ws.columns = [
    { header: "Name", key: "name", width: 24 },
    { header: "Role", key: "role", width: 20 },
    { header: "Influence Level", key: "influence_level", width: 14 },
    { header: "Expectations", key: "expectations", width: 40 },
    { header: "Communication Strategy", key: "communication_strategy", width: 40 },
    { header: "Contact Info", key: "contact_info", width: 28 },
  ];

  // Header styling
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle", horizontal: "left" };

  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A67" } }; // Charter deep blue
    cell.border = thinBorder("FFCBD5E1");
  });

  // Data
  const mapped = rows.map(mapRow).filter((r) => safeStr(r.name) !== "" && r.name !== "—");
  for (const r of mapped) ws.addRow(r);

  // Cell formatting
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    row.eachCell((cell) => {
      cell.border = thinBorder("FFCBD5E1");
    });
  });

  // Filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columns.length },
  };

  // Print defaults
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  const buf = await wb.xlsx.writeBuffer();
  return { xlsx: new Uint8Array(buf as ArrayBuffer), baseName };
}

/** Legacy alias */
export async function renderStakeholderXlsx(args: { meta?: any; rows: any[] }) {
  return renderStakeholderRegisterXlsx(args);
}

export default renderStakeholderRegisterXlsx;