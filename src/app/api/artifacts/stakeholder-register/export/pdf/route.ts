import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// ✅ DIRECT IMPORT (Charter-style) — eliminates “is not a function”
import { exportStakeholderRegisterPdfBuffer } from "@/lib/exports/stakeholder-register/exportStakeholderRegisterPdfBuffer";

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
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
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

/* ---------------- GET ---------------- */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const projectId = safeStr(searchParams.get("projectId"));
    const artifactId = safeStr(searchParams.get("artifactId"));

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!artifactId) return jsonErr("Missing artifactId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400, { projectId });
    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400, { artifactId });

    // request-scoped supabase (cookie/session)
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const logoUrl = safeStr(
      process.env.NEXT_PUBLIC_ALIENA_LOGO_URL ||
        "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
    );

    const { meta, pdf } = await exportStakeholderRegisterPdfBuffer({
      supabase,
      projectId,
      artifactId,
      logoUrl,
    });

    const baseName = safeFilename(`Stakeholder-Register_${safeStr(meta?.projectCode || "Project")}`);

    return new NextResponse(pdf as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(baseName, "pdf"),
        "Cache-Control": "no-store",
        "Vary": "Cookie",
      },
    });
  } catch (e: any) {
    console.error("[stakeholder-register/pdf] export failed:", e);
    return jsonErr("Failed to export PDF", 500, {
      message: safeStr(e?.message ?? e),
      stack: process.env.NODE_ENV === "development" ? String(e?.stack || "") : undefined,
    });
  }
}

