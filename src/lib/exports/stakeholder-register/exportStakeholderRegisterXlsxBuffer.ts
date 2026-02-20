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
 * ✅ Canonical XLSX buffer exporter
 * Pipeline: load -> normalize -> render(xlsx)
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

  // ✅ Normalize into DB canonical fields (and keep legacy aliases)
  const cleanRows = normalizeStakeholderRows(rows);

  const xlsxMeta = {
    projectName: safeStr(meta?.projectName) || "Project",
    projectCode: safeStr(meta?.projectCode) || "—",
    organisationName: safeStr(meta?.organisationName) || "—",
    clientName: safeStr(meta?.clientName) || "—",
    author: safeStr(meta?.author) || "",
    generatedDateTime: safeStr(meta?.generatedDateTime || meta?.generated),
  };

  const out = await renderStakeholderRegisterXlsx({ meta: xlsxMeta as any, rows: cleanRows });

  const baseName =
    safeFilename(safeStr(out?.baseName || "")) ||
    safeFilename(`Stakeholder_Register_${safeStr(meta?.projectCode || meta?.projectName || "Project")}`);

  return {
    meta,
    rows: cleanRows,
    xlsx: out.xlsx,
    baseName,
  };
}

/** ✅ Backwards-compatible aliases */
export const exportStakeholderRegisterXlsx = exportStakeholderRegisterXlsxBuffer;
export const exportStakeholderRegisterXlsxbuff = exportStakeholderRegisterXlsxBuffer;

/** ✅ Default export */
export default exportStakeholderRegisterXlsxBuffer;