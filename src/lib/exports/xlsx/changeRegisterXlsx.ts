// src/lib/exports/xlsx/changeRegisterXlsx.ts
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

type XlsxResult = { buffer: Buffer; filename: string };

function safeFilename(name: string) {
  const v = String(name || "change-register.xlsx").trim();
  // prevent header injection / weird chars
  return v.replace(/[\r\n"]/g, "").slice(0, 180) || "change-register.xlsx";
}

/**
 * Overloads:
 * - Request => Response (route handler compatible)
 * - Inputs  => {buffer, filename} (service compatible)
 */
export async function exportChangeRegisterXlsx(req: Request): Promise<Response>;
export async function exportChangeRegisterXlsx(
  input: ChangeRegisterInputs
): Promise<XlsxResult>;
export async function exportChangeRegisterXlsx(
  arg: Request | ChangeRegisterInputs
): Promise<Response | XlsxResult> {
  // Route-handler style: must return Response
  if (arg instanceof Request) {
    const input = parseChangeRegisterInputsFromRequest(arg);
    const { buffer, filename } = await exportChangeRegisterXlsxBuffer(input);

    const fname = safeFilename(filename || "change-register.xlsx");

    return new Response(buffer, {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // Service style: return raw buffer + name
  return exportChangeRegisterXlsxBuffer(arg);
}

// Optional re-export (handy if the route wants to parse itself)
export { parseChangeRegisterInputsFromRequest };
export type { ChangeRegisterInputs };
