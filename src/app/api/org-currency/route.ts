// src/app/api/org-currency/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { getOrgCurrency } from "@/lib/server/getOrgCurrency";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const organisationId = req.nextUrl.searchParams.get("organisationId") ?? "";
  if (!organisationId) return NextResponse.json({ currency: "GBP" });
  const currency = await getOrgCurrency(organisationId);
  return NextResponse.json({ currency });
}
