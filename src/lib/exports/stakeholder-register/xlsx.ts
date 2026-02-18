// src/app/api/artifacts/stakeholder-register/export/xlsx/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { loadStakeholderExportData, renderStakeholderXlsx } from "@/lib/exports/stakeholder-register";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

function safeFilename(name: string) {
  return safeStr(name || "Stakeholder_Register")
    .replace(/[\r\n"]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 120);
}

function contentDisposition(name: string, ext: string) {
  const base = safeFilename(name || "Stakeholder_Register");
  const ascii = `${base}.${ext}`;
  const utf8 = encodeURIComponent(`${base}.${ext}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/* ---------------- core handler (supports GET + POST) ---------------- */

async function handleExport(req: NextRequest, payload?: any) {
  const url = new URL(req.url);

  // Support both GET query params and POST JSON body
  const projectId = safeStr(payload?.projectId ?? url.searchParams.get("projectId"));
  const artifactId = safeStr(payload?.artifactId ?? url.searchParams.get("artifactId"));

  if (!projectId) return jsonErr("Missing projectId", 400);
  if (!artifactId) return jsonErr("Missing artifactId", 400);
  if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);
  if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400);

  const supabase = await createClient();

  // Auth check (session cookie must be present; for fetch use credentials: "include")
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401);
  if (!auth?.user) return jsonErr("Unauthorized", 401);

  // ? PROD: pass the request-scoped supabase client into the loader
  const { meta, rows } = await loadStakeholderExportData({ supabase, projectId, artifactId });

  const out = await renderStakeholderXlsx({ meta, rows });

  if (!out?.xlsx || typeof (out as any).baseName === "undefined") {
    return jsonErr("Exporter returned no data", 500, { got: Object.keys(out || {}) });
  }

  const baseName = safeFilename(out.baseName || "Stakeholder_Register");

  return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(out.xlsx))), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": contentDisposition(baseName, "xlsx"),
      "Cache-Control": "no-store",
      "Vary": "Cookie",
    },
  });
}

/* ---------------- GET ---------------- */

export async function GET(req: NextRequest) {
  try {
    return await handleExport(req);
  } catch (e: any) {
    return jsonErr("Export failed", 500, { message: safeStr(e?.message ?? e) });
  }
}

/* ---------------- POST ---------------- */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    return await handleExport(req, body);
  } catch (e: any) {
    return jsonErr("Export failed", 500, { message: safeStr(e?.message ?? e) });
  }
}
