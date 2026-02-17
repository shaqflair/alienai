// src/app/api/wireai/capabilities/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    full: true,
    section: true,
    suggest: true,
    validate: true,
    provider: process.env.AI_PROVIDER || "openai",
  });
}

