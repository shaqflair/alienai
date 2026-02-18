// src/lib/exports/stakeholder-register/docx.ts
import "server-only";

import { exportStakeholderRegisterDocxBuffer } from "./exportStakeholderRegisterDocxBuffer";

export async function exportStakeholderRegisterDocx(args: {
  projectId: string;
  artifactId: string;
  supabase?: any;
}) {
  return exportStakeholderRegisterDocxBuffer(args);
}
