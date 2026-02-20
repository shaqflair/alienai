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

function titleCaseLoose(v: any) {
  const s = safeStr(v);
  if (!s) return "—";
  // If already looks like "Keep Satisfied" / "Monitor" etc, keep it
  if (/[a-z]/.test(s) && /[A-Z]/.test(s)) return s;
  // If all-caps like "MEDIUM", normalise nicely
  const low = s.toLowerCase();
  return low.charAt(0).toUpperCase() + low.slice(1);
}

function joinChannels(x: any) {
  if (Array.isArray(x)) return x.map((v) => safeStr(v)).filter(Boolean).join(", ");
  return safeStr(x);
}

/**
 * Your canonical DB uses:
 * contact_info.point_of_contact
 * contact_info.channels (array)
 */
function contactDetailsToString(row: any) {
  const r = typeof row === "object" && row ? row : {};
  const ci = r?.contact_info && typeof r.contact_info === "object" ? r.contact_info : null;

  const point = safeStr(ci?.point_of_contact);
  const legacy = safeStr(r?.contact ?? r?.contact_details ?? r?.point_of_contact ?? "");
  if (point) return point;
  if (legacy) return legacy;

  // fallback stringification
  if (!ci) return "—";
  try {
    const s = JSON.stringify(ci);
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  } catch {
    return "—";
  }
}

type XlsxRow = {
  stakeholder: string;
  contact_details: string;
  role: string;
  type: string;
  title_role: string;
  impact: string;
  influence: string;
  mapping: string;
  milestone: string;
  impact_notes: string;
  channels: string;
  actions: string;
};

function mapRow(raw: any): XlsxRow {
  const r = typeof raw === "object" && raw ? raw : {};
  const ci = r?.contact_info && typeof r.contact_info === "object" ? r.contact_info : {};

  const stakeholder = safeStr(r?.name ?? r?.stakeholder) || "—";
  const role = safeStr(r?.role) || "—";

  // ✅ Influence is top-level (but may exist as legacy alias too)
  const influence = influenceLabel(r?.influence_level ?? r?.influence);

  // ✅ Pull all “register columns” from contact_info (source of truth), with legacy fallbacks
  const type = titleCaseLoose(ci?.internal_external ?? r?.type ?? r?.internal_external);
  const title_role = safeStr(ci?.title_role ?? r?.title_role ?? r?.title) || "—";
  const impact = titleCaseLoose(ci?.impact_level ?? r?.impact_level ?? r?.impact);
  const mapping = safeStr(ci?.stakeholder_mapping ?? r?.stakeholder_mapping ?? r?.mapping) || "—";
  const milestone = safeStr(ci?.involvement_milestone ?? r?.involvement_milestone ?? r?.milestone) || "—";

  const impact_notes =
    safeStr(ci?.stakeholder_impact ?? r?.stakeholder_impact ?? r?.impact_notes ?? r?.expectations ?? r?.notes) || "—";

  const channels =
    joinChannels(ci?.channels) ||
    joinChannels(r?.channels) ||
    // Some legacy pipelines stuck channels into communication_strategy
    joinChannels(r?.communication_strategy) ||
    "—";

  const actions = safeStr(r?.communication_strategy ?? r?.actions ?? r?.communication) || "—";
  const contact_details = contactDetailsToString(r) || "—";

  return {
    stakeholder: stakeholder || "—",
    contact_details,
    role,
    type,
    title_role,
    impact,
    influence: influence || "Medium",
    mapping,
    milestone,
    impact_notes,
    channels,
    actions,
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

  // ✅ Columns you requested (in order)
  ws.columns = [
    { header: "Stakeholder", key: "stakeholder", width: 26 },
    { header: "Contact Details", key: "contact_details", width: 28 },
    { header: "Role", key: "role", width: 22 },
    { header: "Type", key: "type", width: 12 },
    { header: "Title/Role", key: "title_role", width: 18 },
    { header: "Impact", key: "impact", width: 10 },
    { header: "Influence", key: "influence", width: 10 },
    { header: "Mapping", key: "mapping", width: 16 },
    { header: "Milestone", key: "milestone", width: 18 },
    { header: "Impact Notes", key: "impact_notes", width: 44 },
    { header: "Channels", key: "channels", width: 16 },
    { header: "Actions", key: "actions", width: 28 },
  ];

  // Header styling
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle", horizontal: "left" };

  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B3A67" } }; // Charter deep blue
    cell.border = thinBorder("FFCBD5E1");
  });

  // ✅ Data (do NOT drop rows just because name is "—" unless it is genuinely empty)
  const mapped = rows
    .map(mapRow)
    .filter((r) => safeStr(r.stakeholder) !== "" && safeStr(r.stakeholder) !== "—");

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