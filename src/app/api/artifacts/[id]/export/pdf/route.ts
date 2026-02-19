import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { exportCharterPdfBuffer, charterPdfFilename } from "@/lib/exports/charter/charterPdf";
import type { CharterExportMeta } from "@/lib/exports/charter/charterShared";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonErr(message: string, status = 400, details?: any) {
  return noStore(NextResponse.json({ ok: false, error: message, details }, { status }));
}

function fmtUkDateTimeNow() {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString();
  }
}

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const artifactId = safeStr(ctx?.params?.id);
  if (!artifactId) return jsonErr("Missing artifact id", 400);

  const supabase = await createClient();

  // 1) Load artifact
  const { data: artifact, error: aErr } = await supabase
    .from("artifacts")
    .select("id, project_id, title, type, doc")
    .eq("id", artifactId)
    .single();

  if (aErr || !artifact) return jsonErr("Artifact not found", 404, aErr?.message);

  // If you want to restrict this route to charters only:
  // if (safeStr(artifact.type) !== "project_charter" && safeStr(artifact.type) !== "charter") {
  //   return jsonErr("This export endpoint currently supports Project Charter only.", 400, { type: artifact.type });
  // }

  const projectId = safeStr(artifact.project_id);
  if (!projectId) return jsonErr("Artifact is missing project_id", 400);

  // 2) Load project + org context (minimal fields; adjust if your schema differs)
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, title, project_code, client_name, organisation_id")
    .eq("id", projectId)
    .single();

  if (pErr || !project) return jsonErr("Project not found for artifact", 404, pErr?.message);

  const orgId = safeStr((project as any).organisation_id);
  let organisationName = "—";

  if (orgId) {
    const { data: org } = await supabase.from("organisations").select("id, name").eq("id", orgId).single();
    organisationName = safeStr((org as any)?.name) || "—";
  }

  // 3) Build meta
  const meta: CharterExportMeta = {
    organisationName,
    clientName: safeStr((project as any).client_name) || "—",
    projectName: safeStr((project as any).title) || safeStr(artifact.title) || "—",
    projectCode: safeStr((project as any).project_code) || "—",
    pmName: "—", // Optional: wire from your stakeholders/users if you store PM somewhere
    generated: fmtUkDateTimeNow(),
  };

  // 4) Render PDF
  const doc = (artifact as any).doc ?? {};
  const pdfBuffer = await exportCharterPdfBuffer({ doc, meta });

  const filename = charterPdfFilename(meta);

  const res = new NextResponse(new Uint8Array(pdfBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });

  return res;
}
