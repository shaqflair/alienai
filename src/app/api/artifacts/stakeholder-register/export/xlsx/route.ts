import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// ✅ IMPORTANT: import concrete module directly (avoid Webpack “bad export shape”)
import exportStakeholderRegisterXlsxBuffer from "@/lib/exports/stakeholder-register/exportStakeholderRegisterXlsxBuffer";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */

function jsonErr(message: string, status = 400, details?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
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

async function getIds(req: NextRequest) {
  const url = new URL(req.url);
  const isGet = req.method === "GET";
  const body = isGet ? null : await req.json().catch(() => ({}));

  const projectId = cleanId(isGet ? url.searchParams.get("projectId") : (body as any)?.projectId);
  const artifactId = cleanId(isGet ? url.searchParams.get("artifactId") : (body as any)?.artifactId);

  return { projectId, artifactId };
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

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}

function excelBaseName(meta: any) {
  const code = safeStr(meta?.projectCode || meta?.project_code);
  const title = safeStr(meta?.projectName || meta?.projectTitle || meta?.project_title);
  const base = "Stakeholder_Register";
  const suffix = [code || null, title || null].filter(Boolean).join("_");
  const safe = safeFilename(suffix ? `${base}_${suffix}` : base);
  return `${safe}_${isoDate()}`;
}

/**
 * Membership check
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

/* ---------------- main ---------------- */

async function handle(req: NextRequest) {
  try {
    const { projectId, artifactId } = await getIds(req);

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!artifactId) return jsonErr("Missing artifactId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400, { projectId });
    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400, { artifactId });

    const supabase = await createClient();
    await requireMember(supabase, projectId);

    const out = await exportStakeholderRegisterXlsxBuffer({ supabase, projectId, artifactId });

    const xlsx = (out as any)?.xlsx ?? (out as any)?.buffer ?? (out as any)?.bytes;
    if (!xlsx) return jsonErr("XLSX export returned empty output", 500);

    const baseName =
      safeStr((out as any)?.baseName).replace(/\.xlsx$/i, "") || excelBaseName((out as any)?.meta);

    return new NextResponse(xlsx as any, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": contentDisposition(baseName, "xlsx"),
        "Cache-Control": "no-store",
        Vary: "Cookie",
      },
    });
  } catch (e: any) {
    const status = Number(e?.status) || 500;
    return jsonErr(e?.message || "Failed to export Excel", status, {
      code: e?.code,
      hint: e?.hint,
      details: e?.details,
    });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

