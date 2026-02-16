import "server-only";
import { createClient } from "@/utils/supabase/server";
import { normalizeHex } from "./theme";
import { safeStr } from "./format";

/**
 * Shared Metadata Type for Exports
 */
export type ExportMeta = {
  organisationName: string;
  projectTitle: string;
  projectCode: string;
  clientName: string;
  clientLogoUrl: string;
  brandPrimary: string; // hex
};

/**
 * Fetches and sanitizes project/org metadata for report headers and branding.
 * Handles relational joins for organization names and ensures color codes are valid.
 */
export async function getExportMeta(projectId: string): Promise<ExportMeta> {
  const sb = await createClient();

  const { data, error } = await sb
    .from("projects")
    .select(`
      id,
      title,
      project_code,
      client_name,
      client_logo_url,
      brand_primary_color,
      organisation_id,
      organisations(name)
    `)
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Project not found");

  const orgName = safeStr((data as any)?.organisations?.name) || "Organisation";
  const projectTitle = safeStr(data.title) || "Project";
  const projectCode = safeStr((data as any).project_code) || safeStr(data.id).slice(0, 6);
  const clientName = safeStr((data as any).client_name);
  const clientLogoUrl = safeStr((data as any).client_logo_url);
  const brandPrimary = normalizeHex(safeStr((data as any).brand_primary_color));

  return {
    organisationName: orgName,
    projectTitle,
    projectCode,
    clientName,
    clientLogoUrl,
    brandPrimary,
  };
}
