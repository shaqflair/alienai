// src/lib/exports/stakeholder-register/server.ts
import "server-only";

export { renderStakeholderRegisterHtml } from "./renderStakeholderRegisterHtml";
export { renderStakeholderRegisterPdf } from "./renderStakeholderPdf";

export { renderStakeholderDocx, renderStakeholderRegisterDocx } from "./renderStakeholderDocx";
export { renderStakeholderXlsx, renderStakeholderRegisterXlsx } from "./renderStakeholderXlsx";

export { exportStakeholderRegisterPdfBuffer } from "./exportStakeholderRegisterPdfBuffer";

// ? export BOTH named + default-safe (so importers can’t get a non-function)
export { exportStakeholderRegisterDocxBuffer } from "./exportStakeholderRegisterDocxBuffer";
export { exportStakeholderRegisterXlsxBuffer } from "./exportStakeholderRegisterXlsxBuffer";

export { default as exportStakeholderRegisterDocxBufferDefault } from "./exportStakeholderRegisterDocxBuffer";
export { default as exportStakeholderRegisterXlsxBufferDefault } from "./exportStakeholderRegisterXlsxBuffer";
