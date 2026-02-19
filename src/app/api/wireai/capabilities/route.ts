// src/app/api/wireai/capabilities/route.ts
import "server-only";

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function provider() {
  return (s(process.env.AI_PROVIDER) || "mock").trim().toLowerCase();
}

function hasKey() {
  // Your generate route uses WIRE_AI_API_KEY
  return !!s(process.env.WIRE_AI_API_KEY).trim();
}

function json(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET() {
  const p = provider();

  // If you're in mock mode, capabilities are "on" but clearly marked as mock.
  if (p === "mock") {
    return json({
      ok: true,
      provider: "mock",
      full: true,
      section: true,
      suggest: true,
      validate: true,
      reason: "AI_PROVIDER=mock",
    });
  }

  // Real providers must have a key (otherwise the UI should disable AI).
  if (!hasKey()) {
    return json({
      ok: true,
      provider: p,
      full: false,
      section: false,
      suggest: false,
      validate: false,
      reason: "Missing WIRE_AI_API_KEY",
    });
  }

  // If you later add per-mode gating, do it here.
  return json({
    ok: true,
    provider: p,
    full: true,
    section: true,
    suggest: true,
    validate: true,
  });
}
