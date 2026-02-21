// src/lib/exports/stakeholder-register/xlsx.ts
import "server-only";

import { exportStakeholderRegisterXlsxBuffer } from "./exportStakeholderRegisterXlsxBuffer";

/**
 * Backwards-compatible wrapper.
 * Keeps legacy imports working without relying on barrel re-exports.
 */
export async function exportStakeholderRegisterXlsx(args: {
  projectId: string;
  artifactId: string;
  supabase?: any;
}) {
  return exportStakeholderRegisterXlsxBuffer(args);
}
