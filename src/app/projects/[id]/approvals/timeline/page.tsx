import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ApprovalTimeline from "@/components/approvals/ApprovalTimeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

function isInvalidInputSyntaxError(err: any) {
  return String(err?.code || "").trim() === "22P02";
}

function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();

  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];

  return v;
}

function extractDigitsAsNumber(input: string): number | null {
  const s = normalizeProjectIdentifier(input);
  const m = String(s).match(/^\d+$/);
  if (!m) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function toProjectCodeLabel(projectCode: unknown): string {
  const raw = safeStr(projectCode).trim();
  if (!raw) return "";
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return `P-${String(Math.floor(n)).padStart(5, "0")}`;
  }
  return raw;
}

async function resolveProject(
  supabase: any,
  identifier: string
): Promise<{
  projectUuid: string | null;
  project: any | null;
  projectHumanId: string;
}> {
  const raw = safeStr(identifier).trim();
  if (!raw || raw === "undefined" || raw === "null") {
    return { projectUuid: null, project: null, projectHumanId: "" };
  }

  if (looksLikeUuid(raw)) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,title,project_code,client_name,organisation_id,finish_date")
      .eq("id", raw)
      .maybeSingle();

    if (!error && data?.id) {
      const human = toProjectCodeLabel(data.project_code) || raw;
      return { projectUuid: String(data.id), project: data, projectHumanId: human };
    }

    return { projectUuid: raw, project: null, projectHumanId: raw };
  }

  const codeNum = extractDigitsAsNumber(raw);
  if (codeNum != null) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,title,project_code,client_name,organisation_id,finish_date")
      .eq("project_code", codeNum)
      .maybeSingle();

    if (error) {
      if (isInvalidInputSyntaxError(error)) {
        return { projectUuid: null, project: null, projectHumanId: "" };
      }
      throw error;
    }

    if (data?.id) {
      const human = toProjectCodeLabel(data.project_code) || normalizeProjectIdentifier(raw);
      return { projectUuid: String(data.id), project: data, projectHumanId: human };
    }
  }

  const fallbacks = ["slug", "reference", "ref", "code", "human_id"] as const;

  for (const col of fallbacks) {
    const { data, error } = await supabase
      .from("projects")
      .select("id,title,project_code,client_name,organisation_id,finish_date")
      .eq(col, raw)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      if (isInvalidInputSyntaxError(error)) continue;
      throw error;
    }

    if (data?.id) {
      const human = toProjectCodeLabel(data.project_code) || normalizeProjectIdentifier(raw);
      return { projectUuid: String(data.id), project: data, projectHumanId: human };
    }
  }

  return { projectUuid: null, project: null, projectHumanId: "" };
}

async function loadProjectTitle(supabase: any, projectUuid: string) {
  const { data } = await supabase
    .from("projects")
    .select("id,title,project_code")
    .eq("id", projectUuid)
    .maybeSingle();

  return data ?? null;
}

export default async function ApprovalTimelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string }>;
  searchParams?: Promise<{ artifactId?: string; changeId?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr) throw authErr;
  if (!user) redirect("/login");

  const p = await params;
  const sp = searchParams ? await searchParams : {};

  const routeId = safeStr(p?.id).trim();
  if (!routeId) notFound();

  const resolved = await resolveProject(supabase, routeId);
  if (!resolved?.projectUuid) notFound();

  const projectUuid = safeStr(resolved.projectUuid).trim();
  if (!projectUuid) notFound();

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectUuid)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) notFound();

  const artifactId = safeStr(sp?.artifactId).trim() || null;
  const changeId = safeStr(sp?.changeId).trim() || null;

  const project = resolved.project ?? (await loadProjectTitle(supabase, projectUuid));
  const projectCodeLabel =
    toProjectCodeLabel((project as any)?.project_code) ||
    safeStr(resolved.projectHumanId).trim();

  const projectHeadingLabel =
    projectCodeLabel ||
    safeStr((project as any)?.title ?? projectUuid).trim();

  const pageTitle = artifactId
    ? "Artifact Approval Timeline"
    : changeId
      ? "Change Request Approval Timeline"
      : "Approvals Timeline";

  const pageSubtitle = artifactId
    ? "Review approval activity for this artifact."
    : changeId
      ? "Review approval activity for this change request."
      : "Review approval activity across this project.";

  const backHref = changeId
    ? `/projects/${encodeURIComponent(routeId)}/change/${encodeURIComponent(changeId)}`
    : artifactId
      ? `/projects/${encodeURIComponent(routeId)}/artifacts/${encodeURIComponent(artifactId)}`
      : `/projects/${encodeURIComponent(routeId)}/approvals`;

  const backLabel = changeId
    ? "Back to change request"
    : artifactId
      ? "Back to artifact"
      : "Back to approvals";

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold text-slate-900">{pageTitle}</div>
          <div className="mt-1 text-sm text-slate-600">{pageSubtitle}</div>
          <div className="mt-2 text-[11px] text-slate-500">
            Scope:{" "}
            <span className="font-medium text-slate-700">
              {projectCodeLabel || projectHeadingLabel}
            </span>
          </div>
        </div>

        <Link
          href={backHref}
          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          {backLabel}
        </Link>
      </div>

      <ApprovalTimeline
        projectId={projectUuid}
        projectCode={projectCodeLabel || null}
        artifactId={artifactId}
        changeId={changeId}
        title={pageTitle}
      />
    </div>
  );
}