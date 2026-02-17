import "server-only";

import type { ChangeRegisterInputs } from "@/lib/exports/change/exportChangeRegisterXlsxBuffer";
import {
  exportChangeRegisterXlsxBuffer,
  parseChangeRegisterInputsFromRequest,
} from "@/lib/exports/change/exportChangeRegisterXlsxBuffer";

/**
 * Compatibility wrapper
 * The API route imports:
 * exportChangeRegisterXlsx from "@/lib/exports/xlsx/changeRegisterXlsx"
 *
 * Your real implementation lives in:
 * "@/lib/exports/change/exportChangeRegisterXlsxBuffer"
 */

// Supports being called either with a Request (route handler style)
// or with parsed inputs (service style).
export async function exportChangeRegisterXlsx(arg: Request | ChangeRegisterInputs) {
  const input =
    arg instanceof Request ? parseChangeRegisterInputsFromRequest(arg) : arg;

  return exportChangeRegisterXlsxBuffer(input);
}

// Optional re-export (handy if the route wants to parse itself)
export { parseChangeRegisterInputsFromRequest };
export type { ChangeRegisterInputs };