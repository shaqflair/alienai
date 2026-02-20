import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// ✅ Concrete imports (avoid barrel confusion / bad export shapes)
import { exportStakeholderRegisterPdfBuffer } from "@/lib/exports/stakeholder-register/exportStakeholderRegisterPdfBuffer";
import exportStakeholderRegisterDocxBuffer from "@/lib/exports/stakeholder-register/exportStakeholderRegisterDocxBuffer";
import exportStakeholderRegisterXlsxBuffer from "@/lib/exports/stakeholder-register/exportStakeholderRegisterXlsxBuffer";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */

function jsonErr(message: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error: message, meta }, { status });
}

function safeStr(x: any): string {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

/** Fixes values like '"uuid"' or "'uuid'" */
function cleanId(x: any): string {
  let s = safeStr(x);
  for (let i = 0; i < 3; i++) {
    const before = s;
    s = s.replace(/^["']+/, "").replace(/["']+$/, "").trim();
    if (s === before) break;
  }
  return s;
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

/**
 * ✅ More tolerant:
 * - "pdf", "pdf-document", "application/pdf"
 * - "docx", "word", "word-document"
 * - "xlsx", "excel", "application/vnd..."
 */
function normalizeFormat(x: string) {
  const f = safeStr(x).toLowerCase();
  if (!f) return "";
  if (f === "pdf" || f.includes("pdf")) return "pdf";
  if (f === "docx" || f === "word" || f.includes("doc") || f.includes("word")) return "docx";
  if (f === "xlsx" || f === "excel" || f.includes("xls") || f.includes("excel")) return "xlsx";
  return "";
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

function toUint8(x: any): Uint8Array {
  if (!x) return new Uint8Array();
  if (x instanceof Uint8Array) return x;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(x)) return new Uint8Array(x);
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (x?.buffer instanceof ArrayBuffer) return new Uint8Array(x.buffer);
  throw new Error("Unsupported binary type");
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function baseNameFromMeta(meta: any, prefix: string) {
  const code = safeStr(meta?.projectCode || meta?.project_code);
  const title = safeStr(meta?.projectName || meta?.projectTitle || meta?.project_title);
  const suffix = [code || null, title || null].filter(Boolean).join("_");
  const base = safeFilename(suffix ? `${prefix}_${suffix}` : prefix);
  return `${base}_${isoDate()}`;
}

async function readIds(req: NextRequest) {
  const url = req.nextUrl;

  const qProjectId = cleanId(url.searchParams.get("projectId"));
  const qArtifactId = cleanId(url.searchParams.get("artifactId"));

  if (req.method === "GET") {
    return { projectId: qProjectId, artifactId: qArtifactId };
  }

  const body = await req.json().catch(() => ({} as any));
  const bProjectId = cleanId(body?.projectId ?? body?.project_id);
  const bArtifactId = cleanId(body?.artifactId ?? body?.artifact_id);

  return {
    projectId: qProjectId || bProjectId,
    artifactId: qArtifactId || bArtifactId,
  };
}

/**
 * ✅ Get format from:
 * 1) route param
 * 2) query string (?format=pdf)
 * 3) POST body ({ format: "pdf" })
 */
async function readFormat(req: NextRequest, formatParamRaw?: string) {
  const qp = safeStr(req.nextUrl.searchParams.get("format"));
  if (formatParamRaw && safeStr(formatParamRaw)) return safeStr(formatParamRaw);
  if (qp) return qp;

  if (req.method !== "GET") {
    const body = await req.json().catch(() => ({} as any));
    const bf = safeStr(body?.format ?? body?.fileType ?? body?.type);
    if (bf) return bf;
  }

  return "";
}

/**
 * Membership check (project_members)
 */
async function requireMember(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw Object.assign(new Error(authErr.message), { status: 401 });
  if (!auth?.user) throw Object.assign(new Error("Unauthorized"), { status: 401 });

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw Object.assign(new Error(memErr.message), { status: 500 });
  if (!mem) throw Object.assign(new Error("Not found"), { status: 404 });

  return { user: auth.user, role: String((mem as any)?.role ?? "viewer") };
}

/* ---------------- core handler ---------------- */

async function handle(req: NextRequest, formatParamRaw?: string) {
  try {
    const formatRaw = await readFormat(req, formatParamRaw);
    const format = normalizeFormat(formatRaw);

    if (!["pdf", "xlsx", "docx"].includes(format)) {
      return jsonErr(`Unsupported format: ${formatRaw || "(empty)"}`, 400, {
        formatRaw,
        queryFormat: safeStr(req.nextUrl.searchParams.get("format")),
      });
    }

    const { projectId, artifactId } = await readIds(req);

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!artifactId) return jsonErr("Missing artifactId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400, { projectId });
    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400, { artifactId });

    const supabase = await createClient();
    await requireMember(supabase, projectId);

    const logoUrl =
      safeStr(process.env.NEXT_PUBLIC_ALIENA_LOGO_URL) ||
      "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png";

    if (format === "pdf") {
      const out = await exportStakeholderRegisterPdfBuffer({ supabase, projectId, artifactId, logoUrl });
      const pdf = toUint8((out as any)?.pdf ?? (out as any)?.bytes ?? (out as any)?.buffer);
      if (!pdf?.length) return jsonErr("PDF export returned empty output", 500);

      const baseName =
        safeStr((out as any)?.baseName).replace(/\.pdf$/i, "") ||
        baseNameFromMeta((out as any)?.meta, "Stakeholder-Register");

      return new NextResponse(pdf, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": contentDisposition(baseName, "pdf"),
          "Cache-Control": "no-store",
          Vary: "Cookie",
        },
      });
    }

    if (format === "xlsx") {
      const out = await exportStakeholderRegisterXlsxBuffer({ supabase, projectId, artifactId });
      const xlsx = toUint8((out as any)?.xlsx ?? (out as any)?.buffer ?? (out as any)?.bytes);
      if (!xlsx?.length) return jsonErr("XLSX export returned empty output", 500);

      const baseName =
        safeStr((out as any)?.baseName).replace(/\.xlsx$/i, "") ||
        baseNameFromMeta((out as any)?.meta, "Stakeholder_Register");

      return new NextResponse(xlsx, {
        status: 200,
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": contentDisposition(baseName, "xlsx"),
          "Cache-Control": "no-store",
          Vary: "Cookie",
        },
      });
    }

    // DOCX
    const out = await exportStakeholderRegisterDocxBuffer({ supabase, projectId, artifactId, logoUrl });
    const docx = toUint8((out as any)?.docx ?? (out as any)?.buffer ?? (out as any)?.bytes);
    if (!docx?.length) return jsonErr("DOCX export returned empty output", 500);

    const baseName =
      safeStr((out as any)?.baseName).replace(/\.docx$/i, "") ||
      baseNameFromMeta((out as any)?.meta, "Stakeholder_Register");

    return new NextResponse(docx, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": contentDisposition(baseName, "docx"),
        "Cache-Control": "no-store",
        Vary: "Cookie",
      },
    });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return jsonErr(e?.message || "Export failed", status, {
      code: e?.code,
      hint: e?.hint,
      details: e?.details,
    });
  }
}

/**
 * ✅ Next.js route params are NOT Promises.
 * Keep these types simple to avoid Turbopack weirdness.
 */
export async function GET(req: NextRequest, ctx: { params?: { format?: string } }) {
  return handle(req, safeStr(ctx?.params?.format));
}

export async function POST(req: NextRequest, ctx: { params?: { format?: string } }) {
  return handle(req, safeStr(ctx?.params?.format));
}