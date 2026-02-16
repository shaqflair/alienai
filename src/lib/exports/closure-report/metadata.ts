import "server-only";

import { asBool, formatUkDateTime, getAny, pickFirstTruthy, safeObj, safeStr, toProjectCode } from "./utils";

export type ClosureReportMeta = {
  projectName: string;
  projectCode: string;
  organisationName: string;
  clientName: string;
  pmName: string;
  sponsorName: string;

  // ✅ add these
  ragStatus: string;
  overallHealth: string;

  status: "Final" | "Draft";
  generatedAt: string;

  // optional assets
  logoUrl?: string;
  watermarkText?: string;

  // optional (if you want)
  projectProjectId?: string;
};

function looksLikeUuid(s: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function normaliseRag(v: any): string {
  const s = safeStr(v).trim();
  if (!s) return "—";
  const t = s.toLowerCase();

  if (t.includes("green")) return "Green";
  if (t.includes("amber") || t.includes("yellow")) return "Amber";
  if (t.includes("red")) return "Red";

  if (t === "g") return "Green";
  if (t === "a" || t === "y") return "Amber";
  if (t === "r") return "Red";

  return s;
}

function normaliseOverall(v: any): string {
  const s = safeStr(v).trim();
  if (!s) return "—";
  const t = s.toLowerCase();

  if (t === "good") return "Good";
  if (t === "ok" || t === "okay") return "OK";
  if (t === "poor" || t === "bad") return "Poor";
  if (t === "at risk" || t === "atrisk") return "At Risk";

  return s;
}

export async function resolveClosureReportMeta(
  supabase: any,
  artifact: any,
  content: any
): Promise<ClosureReportMeta> {
  const c = content || {};

  // ---------------- content-first (editor JSON) ----------------

  // NOTE: your closure editor uses c.project.* (from your util keys)
  let projectName =
    safeStr(getAny(c, ["project.project_name", "project.name", "projectName"])) ||
    safeStr(artifact?.title) ||
    "Project";

  let projectCode =
    toProjectCode(getAny(c, ["project.project_code", "project.code", "projectCode"])) || "—";

  let pmName =
    safeStr(getAny(c, ["project.pm", "project.project_manager", "project.pm_name", "pmName"])) || "—";

  let sponsorName =
    safeStr(getAny(c, ["project.sponsor", "project.sponsor_name", "sponsorName"])) || "—";

  let clientName =
    safeStr(getAny(c, ["project.client_name", "project.client", "clientName"])) || "—";

  let orgName =
    safeStr(getAny(c, ["project.organisation_name", "project.org_name", "organisationName"])) || "—";

  // ✅ RAG + Overall from editor JSON
  // Your UI labels: "RAG Status" and "Overall Health"
  // Common key patterns: rag_status, ragStatus, overall_health, overallHealth
  let ragStatus =
    normaliseRag(
      getAny(c, [
        "project.rag_status",
        "project.ragStatus",
        "rag_status",
        "ragStatus",
        "rag",
      ])
    ) || "—";

  let overallHealth =
    normaliseOverall(
      getAny(c, [
        "project.overall_health",
        "project.overallHealth",
        "overall_health",
        "overallHealth",
        "overall",
      ])
    ) || "—";

  // Optional: allow passing logo/watermark in content or body
  const logoFromContent =
    safeStr(getAny(c, ["branding.logo_url", "branding.logoUrl", "logoUrl", "logo_url"])) || "";

  const watermarkTextRaw =
    safeStr(getAny(c, ["branding.watermark", "branding.watermarkText", "watermarkText"])) || "";

  let logoUrl: string | undefined = logoFromContent.trim() ? logoFromContent.trim() : undefined;
  let watermarkText: string | undefined = watermarkTextRaw.trim() ? watermarkTextRaw.trim() : undefined;

  // ---------------- project/org enrichment (DB) ----------------

  const projectId = safeStr(artifact?.project_id).trim();
  if (projectId && looksLikeUuid(projectId)) {
    const { data: project, error: projErr } = await supabase
      .from("projects")
      .select(
        [
          "id",
          "title",
          "project_code",
          "project_code_human",
          "client_name",
          "organisation_id",
          "organisation_name",
          "org_name",
          "logo_url",
          "brand_logo_url",
          "project_manager",
          "project_manager_name",
          "project_manager_full_name",
          "pm_name",
          "pm",
          "manager_name",
          "sponsor",
          "sponsor_name",
          "project_sponsor",
          "project_sponsor_name",
          "business_sponsor",
          "business_sponsor_name",

          // ✅ if you have these columns on projects table, great; if not, harmless
          "rag_status",
          "overall_health",
        ].join(",")
      )
      .eq("id", projectId)
      .maybeSingle();

    if (!projErr && project) {
      projectName = safeStr(project.title) || projectName;

      // Prefer human code if present
      const codeHuman = safeStr(project.project_code_human).trim();
      const codeRaw = safeStr(project.project_code).trim();
      projectCode = toProjectCode(codeHuman || codeRaw) || projectCode;

      clientName = safeStr(project.client_name) || clientName;

      // If org name exists on project row, use it (avoid extra org query)
      orgName = safeStr(project.organisation_name) || safeStr(project.org_name) || orgName;

      // Resolve logo from project if not provided in content
      if (!logoUrl) {
        const brand = safeStr(project.brand_logo_url).trim();
        const plain = safeStr(project.logo_url).trim();
        const best = brand || plain;
        if (best) logoUrl = best;
      }

      if (pmName === "—" || !pmName.trim()) {
        pmName =
          safeStr(
            pickFirstTruthy(project, [
              "project_manager",
              "project_manager_name",
              "project_manager_full_name",
              "pm_name",
              "pm",
              "manager_name",
            ])
          ) || pmName;
      }

      if (sponsorName === "—" || !sponsorName.trim()) {
        sponsorName =
          safeStr(
            pickFirstTruthy(project, [
              "sponsor",
              "sponsor_name",
              "project_sponsor",
              "project_sponsor_name",
              "business_sponsor",
              "business_sponsor_name",
            ])
          ) || sponsorName;
      }

      // ✅ only override rag/overall if still missing
      if (ragStatus === "—" || !ragStatus.trim()) {
        ragStatus = normaliseRag((project as any)?.rag_status) || ragStatus;
      }
      if (overallHealth === "—" || !overallHealth.trim()) {
        overallHealth = normaliseOverall((project as any)?.overall_health) || overallHealth;
      }

      // Only hit organisations table if still missing org name
      const orgId = safeStr(project.organisation_id).trim();
      if ((orgName === "—" || !orgName.trim()) && orgId && looksLikeUuid(orgId)) {
        const { data: org } = await supabase.from("organisations").select("name").eq("id", orgId).maybeSingle();
        if (org?.name) orgName = safeStr(org.name) || orgName;
      }
    }
  }

  // ---------------- signoff status ----------------

  const signoff = safeObj(getAny(c, ["signoff", "approval", "approvals"])) || {};
  const sponsorDecision = safeStr(signoff?.sponsor_decision).toLowerCase();
  const isApproved =
    asBool(signoff?.sponsor_signed) || sponsorDecision.includes("approve") || sponsorDecision.includes("approved");

  return {
    projectName,
    projectCode,
    organisationName: orgName,
    clientName,
    pmName,
    sponsorName,

    ragStatus,
    overallHealth,

    status: isApproved ? "Final" : "Draft",
    generatedAt: formatUkDateTime(new Date()),
    logoUrl,
    watermarkText,
    projectProjectId: projectId || undefined,
  };
}
