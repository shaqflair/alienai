import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { exportCharterPdfBuffer, charterPdfFilename } from "./exportCharterPdfBuffer";
import {
  type CharterExportMeta,
  formatUkDate,
  formatUkDateTime,
  safeJson,
  safeStr,
} from "./charterShared";

/* ---------------- helpers ---------------- */

function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
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

async function buildMetaAndDoc(args: {
  supabase: any;
  artifactId: string;
  projectId?: string | null;
  content_json?: any;
}) {
  const { supabase, artifactId, projectId, content_json } = args;

  const { data: artifact, error: aErr } = await supabase
    .from("artifacts")
    .select("id,title,content_json,project_id,projects:project_id(title, project_code, organisation_id, client_name)")
    .eq("id", artifactId)
    .single();

  if (aErr || !artifact) {
    return { error: jsonErr("Artifact not found", 404, { message: aErr?.message }) as any };
  }

  const doc = safeJson(content_json ?? (artifact as any).content_json);
  if (!doc) return { error: jsonErr("No content found", 400) as any };

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
    pmName: doc?.meta?.pm_name || doc?.meta?.project_manager || "—",
    status: doc?.meta?.status || "Draft",
    generated: formatUkDateTime(),
    generatedDate: formatUkDate(),
    generatedDateTime: `${formatUkDate()} ${formatUkDateTime().split(" ")[1] ?? ""}`.trim(),
  };

  return { doc, meta };
}

/* ---------------- exporter (DISPATCHER SIGNATURE) ---------------- */

export async function exportCharterPdf(args: {
  req: NextRequest;
  artifactId: string;
  projectId: string | null;
  content_json: any;
}) {
  const { req, artifactId, projectId, content_json } = args;

  try {
    const supabase = await createClient();

    // allow POST body to override too (freshest)
    const body = await tryReadJsonBody(req);
    const bodyProjectId = safeStr(body?.projectId).trim() || null;
    const bodyContentJson = body?.content_json ?? null;

    const built = await buildMetaAndDoc({
      supabase,
      artifactId,
      projectId: bodyProjectId || projectId,
      content_json: bodyContentJson ?? content_json,
    });

    if ((built as any).error) return (built as any).error;

    const { doc, meta } = built as any;

    const pdfBuffer = await exportCharterPdfBuffer({ doc, meta });
    const filename = charterPdfFilename(meta);

    return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(pdfBuffer))), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[exportCharterPdf]", e);
    return jsonErr("Export failed", 500, { message: safeStr(e?.message) });
  }
}
