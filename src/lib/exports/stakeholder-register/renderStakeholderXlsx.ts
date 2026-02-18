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

function normalizeChannel(x: any) {
  return String(x ?? "").trim().replace(/\s+/g, " ");
}

function channelsToString(ch: any): string {
  if (Array.isArray(ch)) return ch.map((x) => normalizeChannel(x)).filter(Boolean).join(", ");
  return safeStr(ch);
}

function titleCaseLevel(v: any): string {
  const s = safeStr(v).toLowerCase();
  if (!s) return "";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return safeStr(v);
}

function titleCaseInfluence(v: any): string {
  // keep the Excel output consistent (High/Medium/Low)
  const s = safeStr(v).toLowerCase();
  if (!s) return "";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return safeStr(v);
}

/**
 * Pick from either:
 *  - export rows: stakeholder/contact/impact_notes/...
 *  - artifact/editor rows: name/point_of_contact/stakeholder_impact/...
 *  - DB-ish rows: contact_info.{...}
 */
function pick(r: any, key: string) {
  const v1 = r?.[key];
  if (v1 != null && safeStr(v1) !== "") return v1;

  const ci = r?.contact_info && typeof r.contact_info === "object" ? r.contact_info : null;
  const v2 = ci?.[key];
  if (v2 != null && safeStr(v2) !== "") return v2;

  return "";
}

type XlsxRow = {
  name: string;
  point_of_contact: string;
  role: string;
  internal_external: string;
  title_role: string;
  impact_level: string;
  influence_level: string;
  stakeholder_mapping: string;
  involvement_milestone: string;
  stakeholder_impact: string;
  channels: string;
  group: string;
};

function mapRow(raw: any): XlsxRow {
  const r = typeof raw === "object" && raw ? raw : {};

  // Accept export shape
  const name = safeStr(r?.name || r?.stakeholder || pick(r, "name"));
  const point_of_contact = safeStr(
    r?.point_of_contact || r?.contact || r?.contact_details || pick(r, "point_of_contact") || pick(r, "email")
  );

  const role = safeStr(r?.role || pick(r, "role") || r?.title_role || pick(r, "title_role"));

  const internal_external = safeStr(r?.internal_external || pick(r, "internal_external"));

  const title_role = safeStr(r?.title_role || pick(r, "title_role"));

  const impact_level = titleCaseLevel(
    r?.impact_level || r?.impact || pick(r, "impact_level") || pick(r, "impact")
  );

  const influence_level = titleCaseInfluence(
    r?.influence_level || r?.influence || pick(r, "influence_level") || pick(r, "influence")
  );

  const stakeholder_mapping = safeStr(
    r?.stakeholder_mapping || r?.mapping || pick(r, "stakeholder_mapping") || pick(r, "mapping")
  );

  const involvement_milestone = safeStr(
    r?.involvement_milestone || r?.milestone || pick(r, "involvement_milestone") || pick(r, "milestone")
  );

  const stakeholder_impact = safeStr(
    r?.stakeholder_impact || r?.impact_notes || pick(r, "stakeholder_impact") || pick(r, "impact_notes") || pick(r, "notes")
  );

  const channels = channelsToString(r?.channels || pick(r, "channels") || r?.preferred_channel || pick(r, "preferred_channel"));

  const group = safeStr(r?.group || pick(r, "group") || "Project");

  return {
    name,
    point_of_contact,
    role,
    internal_external,
    title_role,
    impact_level,
    influence_level,
    stakeholder_mapping,
    involvement_milestone,
    stakeholder_impact,
    channels,
    group,
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
  const generatedAt = safeStr(meta?.generatedAt || meta?.generatedDateTime || meta?.generated);

  const baseName = safeFilename(`Stakeholder_Register_${projectCode || projectName || "Project"}`);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Aliena AI";
  wb.created = new Date();

  const ws = wb.addWorksheet("Stakeholders", {
    properties: { defaultRowHeight: 18 },
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // Columns (match your UI/expected sheet)
  ws.columns = [
    { header: "Name", key: "name", width: 28 },
    { header: "Point of Contact", key: "point_of_contact", width: 28 },
    { header: "Role", key: "role", width: 22 },
    { header: "Internal/External", key: "internal_external", width: 18 },
    { header: "Title/Role", key: "title_role", width: 22 },
    { header: "Impact Level", key: "impact_level", width: 14 },
    { header: "Influence Level", key: "influence_level", width: 14 },
    { header: "Mapping", key: "stakeholder_mapping", width: 18 },
    { header: "Involvement Milestone", key: "involvement_milestone", width: 22 },
    { header: "Stakeholder Impact", key: "stakeholder_impact", width: 40 },
    { header: "Channels", key: "channels", width: 18 },
    { header: "Group", key: "group", width: 16 },
  ];

  // Header styling
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", horizontal: "left" };
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } }; // light gray
    cell.border = {
      top: { style: "thin", color: { argb: "FFE5E7EB" } },
      left: { style: "thin", color: { argb: "FFE5E7EB" } },
      bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
      right: { style: "thin", color: { argb: "FFE5E7EB" } },
    };
  });

  // Data rows
  const mapped = rows.map(mapRow).filter((r) => safeStr(r.name) !== "");
  for (const r of mapped) ws.addRow(r);

  // Format cells
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    row.alignment = { vertical: "top", horizontal: "left", wrapText: true };
    row.eachCell((cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE5E7EB" } },
        left: { style: "thin", color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin", color: { argb: "FFE5E7EB" } },
        right: { style: "thin", color: { argb: "FFE5E7EB" } },
      };
    });
  });

  // Optional info row (kept OUT of the table)
  // (If you want this, uncomment; otherwise leave it out to keep sheet clean.)
  // ws.spliceRows(1, 0, []);
  // ws.getRow(1).height = 20;

  // Auto filter for the table header
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: ws.columns.length },
  };

  // Slightly nicer print defaults
  ws.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };

  const buf = await wb.xlsx.writeBuffer();
  return { xlsx: new Uint8Array(buf as ArrayBuffer), baseName };
}

/** Legacy alias */
export async function renderStakeholderXlsx(args: { meta?: any; rows: any[] }) {
  return renderStakeholderRegisterXlsx(args);
}

export default renderStakeholderRegisterXlsx;
