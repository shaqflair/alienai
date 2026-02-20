// src/lib/exports/stakeholder-register/exportStakeholderRegisterXlsxBuffer.ts
import "server-only";

import { createClient } from "@/utils/supabase/server";
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

function toUint8(x: any): Uint8Array {
  if (!x) return new Uint8Array();
  if (x instanceof Uint8Array) return x;
  // eslint-disable-next-line no-undef
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(x)) return new Uint8Array(x);
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (x?.buffer instanceof ArrayBuffer) return new Uint8Array(x.buffer);
  return new Uint8Array();
}

function firstNonEmpty(...vals: any[]) {
  for (const v of vals) {
    const s = safeStr(v);
    if (s) return s;
  }
  return "";
}

/**
 * ✅ Canonical XLSX buffer exporter
 * Pipeline: load -> normalize -> render(xlsx)
 *
 * Hardening:
 * - Ensures we always have a Supabase client
 * - Prevents “empty looking workbook” when normalize returns []
 *   even though loader returned rows (we fallback to raw rows)
 * - Validates XLSX bytes and throws with useful debug meta
 */
export async function exportStakeholderRegisterXlsxBuffer(
  args: ExportStakeholderRegisterXlsxBufferArgs
): Promise<ExportStakeholderRegisterXlsxBufferResult> {
  const projectId = safeStr(args?.projectId);
  const artifactId = safeStr(args?.artifactId);

  if (!projectId) throw new Error("exportStakeholderRegisterXlsxBuffer: Missing projectId");
  if (!artifactId) throw new Error("exportStakeholderRegisterXlsxBuffer: Missing artifactId");

  const supabase = args?.supabase ?? (await createClient());

  const { meta, rows } = await loadStakeholderExportData({
    supabase,
    projectId,
    artifactId,
  });

  // ✅ Normalize into DB canonical fields (and keep legacy aliases)
  let cleanRows: any[] = [];
  try {
    cleanRows = normalizeStakeholderRows(rows);
  } catch {
    cleanRows = [];
  }

  /**
   * ✅ Fallback to raw rows if normalize drops everything.
   * This is the most common reason XLSX "opens empty":
   * loader returned rows, but normalize produced [] (shape mismatch).
   */
  if ((!Array.isArray(cleanRows) || cleanRows.length === 0) && Array.isArray(rows) && rows.length > 0) {
    cleanRows = rows;
  }

  const xlsxMeta = {
    projectName: safeStr(meta?.projectName) || "Project",
    projectCode: safeStr(meta?.projectCode) || "—",
    organisationName: safeStr(meta?.organisationName) || "—",
    clientName: safeStr(meta?.clientName) || "—",
    author: safeStr(meta?.author) || "",
    generatedDateTime: safeStr(meta?.generatedDateTime || meta?.generated),
    // Helpful for debugging in renderers (ignored if unused)
    projectId,
    artifactId,
    rowCount: Array.isArray(cleanRows) ? cleanRows.length : 0,
  };

  const out = await renderStakeholderRegisterXlsx({ meta: xlsxMeta as any, rows: cleanRows });

  const xlsx = toUint8((out as any)?.xlsx ?? (out as any)?.buffer ?? (out as any)?.bytes);
  if (!xlsx.length) {
    throw new Error(
      `Stakeholder XLSX export returned empty output (rows=${xlsxMeta.rowCount}, projectId=${projectId}, artifactId=${artifactId})`
    );
  }

  const baseNameRaw =
    safeStr((out as any)?.baseName || "") ||
    `Stakeholder_Register_${firstNonEmpty(meta?.projectCode, meta?.projectName, "Project")}`;

  const baseName = safeFilename(baseNameRaw) || "Stakeholder_Register";

  return {
    meta,
    rows: cleanRows,
    xlsx,
    baseName,
  };
}

/** ✅ Backwards-compatible aliases */
export const exportStakeholderRegisterXlsx = exportStakeholderRegisterXlsxBuffer;
export const exportStakeholderRegisterXlsxbuff = exportStakeholderRegisterXlsxBuffer;

/** ✅ Default export */
export default exportStakeholderRegisterXlsxBuffer;