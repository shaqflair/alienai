import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/* ---------------- helpers ---------------- */

function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function normalizeType(t: string) {
  return safeStr(t).trim().toLowerCase().replace(/_/g, "-");
}

function normalizeFormat(fmt: string) {
  const f = safeStr(fmt).trim().toLowerCase();
  if (f === "word") return "docx";
  if (f === "excel") return "xlsx";
  return f;
}

async function tryReadJsonBody(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) return null;
    return await req.json();
  } catch {
    return null;
  }
}

/* ---------------- dispatch ---------------- */

function isCharterType(t: string) {
  return (
    t === "charter" ||
    t === "project-charter" ||
    t === "projectcharter" ||
    t === "project-charter-v2" ||
    t === "project-charter-v1"
  );
}

function isRaidType(t: string) {
  return (
    t === "raid" ||
    t === "raid-log" ||
    t === "raidlog" ||
    t === "raid-register" ||
    t === "risk-log" ||
    t === "risks-issues-assumptions-dependencies"
  );
}

async function dispatchExport(args: {
  req: NextRequest;
  artifactId: string;
  fmt: "pdf" | "docx" | "xlsx";
  typeNorm: string;
  projectId: string | null;
  content_json: any;
}) {
  const { req, artifactId, fmt, typeNorm, projectId, content_json } = args;

  /* =========================
     Dispatch: Project Charter
     ========================= */
  if (isCharterType(typeNorm)) {
    if (fmt === "pdf") {
      // ✅ Standard barrel import
      const mod: any = await import("@/lib/exports/charter");
      if (typeof mod.exportCharterPdf !== "function") {
        return jsonErr("Charter exporter missing: exportCharterPdf", 500);
      }
      return await mod.exportCharterPdf({ req, artifactId, projectId, content_json });
    }

    if (fmt === "docx") {
      // ✅ Standard barrel import
      const mod: any = await import("@/lib/exports/charter");
      if (typeof mod.exportCharterDocx !== "function") {
        return jsonErr("Charter exporter missing: exportCharterDocx", 500);
      }
      return await mod.exportCharterDocx({ req, artifactId, projectId, content_json });
    }

    return jsonErr(`Unsupported format for charter: ${fmt}`, 400);
  }

  /* =========================
     Dispatch: RAID (PDF + XLSX)
     ========================= */
  if (isRaidType(typeNorm)) {
    const mod: any = await import("@/lib/exports/raid");

    if (fmt === "pdf") {
      if (typeof mod.exportRaidPdf !== "function") {
        return jsonErr("RAID exporter missing: exportRaidPdf", 500);
      }
      return await mod.exportRaidPdf({
        req,
        artifactId,
        projectId,
        content_json, // kept for contract consistency (even if exporter ignores)
      });
    }

    if (fmt === "xlsx") {
      if (typeof mod.exportRaidXlsx !== "function") {
        return jsonErr("RAID exporter missing: exportRaidXlsx", 500);
      }
      return await mod.exportRaidXlsx({
        req,
        artifactId,
        projectId,
        content_json, // ignored by RAID XLSX exporter, but kept consistent
      });
    }

    return jsonErr(`Unsupported format for RAID: ${fmt}`, 400);
  }

  return jsonErr("No exporter registered for type", 400, { normalized: typeNorm });
}

/* ---------------- main ---------------- */

async function handle(req: NextRequest, ctx: { params: Promise<{ id?: string; format?: string }> }) {
  try {
    const { id, format } = await ctx.params;

    const artifactId = safeStr(id).trim();
    const fmt = normalizeFormat(format ?? "");

    if (!looksLikeUuid(artifactId)) return jsonErr("Invalid artifact id", 400);
    if (!fmt) return jsonErr("Missing format", 400);

    // ✅ Supported formats
    if (fmt !== "pdf" && fmt !== "docx" && fmt !== "xlsx") {
      return jsonErr(`Unsupported export format: ${fmt}`, 400);
    }

    const supabase = await createClient();

    // ✅ Optional POST body override
    const body = await tryReadJsonBody(req);
    const bodyProjectId = safeStr(body?.projectId).trim() || null;
    const bodyContentJson = body?.content_json ?? body?.contentJson ?? body?.content ?? null;

    // RLS enforces access; we only need type for dispatch
    const { data: artifact, error } = await supabase
      .from("artifacts")
      .select("id,type,artifact_type")
      .eq("id", artifactId)
      .single();

    if (error || !artifact) return jsonErr("Artifact not found", 404, { error: error?.message });

    const typeNorm = normalizeType(artifact.artifact_type || artifact.type);

    return await dispatchExport({
      req,
      artifactId,
      fmt: fmt as "pdf" | "docx" | "xlsx",
      typeNorm,
      projectId: bodyProjectId,
      content_json: bodyContentJson,
    });
  } catch (e: any) {
    return jsonErr("Export failed", 500, { message: safeStr(e?.message) });
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id?: string; format?: string }> }) {
  // GET kept for backward compatibility. Prefer POST so UI can send overrides.
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id?: string; format?: string }> }) {
  return handle(req, ctx);
}
