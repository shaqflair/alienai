import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// ✅ import directly from the file (bypasses any barrel/shim confusion)
import { exportStakeholderRegisterPdfBuffer } from "@/lib/exports/stakeholder-register/exportStakeholderRegisterPdfBuffer";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

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

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const projectId = safeStr(searchParams.get("projectId"));
    const artifactId = safeStr(searchParams.get("artifactId"));

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!artifactId) return jsonErr("Missing artifactId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400, { projectId });
    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400, { artifactId });

    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const logoUrl =
      process.env.NEXT_PUBLIC_ALIENA_LOGO_URL ||
      "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png";

    const { meta, pdf } = await exportStakeholderRegisterPdfBuffer({
      supabase,
      projectId,
      artifactId,
      logoUrl,
    });

    const baseName = safeFilename(`Stakeholder-Register_${safeStr(meta.projectCode || "Project")}`);

    return new NextResponse(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(baseName, "pdf"),
        "Cache-Control": "no-store",
        "Vary": "Cookie",
      },
    });
  } catch (e: any) {
    return jsonErr("Failed to export PDF", 500, {
      message: safeStr(e?.message ?? e),
      stack: process.env.NODE_ENV === "development" ? String(e?.stack || "") : undefined,
    });
  }
}
