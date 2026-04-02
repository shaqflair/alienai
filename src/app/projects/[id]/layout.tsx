// src/app/projects/[id]/layout.tsx
import "server-only";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import ProjectHeader from "@/components/projects/ProjectHeader";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim(),
  );
}
function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = String(col || "").toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}
function isInvalidInputSyntaxError(err: any) {
  return String(err?.code || "").trim() === "22P02";
}

const RESERVED = new Set([
  "artifacts", "changes", "change", "members", "approvals",
  "lessons", "raid", "schedule", "wbs",
]);

const HUMAN_COL_CANDIDATES = [
  "project_human_id", "human_id", "project_code",
  "code", "slug", "reference", "ref",
] as const;

function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try { v = decodeURIComponent(v); } catch {}
  v = v.trim();
  // If it contains a dash (e.g. PRJ-100), preserve the full code
  if (v.includes("-")) return v.toUpperCase();
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];
  return v;
}

async function resolveProjectUuid(
  supabase: any,
  identifier: string,
  organisationId: string
): Promise<{ projectUuid: string | null; project: any | null }> {
  const raw = safeStr(identifier).trim();
  if (!raw) return { projectUuid: null, project: null };
  if (looksLikeUuid(raw)) return { projectUuid: raw, project: null };
  const normalized = normalizeProjectIdentifier(raw);
  for (const col of HUMAN_COL_CANDIDATES) {
    const { data, error } = await supabase
      .from("projects").select("*")
      .eq("organisation_id", organisationId)
      .eq(col, normalized)
      .maybeSingle();
    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      if (isInvalidInputSyntaxError(error)) continue;
      throw error;
    }
    if (data?.id) return { projectUuid: String(data.id), project: data };
  }
  return { projectUuid: null, project: null };
}

function bestProjectRole(rows: Array<{ role?: string | null }> | null | undefined) {
  const roles = (rows ?? []).map((r) => String(r?.role ?? "").toLowerCase()).filter(Boolean);
  if (!roles.length) return "";
  if (roles.includes("owner")) return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return roles[0] || "";
}

async function getOrgMembership(supabase: any, organisationId: string, userId: string) {
  const { data, error } = await supabase
    .from("organisation_members").select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  if (error) {
    if (String(error?.message || "").toLowerCase().includes("does not exist"))
      return { isMember: false, isAdmin: false, role: "" };
    throw error;
  }
  const role = String(data?.role ?? "").toLowerCase();
  return { isMember: Boolean(role), isAdmin: role === "admin" || role === "owner", role };
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) redirect("/login");

  const { id: _paramId } = await params;
  const rawId = safeStr(_paramId).trim();

  if (!rawId) notFound();

  // Reserved route segments — render children without project shell
  if (RESERVED.has(rawId.toLowerCase())) {
    return (
      <div style={{ minHeight: "100vh", background: "#f6f8fa", fontFamily: "sans-serif" }}>
        <div style={{ width: "100%", padding: "28px 32px 64px" }}>
          {children}
        </div>
      </div>
    );
  }

  let activeOrgId = await getActiveOrgId();
  if (!activeOrgId) {
    if (looksLikeUuid(rawId)) {
      const { data: proj } = await supabase
        .from("projects").select("organisation_id").eq("id", rawId).maybeSingle();
      if (proj?.organisation_id) activeOrgId = String(proj.organisation_id);
    }
    if (!activeOrgId) notFound();
  }

  const resolved = await resolveProjectUuid(supabase, rawId, activeOrgId);
  if (!resolved?.projectUuid) notFound();
  const projectUuid = String(resolved.projectUuid);

  let project: any = resolved.project;
  if (!project) {
    const { data: p, error: pErr } = await supabase
      .from("projects")
      .select("id, organisation_id, title, project_code, colour, start_date, finish_date, resource_status, status")
      .eq("id", projectUuid)
      .eq("organisation_id", activeOrgId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!p?.id) notFound();
    project = p;
  } else {
    if (String(project?.organisation_id ?? "") !== activeOrgId) notFound();
  }

  const org = await getOrgMembership(supabase, activeOrgId, auth.user.id);
  const { data: memRows } = await supabase
    .from("project_members").select("role, removed_at, is_active")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .is("removed_at", null);

  const projectRole   = bestProjectRole(memRows as any);
  const canSeeProject = org.isMember || Boolean(projectRole);
  if (!canSeeProject) notFound();

  // Switcher projects
  let switcherProjects: { id: string; title: string; project_code: string | null; colour: string | null }[] = [];
  try {
    const { data: myMems } = await supabase
      .from("project_members").select("project_id")
      .eq("user_id", auth.user.id)
      .is("removed_at", null);
    const myIds = (myMems ?? []).map((r: any) => String(r.project_id)).filter(Boolean);
    if (myIds.length > 0) {
      const { data: switcherData } = await supabase
        .from("projects").select("id, title, project_code, colour, status, deleted_at")
        .in("id", myIds)
        .eq("organisation_id", activeOrgId)
        .is("deleted_at", null)
        .order("title", { ascending: true })
        .limit(200);
      switcherProjects = (switcherData ?? []).filter(
        (p: any) => (p.status ?? "active").toLowerCase() !== "closed",
      );
    }
  } catch { switcherProjects = []; }

  // Key artifacts for tab hrefs
  let keyArtifacts: { id: string; type: string }[] = [];
  try {
    const { data: arts } = await supabase
      .from("artifacts").select("id, type")
      .eq("project_id", projectUuid)
      .in("type", ["SCHEDULE", "WBS", "FINANCIAL_PLAN", "WEEKLY_REPORT"])
      .order("created_at", { ascending: false })
      .limit(20);
    keyArtifacts = arts ?? [];
  } catch { keyArtifacts = []; }

  const artifactHref = (type: string) => {
    const a = keyArtifacts.find((x) => x.type === type);
    return a?.id ? `/projects/${projectUuid}/artifacts/${a.id}` : `/projects/${projectUuid}/artifacts`;
  };

  const projectTitle  = safeStr(project?.title ?? "Project") || "Project";
  const projectCode   = safeStr(project?.project_code ?? "").trim() || null;
  const projectColour = safeStr(project?.colour ?? "#22c55e") || "#22c55e";
  const projectStatus = safeStr(project?.status ?? "active");
  const isActive      = projectStatus.toLowerCase() !== "closed";

  const tabs = [
    { id: "overview",  label: "Overview",       href: `/projects/${projectUuid}` },
    { id: "artifacts", label: "Artifacts",      href: `/projects/${projectUuid}/artifacts` },
    { id: "schedule",  label: "Schedule",       href: artifactHref("SCHEDULE") },
    { id: "wbs",       label: "WBS",            href: artifactHref("WBS") },
    { id: "financial", label: "Financial Plan", href: artifactHref("FINANCIAL_PLAN") },
    { id: "members",   label: "Members",        href: `/projects/${projectUuid}/members` },
    { id: "changes",   label: "Change Board",   href: `/projects/${projectUuid}/change` },
    { id: "raid",      label: "Risks",          href: `/projects/${projectUuid}/raid` },
    { id: "lessons",   label: "Lessons",        href: `/projects/${projectUuid}/lessons` },
    { id: "weekly",    label: "Weekly Report",  href: artifactHref("WEEKLY_REPORT") },
  ];

  return (
    // Full-width — no max-width cap, matches portfolio page
    <div style={{ minHeight: "100vh", background: "#f6f8fa", fontFamily: "'Geist', -apple-system, sans-serif" }}>
      <div style={{ width: "100%", padding: "28px 32px 64px" }}>
        <ProjectHeader
          projectId={projectUuid}
          projectTitle={projectTitle}
          projectCode={projectCode}
          projectColour={projectColour}
          isActive={isActive}
          switcherProjects={switcherProjects}
          tabs={tabs}
        />
        {children}
      </div>
    </div>
  );
}