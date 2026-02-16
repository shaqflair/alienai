// src/app/api/artifacts/charter/export/docx/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { exportCharterDocxBuffer, charterDocxFilename } from "@/lib/exports/charter/exportCharterDocxBuffer";
import { CharterExportMeta, formatUkDate, formatUkDateTime, safeJson, safeStr } from "@/lib/exports/charter/charterShared";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

async function safeReadJsonBody(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) return null;
    const text = await req.text();
    if (!text || !text.trim()) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function buildMeta(supabase: any, artifactId: string, projectId?: string | null, content_json?: any) {
  const { data: artifact, error: aErr } = await supabase
    .from("artifacts")
    .select("id,title,content_json,project_id,projects:project_id(title, project_code, organisation_id, client_name)")
    .eq("id", artifactId)
    .single();

  if (aErr || !artifact) return { error: jsonErr("Artifact not found", 404, { error: aErr?.message }) as any };

  const doc = safeJson(content_json ?? (artifact as any).content_json);
  if (!doc) return { error: jsonErr("No content found", 400) as any };

  const effectiveProjectId = safeStr(projectId).trim() || safeStr((artifact as any).project_id).trim() || null;

  let projectRow: any = (artifact as any).projects ?? null;
  if (!projectRow && effectiveProjectId) {
    const { data: p } = await supabase
      .from("projects")
      .select("id,title,project_code,organisation_id,client_name")
      .eq("id", effectiveProjectId)
      .single();
    projectRow = p ?? null;
  }

  const projectCode = projectRow?.project_code ? `P-${String(projectRow.project_code).padStart(5, "0")}` : "—";

  let orgName = "—";
  const orgId = projectRow?.organisation_id;
  if (orgId) {
    const { data: org } = await supabase.from("organisations").select("name").eq("id", orgId).single();
    orgName = org?.name || "—";
  }

  const meta: CharterExportMeta = {
    projectName: (artifact as any).title || projectRow?.title || "Project",
    projectCode,
    organisationName: orgName,
    clientName: projectRow?.client_name || "—",
    pmName: doc?.meta?.pm_name || "—",
    status: doc?.meta?.status || "Draft",
    generated: formatUkDateTime(),
    generatedDate: formatUkDate(),
    generatedDateTime: formatUkDateTime().replace(" ", ", "),
  };

  return { artifact, doc, meta };
}

async function handle(req: NextRequest) {
  const url = new URL(req.url);

  // Query params (GET style)
  const qArtifactId = safeStr(url.searchParams.get("artifactId") || url.searchParams.get("artifact_id")).trim();
  const qProjectId = safeStr(url.searchParams.get("projectId") || url.searchParams.get("project_id")).trim() || null;

  // Body (POST style)
  const body = req.method === "POST" ? await safeReadJsonBody(req) : null;
  const bArtifactId = safeStr(body?.artifactId || body?.artifact_id).trim();
  const bProjectId = safeStr(body?.projectId || body?.project_id).trim() || null;
  const bContentJson = body?.content_json ?? null;

  const artifactId = bArtifactId || qArtifactId;
  const projectId = bProjectId || qProjectId;

  if (!artifactId) return jsonErr("Missing artifactId", 400);

  try {
    const supabase = await createClient();

    // If content_json supplied, prefer it (fresh in-memory doc)
    const built = await buildMeta(supabase, artifactId, projectId, bContentJson);

    if ((built as any).error) return (built as any).error;

    const { doc, meta } = built as any;

    const buffer = await exportCharterDocxBuffer({ doc, meta });
    const filename = charterDocxFilename(meta);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[Charter DOCX route]", err);
    return jsonErr(err?.message || "Export failed", 500);
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
