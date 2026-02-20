// src/lib/exports/excel.ts
import "server-only";

/**
 * Legacy helper placeholder.
 * Prefer using the concrete exporters under src/lib/exports/xlsx/*.
 */
export function exportToExcel(): never {
  throw new Error("exportToExcel is not implemented. Use a concrete XLSX exporter under src/lib/exports/xlsx/*.");
}