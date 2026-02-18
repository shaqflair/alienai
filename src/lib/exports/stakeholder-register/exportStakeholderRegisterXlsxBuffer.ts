// src/lib/exports/stakeholder-register/exportStakeholderRegisterXlsxBuffer.ts
import "server-only";

import { loadStakeholderExportData } from "./loadStakeholderExportData";
import { normalizeStakeholderRows } from "./normalize";
import { renderStakeholderRegisterXlsx } from "./renderStakeholderXlsx";

export interface ExportStakeholderRegisterXlsxBufferArgs {
  projectId: string;
  artifactId: string;
  supabase?: any;
}

export interface ExportStakeholderRegisterXlsxBufferResult {
  meta: any;
  rows: any[];
  xlsx: Uint8Array;
  baseName: string;
}

function safeStr(x: any): string {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function safeFilename(name: string) {
  return safeStr(name || "Stakeholder_Register")
    .replace(/[\r\n"]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 120);
}

/**
 * XLSX renderer (your renderStakeholderXlsx.ts) reads:
 * name, point_of_contact, role, impact_level, influence_level, stakeholder_mapping,
 * involvement_milestone, stakeholder_impact, channels
 *
 * Map both supported shapes into that.
 */
function mapToXlsxRow(r: any) {
  return {
    name: safeStr(r?.name ?? r?.stakeholder),
    point_of_contact: safeStr(r?.point_of_contact ?? r?.contact ?? r?.contact_details),
    role: safeStr(r?.role ?? r?.title_role ?? r?.title),
    impact_level: safeStr(r?.impact_level ?? r?.impact),
    influence_level: safeStr(r?.influence_level ?? r?.influence),
    stakeholder_mapping: safeStr(r?.stakeholder_mapping ?? r?.mapping),
    involvement_milestone: safeStr(r?.involvement_milestone ?? r?.milestone),
    stakeholder_impact: safeStr(r?.stakeholder_impact ?? r?.impact_notes ?? r?.impactNotes),
    channels: r?.channels,
    group: safeStr(r?.group),
  };
}

/**
 * ? Canonical XLSX buffer exporter
 * Pipeline: load -> normalize -> map -> render(xlsx)
 */
export async function exportStakeholderRegisterXlsxBuffer(
  args: ExportStakeholderRegisterXlsxBufferArgs
): Promise<ExportStakeholderRegisterXlsxBufferResult> {
  const { projectId, artifactId, supabase } = args;

  const { meta, rows } = await loadStakeholderExportData({
    supabase,
    projectId,
    artifactId,
  });

  const cleanRows = normalizeStakeholderRows(rows);

  // Map to the renderer’s expected keys
  const renderRows = (Array.isArray(cleanRows) ? cleanRows : []).map(mapToXlsxRow);

  // Your XLSX renderer only needs meta.projectCode/projectName for naming
  const xlsxMeta = {
    projectName: safeStr(meta?.projectName) || "Project",
    projectCode: safeStr(meta?.projectCode) || "—",
    organisationName: safeStr(meta?.organisationName) || "—",
    clientName: safeStr(meta?.clientName) || "—",
    author: safeStr(meta?.author) || "",
  };

  const out = await renderStakeholderRegisterXlsx({ meta: xlsxMeta as any, rows: renderRows });

  const baseName =
    safeFilename(safeStr(out?.baseName || "")) ||
    safeFilename(`Stakeholder_Register_${safeStr(meta?.projectCode || meta?.projectName || "Project")}`);

  return {
    meta,
    rows: renderRows,
    xlsx: out.xlsx,
    baseName,
  };
}

/** ? Backwards-compatible aliases */
export const exportStakeholderRegisterXlsx = exportStakeholderRegisterXlsxBuffer;
export const exportStakeholderRegisterXlsxbuff = exportStakeholderRegisterXlsxBuffer;

/** ? Default export */
export default exportStakeholderRegisterXlsxBuffer;
