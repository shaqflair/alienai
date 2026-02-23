// src/app/api/wireai/capabilities/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─── Utils (kept consistent with generate route) ───────────────────────────

function s(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function env(name: string): string {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

function noStore() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function json(data: any, status = 200) {
  return NextResponse.json(data, { status, headers: noStore() });
}

/**
 * Debug toggle:
 * - Non-prod: ?debug=1 works
 * - Prod: requires ALLOW_DEBUG_ROUTES=1 and x-aliena-debug-secret === DEBUG_ROUTE_SECRET
 */
function debugEnabled(req: Request) {
  const url = new URL(req.url);
  const wants = s(url.searchParams.get("debug")).trim() === "1";
  if (!wants) return false;

  const isProd = process.env.NODE_ENV === "production";
  if (!isProd) return true;

  const allowProdDebug = s(process.env.ALLOW_DEBUG_ROUTES).trim() === "1";
  if (!allowProdDebug) return false;

  const expected = s(process.env.DEBUG_ROUTE_SECRET).trim();
  const got = s(req.headers.get("x-aliena-debug-secret")).trim();
  return Boolean(expected) && got === expected;
}

// ─── Provider resolution (mirrors generate route exactly) ──────────────────

function resolveProvider(): {
  raw: string;
  normalised: "mock" | "openai";
  hasKey: boolean;
  model: string;
  temperature: number;
} {
  const raw = (env("AI_PROVIDER") || "mock").toLowerCase();
  const hasKey = !!env("WIRE_AI_API_KEY") || !!env("OPENAI_API_KEY");
  const model = env("OPENAI_MODEL") || "gpt-4.1-mini";
  const temperature = Number(env("OPENAI_TEMPERATURE") || "0.2") || 0.2;

  return {
    raw,
    normalised: raw === "mock" ? "mock" : "openai",
    hasKey,
    model: raw === "mock" ? "mock" : model,
    temperature,
  };
}

// ─── Capability matrix ─────────────────────────────────────────────────────

type CapabilityMatrix = {
  schema_version: 1;
  provider: string;
  model: string;
  temperature: number;

  full: boolean;
  section: boolean;
  suggest: boolean;
  validate: boolean;
  closure: boolean;
  weekly: boolean;

  supported_artifact_types: string[];
  supported_section_namespaces: string[];

  reason: string;
  ready: boolean;

  // Only when debug is enabled (never required by the UI)
  debug?: {
    hasKey: boolean;
    normalised: "mock" | "openai";
  };
};

function buildCapabilities(
  provider: ReturnType<typeof resolveProvider>,
  debugOn: boolean
): CapabilityMatrix {
  const isMock = provider.normalised === "mock";
  const isReady = isMock || provider.hasKey;

  const modes = {
    full: isReady,
    section: isReady,
    suggest: isReady,
    validate: isReady,
    closure: isReady,
    weekly: isReady,
  };

  const reason = isMock
    ? "AI_PROVIDER=mock — responses are deterministic placeholders"
    : !provider.hasKey
      ? "No AI key is set — all AI generation disabled"
      : `Live AI via ${provider.raw} (${provider.model})`;

  const out: CapabilityMatrix = {
    schema_version: 1,
    provider: isMock ? "mock" : provider.raw,
    model: provider.model,
    temperature: provider.temperature,
    ...modes,
    supported_artifact_types: ["project_charter", "weekly_report"],
    supported_section_namespaces: ["charter.*", "closure.*"],
    reason,
    ready: isReady,
  };

  if (debugOn) {
    out.debug = { hasKey: provider.hasKey, normalised: provider.normalised };
  }

  return out;
}

// ─── Handlers ──────────────────────────────────────────────────────────────

export async function GET(req: Request) {
  // Auth gate
  try {
    const supabase = await createClient();
    const { data: auth, error } = await supabase.auth.getUser();
    if (error || !auth?.user) {
      return json({ ok: false, error: "Not authenticated" }, 401);
    }
  } catch {
    return json({ ok: false, error: "Auth check failed" }, 401);
  }

  const debugOn = debugEnabled(req);
  const provider = resolveProvider();
  const capabilities = buildCapabilities(provider, debugOn);

  return json({ ok: true, capabilities });
}

export async function POST() {
  return json({ ok: false, error: "Method not allowed. Use GET." }, 405);
}