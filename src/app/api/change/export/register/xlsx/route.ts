import "server-only";

import { NextRequest } from "next/server";
import { exportChangeRegisterXlsx } from "@/lib/exports/xlsx/changeRegisterXlsx";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * API Route: Change Register (XLSX)
 * Supports GET for simple downloads and POST for filtered/large requests.
 */
export async function GET(req: NextRequest) {
  return exportChangeRegisterXlsx(req);
}

export async function POST(req: NextRequest) {
  return exportChangeRegisterXlsx(req);
}
