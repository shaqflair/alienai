// src/lib/exports/stakeholder-register/exportStakeholderRegisterDocxBuffer.ts
import "server-only";

import { loadStakeholderExportData } from "./loadStakeholderExportData";
import { normalizeStakeholderRows } from "./normalize";
import { renderStakeholderRegisterDocx } from "./renderStakeholderDocx";

export type ExportStakeholderRegisterDocxBufferArgs = {
  projectId: string;
  artifactId: string;
  supabase?: any;
};

export type ExportStakeholderRegisterDocxBufferResult = {
  meta: any;
  rows: any[];
  docx: Uint8Array;
  baseName: string;
};

function safeMeta(x: any) {
  // ✅ never allow undefined meta to reach renderer
  if (x && typeof x === "object") return x;
  return {
    projectName: "Project",
    projectCode: "",
    organisationName: "",
    clientName: "",
    generatedAt: "",
    generatedDate: "",
    generatedDateTime: "",
  };
}

/**
 * ✅ Canonical DOCX buffer exporter
 * Pipeline: load -> normalize -> render(docx)
 */
export async function exportStakeholderRegisterDocxBuffer(
  args: ExportStakeholderRegisterDocxBufferArgs
): Promise<ExportStakeholderRegisterDocxBufferResult> {
  const projectId = String(args?.projectId ?? "").trim();
  const artifactId = String(args?.artifactId ?? "").trim();
  const supabase = args?.supabase;

  const loaded = await loadStakeholderExportData({
    supabase,
    projectId,
    artifactId,
  });

  const meta = safeMeta((loaded as any)?.meta);
  const rows = Array.isArray((loaded as any)?.rows) ? (loaded as any).rows : [];

  const cleanRows = normalizeStakeholderRows(rows);

  // ✅ renderer is allowed to receive meta safely now
  const out = await renderStakeholderRegisterDocx({ meta, rows: cleanRows });

  return {
    meta,
    rows: cleanRows,
    docx: out?.docx as Uint8Array,
    baseName: String(out?.baseName ?? "Stakeholder_Register").trim() || "Stakeholder_Register",
  };
}

/** Back-compat aliases */
export const exportStakeholderRegisterDocx = exportStakeholderRegisterDocxBuffer;
export const exportStakeholderRegisterDocxbuff = exportStakeholderRegisterDocxBuffer;

/** Default export (safe for Webpack import shapes) */
export default exportStakeholderRegisterDocxBuffer;
