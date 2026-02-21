/* ============================
   Stakeholder Register exports (CLIENT-SAFE)
   - Do NOT export server-only renderers/buffer exporters here.
   - Client UI may import this barrel.
============================ */

export { loadStakeholderExportData } from "./loadStakeholderExportData";
export { normalizeStakeholderRows } from "./normalize";

/* ============================
   Shared contracts
============================ */

export * from "./types";
export * from "./utils";
export * from "./stakeholderShared";

/**
 * ✅ Server-only exports live in:
 *   src/lib/exports/stakeholder-register/server.ts
 */
