// src/lib/exports/stakeholder-register/pdf.ts
import "server-only";

import { exportStakeholderRegisterPdfBuffer } from "./exportStakeholderRegisterPdfBuffer";

export function stakeholderRegisterPdfFilename(meta: any) {
  const code = String(meta?.projectCode || "").trim();
  const base = code ? `Stakeholder-Register_${code}` : "Stakeholder-Register";
  return `${base}.pdf`;
}

/**
 * Backwards-compatible wrapper.
 * If anything imports "@/lib/exports/stakeholder-register/pdf", it still works.
 */
export async function exportStakeholderRegisterPdf(args: {
  projectId: string;
  artifactId: string;
  logoUrl?: string;
  supabase?: any;
}) {
  return exportStakeholderRegisterPdfBuffer(args);
}
