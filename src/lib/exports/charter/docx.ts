// src/lib/exports/charter/docx.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { exportCharterDocxBuffer, charterDocxFilename } from "./exportCharterDocxBuffer";
import { CharterExportMeta, formatUkDate, formatUkDateTime, safeJson, safeStr } from "./charterShared";

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

async function buildMeta(
  supabase: any,
  artifactId: string,
  projectId?: string | null,
  content_json?: any
): Promise<
  | { error: NextResponse }
  | {
      artifact: any;
      doc: any;
      meta: CharterExportMeta;
    }
> {
  const { data: artifact, error: aErr } = await supabase
    .from("artifacts")
    .select("id,title,content_json,project_id,projects:project_id(title, project_code, organisation_id, client_name)")
    .eq("id", artifactId)
    .single();

  if (aErr || !artifact) {
    return { error: jsonErr("Artifact not found", 404, { error: aErr?.message }) };
  }

  const doc = safeJson(content_json ?? (artifact as any).content_json);
  if (!doc) return { error: jsonErr("No content found", 400) };

  const effectiveProjectId =
    safeStr(projectId).trim() || safeStr((artifact as any).project_id).trim() || null;

  let projectRow: any = (artifact as any).projects ?? null;

  if (!projectRow && effectiveProjectId) {
    const { data: p } = await supabase
      .from("projects")
      .select("id,title,project_code,organisation_id,client_name")
      .eq("id", effectiveProjectId)
      .single();

    projectRow = p ?? null;
  }

  const projectCode = projectRow?.project_code
    ? `P-${String(projectRow.project_code).padStart(5, "0")}`
    : "—";

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

/**
 * REQUIRED EXPORT (registry expects this name)
 * Used by: /api/artifacts/[id]/export/docx (generic exporter route)
 */
export async function exportCharterDocx({
  req,
  artifactId,
  projectId,
  content_json,
}: {
  req: NextRequest;
  artifactId: string;
  projectId?: string | null;
  content_json?: any;
}) {
  try {
    const supabase = await createClient();
    const built = await buildMeta(supabase, artifactId, projectId, content_json);

    if ("error" in built) return built.error;

    const { doc, meta } = built;

    const buffer = await exportCharterDocxBuffer({ doc, meta });
    const filename = charterDocxFilename(meta);

    return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(buffer))), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[exportCharterDocx]", err);
    return jsonErr(err?.message || "Export failed", 500);
  }
}
