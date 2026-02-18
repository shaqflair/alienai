// src/app/api/artifacts/closure-report/export/docx/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { exportClosureReportDocxBuffer } from "@/lib/exports/closure-report/exportClosureReportDocxBuffer";
import { sanitizeFilename, toProjectCode, safeStr as safeStrUtil } from "@/lib/exports/closure-report/utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ---------------- helpers ---------------- */

function jsonErr(error: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error, details }, { status });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function nowUkStamp() {
  try {
    const d = new Date();
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(d);

    const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
    return `${get("day")}/${get("month")}/${get("year")}, ${get("hour")}:${get("minute")}`;
  } catch {
    return new Date().toISOString();
  }
}

function yyyymmdd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/* ---------------- handler ---------------- */

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const body = await req.json().catch(() => ({}));

    const artifactId = safeStr(body?.artifact_id || body?.artifactId).trim();
    const filenameBase = safeStr(body?.filenameBase || body?.filename_base).trim() || "";
    const contentOverride = body?.content_json ?? null;

    if (!artifactId) return jsonErr("Missing artifact_id", 400);
    if (!looksLikeUuid(artifactId)) return jsonErr("Invalid artifact_id", 400, { artifactId });

    // Pull only columns that exist in your artifacts table
    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, title, type, content, content_json, updated_at")
      .eq("id", artifactId)
      .maybeSingle();

    if (artErr) return jsonErr("Failed to load artifact", 500, { message: artErr.message });
    if (!art) return jsonErr("Artifact not found", 404);

    // Model preference:
    // 1) content_override from editor
    // 2) artifacts.content_json
    // 3) JSON.parse(artifacts.content) if it is JSON
    // 4) fallback to {}
    let model: any = contentOverride ?? (art as any)?.content_json ?? null;

    if (!model) {
      const raw = safeStr((art as any)?.content);
      if (raw) {
        try {
          model = JSON.parse(raw);
        } catch {
          model = {};
        }
      } else {
        model = {};
      }
    }

    // Resolve meta fields from model (ClosureDocV1 editor) + DB
    const projectName =
      safeStr(model?.project?.project_name).trim() ||
      safeStr(model?.meta?.projectName).trim() ||
      safeStr(model?.meta?.title).trim() ||
      safeStr((art as any)?.title).trim() ||
      "Project";

    const projectCodeRaw =
      safeStr(model?.project?.project_code).trim() ||
      safeStr(model?.meta?.projectCode).trim() ||
      safeStr(model?.meta?.project_id).trim() ||
      "";

    const projectCode = toProjectCode(projectCodeRaw);

    // Client name: prefer editor doc; fallback to projects table
    let clientName =
      safeStr(model?.project?.client_name).trim() || safeStr(model?.meta?.clientName).trim() || "";

    // Organisation: pull from projects.organisation_id -> organisations.name
    let organisationName =
      safeStr(model?.meta?.organisationName).trim() ||
      safeStr(model?.meta?.orgName).trim() ||
      safeStr(body?.organisation_name || body?.org_name || body?.orgName).trim() ||
      "";

    if ((!organisationName || !clientName) && (art as any)?.project_id) {
      const pid = String((art as any).project_id);

      // join via foreign key projects_organisation_id_fkey
      const { data: proj } = await supabase
        .from("projects")
        .select("id, client_name, project_code, organisation:organisations(name)")
        .eq("id", pid)
        .maybeSingle();

      if (!clientName) clientName = safeStr((proj as any)?.client_name).trim() || clientName;

      // If project_code exists on projects and editor doc is empty, use it
      const dbCode = safeStr((proj as any)?.project_code).trim();
      if ((!projectCodeRaw || projectCodeRaw === "—") && dbCode) {
        // toProjectCode will re-normalise
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const _pc = dbCode;
      }

      if (!organisationName) {
        organisationName = safeStr((proj as any)?.organisation?.name).trim() || organisationName;
      }
    }

    const enrichedModel = {
      ...model,
      meta: {
        ...(model?.meta || {}),
        projectName,
        projectCode: projectCodeRaw || projectCode,
        clientName: clientName || "—",
        organisationName: organisationName || "—",
        generatedDateTimeUk: nowUkStamp(),
      },
    };

    const bytes = await exportClosureReportDocxBuffer(enrichedModel);

    if (!bytes || bytes.length < 200) {
      return jsonErr("DOCX buffer too small (likely empty/invalid)", 500, {
        byteLength: bytes?.length ?? 0,
      });
    }

    const base =
      filenameBase ||
      (projectCode && projectCode !== "—"
        ? `Project Closure Report - ${projectCode} - ${projectName}`
        : `Project Closure Report - ${projectName}`);

    const filename = `${sanitizeFilename(base)} - ${yyyymmdd(new Date())}.docx`;

    return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(bytes))), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[CLOSURE_DOCX_EXPORT_ERROR]:", e);
    return jsonErr("DOCX export failed", 500, { message: e?.message || String(e) });
  }
}
