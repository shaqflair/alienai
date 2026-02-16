import "server-only";
import { createClient } from "@/utils/supabase/server";
import { isoNow, safeStr } from "./utils";

export type ExportMeta = {
  projectName: string;
  projectCode: string;
  organisationName?: string;
  clientName?: string;
  generated: string;
  logoUrl?: string;
  watermarkText?: string;
  projectProjectId?: string; // keep your field name to avoid breaking renderers
};

type SupabaseServerClient = ReturnType<typeof createClient> extends Promise<infer T> ? T : any;

export async function resolveExportMeta(opts: {
  supabase: SupabaseServerClient;
  projectId?: string | null;
  fallback?: Partial<ExportMeta>;
}): Promise<ExportMeta> {
  const { supabase, projectId, fallback } = opts;

  const fb: Partial<ExportMeta> = fallback || {};
  const pid = safeStr(projectId).trim();

  // Defaults
  let meta: ExportMeta = {
    projectName: safeStr(fb.projectName) || "Project",
    projectCode: safeStr(fb.projectCode) || "—",
    organisationName: safeStr(fb.organisationName) || "",
    clientName: safeStr(fb.clientName) || "",
    generated: safeStr(fb.generated) || isoNow(),
    logoUrl: safeStr(fb.logoUrl) || "",
    watermarkText: safeStr(fb.watermarkText) || "",
    projectProjectId: safeStr(fb.projectProjectId) || pid || "",
  };

  if (!pid) return meta;

  // Pull project details (adjust columns if your schema differs)
  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .select("id, title, project_code, organisation_name, client_name, logo_url, watermark_text")
    .eq("id", pid)
    .maybeSingle();

  if (projErr) {
    // Don’t hard fail meta: exports should still work
    return meta;
  }

  meta = {
    ...meta,
    projectName: safeStr(proj?.title) || meta.projectName,
    projectCode: safeStr((proj as any)?.project_code) || meta.projectCode,
    organisationName: safeStr((proj as any)?.organisation_name) || meta.organisationName,
    clientName: safeStr((proj as any)?.client_name) || meta.clientName,
    logoUrl: safeStr((proj as any)?.logo_url) || meta.logoUrl,
    watermarkText: safeStr((proj as any)?.watermark_text) || meta.watermarkText,
    projectProjectId: safeStr(proj?.id) || meta.projectProjectId,
  };

  return meta;
}
