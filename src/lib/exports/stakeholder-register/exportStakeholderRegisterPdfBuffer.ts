// src/lib/exports/stakeholder-register/exportStakeholderRegisterPdfBuffer.ts
import "server-only";

import { loadStakeholderExportData } from "./loadStakeholderExportData";
import { normalizeStakeholderRows } from "./normalize";
import { renderStakeholderRegisterHtml } from "./renderStakeholderRegisterHtml";
import { renderStakeholderRegisterPdf } from "./renderStakeholderPdf";

export interface ExportStakeholderRegisterPdfBufferArgs {
  projectId: string;
  artifactId: string;
  logoUrl?: string;
  supabase?: any;
}

export interface ExportStakeholderRegisterPdfBufferResult {
  meta: any;
  rows: any[];
  pdf: Buffer | Uint8Array;
}

/**
 * ✅ Canonical PDF buffer exporter (named export)
 * Pipeline: load -> normalize -> html -> pdf
 */
export async function exportStakeholderRegisterPdfBuffer(
  args: ExportStakeholderRegisterPdfBufferArgs
): Promise<ExportStakeholderRegisterPdfBufferResult> {
  const { projectId, artifactId, logoUrl, supabase } = args;

  const { meta, rows } = await loadStakeholderExportData({
    supabase,
    projectId,
    artifactId,
  });

  const cleanRows = normalizeStakeholderRows(rows);

  const html = renderStakeholderRegisterHtml({
    meta,
    rows: cleanRows,
    logoUrl,
  });

  const pdf = await renderStakeholderRegisterPdf(html);

  return { meta, rows: cleanRows, pdf };
}

/**
 * ✅ Backwards-compatible aliases
 */
export const exportStakeholderRegisterPdfbuff = exportStakeholderRegisterPdfBuffer;
export const exportStakeholderRegisterPdf = exportStakeholderRegisterPdfBuffer;

/**
 * ✅ Default export for maximum compatibility
 */
export default exportStakeholderRegisterPdfBuffer;