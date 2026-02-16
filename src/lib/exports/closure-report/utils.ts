// src/lib/exports/closure-report/utils.ts
import "server-only";

/* ---------------- safe primitives ---------------- */

export function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function sanitizeFilename(name: string): string {
  return String(name || "file")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

export function formatUkDateLong(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

export function formatUkDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (!d || Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ---------------- coercion helpers ---------------- */

export function asBool(v: any): boolean {
  if (v === true) return true;
  if (v === false) return false;
  const s = safeStr(v).trim().toLowerCase();
  if (!s) return false;
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "on";
}

export function safeObj(v: any): any {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

/* ---------------- tolerant deep getter ---------------- */

/**
 * getAny(obj, ["a.b.c", "x.y", "z"]) -> first non-empty value
 * Supports arrays in path like "items.0.title"
 */
export function getAny(obj: any, paths: string[]): any {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (v == null) continue;
    if (typeof v === "string") {
      if (v.trim()) return v;
      continue;
    }
    return v;
  }
  return null;
}

function getPath(obj: any, path: string): any {
  if (!obj || !path) return null;
  const parts = String(path).split(".").filter(Boolean);
  let cur: any = obj;
  for (const part of parts) {
    if (cur == null) return null;
    const idx = /^\d+$/.test(part) ? Number(part) : null;
    cur = idx != null ? cur?.[idx] : cur?.[part];
  }
  return cur;
}

/* ---------------- parsing ---------------- */

/**
 * Tolerant parser:
 * - accepts object
 * - accepts JSON string
 * - accepts {content_json: ...}
 * - returns {} for empty/invalid
 */
export function parseAnyObject(raw: any): any {
  try {
    const v = raw?.content_json ?? raw;

    if (v == null) return {};
    if (typeof v === "object") return v;

    if (typeof v === "string") {
      const s = v.trim();
      if (!s || s === "null" || s === "undefined") return {};
      const parsed = JSON.parse(s);
      return parsed && typeof parsed === "object" ? parsed : {};
    }

    return {};
  } catch {
    return {};
  }
}

/* ---------------- project formatting ---------------- */

export function toProjectCode(code: any): string {
  const raw = safeStr(code).trim();
  if (!raw) return "—";

  // P-123 -> P-00123
  if (/^p-\d+$/i.test(raw)) {
    const n = raw.split("-")[1];
    return `P-${String(n).padStart(5, "0")}`;
  }

  // 123 -> P-00123
  const num = Number(raw);
  if (Number.isFinite(num) && num > 0) return `P-${String(Math.trunc(num)).padStart(5, "0")}`;

  return raw;
}

export function pickFirstTruthy(obj: any, keys: string[]): string {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

/* ---------------- remote image fetch ---------------- */

export async function fetchImageBuffer(url: string): Promise<Buffer | null> {
  const u = safeStr(url).trim();
  if (!u || !/^https?:\/\//i.test(u)) return null;

  const res = await fetch(u);
  if (!res.ok) return null;

  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);

  // hard cap to avoid massive files
  if (buf.length > 2_500_000) return null;

  return buf;
}

/* ---------------- html escape ---------------- */

export function escapeHtml(str: any): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/* =========================
   Closure meta resolver
   (embedded here to avoid path issues)
========================= */

export type ClosureReportMeta = {
  projectName: string;
  projectCode: string;
  organisationName: string;
  clientName: string;
  pmName: string;
  sponsorName: string;

  ragStatus: string;
  overallHealth: string;

  status: "Final" | "Draft";
  generatedAt: string;

  logoUrl?: string;
  watermarkText?: string;

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

  // Support BOTH: legacy `project.*` and current `projectSummary.*` / `project_summary.*`

  let projectName =
    safeStr(
      getAny(c, [
        "projectSummary.project_name",
        "projectSummary.projectName",
        "project_summary.project_name",
        "project_summary.projectName",
        "project.project_name",
        "project.name",
        "projectName",
      ])
    ) ||
    safeStr(artifact?.title) ||
    "Project";

  let projectCode =
    toProjectCode(
      getAny(c, [
        "projectSummary.project_code_id",
        "projectSummary.projectCodeId",
        "projectSummary.project_code",
        "projectSummary.projectCode",
        "project_summary.project_code_id",
        "project_summary.projectCodeId",
        "project_summary.project_code",
        "project_summary.projectCode",
        "project.project_code",
        "project.code",
        "projectCode",
      ])
    ) || "—";

  let pmName =
    safeStr(
      getAny(c, [
        "projectSummary.pm_name",
        "projectSummary.pmName",
        "project_summary.pm_name",
        "project_summary.pmName",
        "project.pm",
        "project.project_manager",
        "project.pm_name",
        "pmName",
      ])
    ) || "—";

  let sponsorName =
    safeStr(
      getAny(c, [
        "projectSummary.sponsor_name",
        "projectSummary.sponsorName",
        "project_summary.sponsor_name",
        "project_summary.sponsorName",
        "project.sponsor",
        "project.sponsor_name",
        "sponsorName",
      ])
    ) || "—";

  let clientName =
    safeStr(
      getAny(c, [
        "projectSummary.client_business",
        "projectSummary.clientBusiness",
        "project_summary.client_business",
        "project_summary.clientBusiness",
        "projectSummary.client_name",
        "project_summary.client_name",
        "projectSummary.client",
        "project_summary.client",
        "project.client_name",
        "project.client",
        "clientName",
      ])
    ) || "—";

  let orgName =
    safeStr(
      getAny(c, [
        "projectSummary.organisation_name",
        "projectSummary.organisationName",
        "project_summary.organisation_name",
        "project_summary.organisationName",
        "projectSummary.org_name",
        "projectSummary.orgName",
        "project_summary.org_name",
        "project_summary.orgName",
        "project.organisation_name",
        "project.org_name",
        "organisationName",
      ])
    ) || "—";

  let ragStatus =
    normaliseRag(
      getAny(c, [
        "projectSummary.rag_status",
        "projectSummary.ragStatus",
        "project_summary.rag_status",
        "project_summary.ragStatus",
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
        "projectSummary.overall_health",
        "projectSummary.overallHealth",
        "project_summary.overall_health",
        "project_summary.overallHealth",
        "project.overall_health",
        "project.overallHealth",
        "overall_health",
        "overallHealth",
        "overall",
      ])
    ) || "—";

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
          "rag_status",
          "overall_health",
        ].join(",")
      )
      .eq("id", projectId)
      .maybeSingle();

    if (!projErr && project) {
      projectName = safeStr(project.title) || projectName;

      const codeHuman = safeStr(project.project_code_human).trim();
      const codeRaw = safeStr(project.project_code).trim();
      projectCode = toProjectCode(codeHuman || codeRaw) || projectCode;

      clientName = safeStr(project.client_name) || clientName;

      orgName = safeStr(project.organisation_name) || safeStr(project.org_name) || orgName;

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

      if (ragStatus === "—" || !ragStatus.trim()) {
        ragStatus = normaliseRag((project as any)?.rag_status) || ragStatus;
      }
      if (overallHealth === "—" || !overallHealth.trim()) {
        overallHealth = normaliseOverall((project as any)?.overall_health) || overallHealth;
      }

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
