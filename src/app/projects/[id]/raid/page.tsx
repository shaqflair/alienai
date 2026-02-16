// src/app/projects/[id]/raid/page.tsx
import "server-only";

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import RaidClient from "@/components/raid/RaidClient";

/* ---------------- utils ---------------- */

function safeParam(x: unknown) {
  return typeof x === "string" ? x : "";
}

function toText(x: any) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number") return Number.isFinite(x) ? String(x) : "";
  if (typeof x === "bigint") return String(x);
  try {
    return String(x);
  } catch {
    return "";
  }
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

/**
 * Resolve a project identifier (UUID or project_code) -> UUID
 */
async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const id = toText(identifier).trim();
  if (!id) return null;

  // UUID input
  if (looksLikeUuid(id)) return id;

  // project_code input
  const { data, error } = await supabase.from("projects").select("id").eq("project_code", id).maybeSingle();
  if (error) throw error;

  const uuid = toText(data?.id).trim();
  return uuid || null;
}

/* ---------------- page ---------------- */

export default async function RaidPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projectIdentifier = safeParam(id).trim();
  if (!projectIdentifier || projectIdentifier === "undefined") notFound();

  const supabase = await createClient();

  // Auth gate
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // Resolve UUID from either UUID or project_code
  const projectUuid = await resolveProjectUuid(supabase, projectIdentifier);
  if (!projectUuid) notFound();

  // Membership gate
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active, removed_at")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem || mem.is_active === false || (mem as any).removed_at != null) notFound();

  // 1) Load project meta by UUID
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title,client_name,project_code")
    .eq("id", projectUuid)
    .maybeSingle();

  if (projErr) throw projErr;
  if (!project?.id) notFound();

  const projectTitle = toText(project?.title).trim() || "Untitled project";
  const projectClient = toText(project?.client_name).trim();
  const projectCodeRaw = toText(project?.project_code).trim();

  // Human display id
  const projectPublicId = projectCodeRaw ? `P-${projectCodeRaw}` : "";

  // 2) Load RAID items by UUID
  const { data: items, error: raidErr } = await supabase
    .from("raid_items")
    .select(
      "id,project_id,item_no,public_id,type,title,description,owner_label,priority,probability,severity,ai_rollup,owner_id,status,response_plan,related_refs,due_date,updated_at"
    )
    .eq("project_id", projectUuid)
    .order("updated_at", { ascending: false });

  if (raidErr) throw raidErr;

  return (
    <RaidClient
      // UUID for API calls
      projectId={projectUuid}
      // human id for URLs inside RaidClient (deep links, back to project)
      projectRouteId={projectIdentifier}
      projectTitle={projectTitle}
      projectClient={projectClient}
      projectPublicId={projectPublicId}
      initialItems={(items ?? []) as any}
    />
  );
}
