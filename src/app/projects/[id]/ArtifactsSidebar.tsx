import { createClient } from "@/utils/supabase/server";
import ArtifactsSidebarClient from "./ArtifactsSidebarClient";
import { notFound } from "next/navigation";

type DefRow = {
  key: string;
  label: string;
  ui_kind: string;
  sort_order: number;
};

type ArtifactRow = {
  id: string;
  project_id: string;
  type: string;
  title: string | null;
  approval_status: string;
  is_current: boolean;
  is_locked?: boolean | null;
};

type Role = "owner" | "editor" | "viewer" | "unknown";

function safeId(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const v = x.trim();
  if (!v || v === "undefined" || v === "null") return null;
  return v;
}

export default async function ArtifactsSidebar({
  projectId,
}: {
  projectId: string;
}) {
  const pid = safeId(projectId);
  if (!pid) notFound();

  const supabase = await createClient();

  // 1) Determine my role
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id ?? null;

  let role: Role = "unknown";
  if (userId) {
    const { data: m, error: mErr } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", pid)
      .eq("user_id", userId)
      .maybeSingle();

    if (!mErr && m?.role) role = m.role as Role;
  }

  const canEdit = role === "owner" || role === "editor";

  // 2) Definitions
  const { data: defs, error: defsErr } = await supabase
    .from("artifact_definitions")
    .select("key,label,ui_kind,sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (defsErr) throw new Error(defsErr.message);

  // 3) Auto-create missing artifacts (owners/editors only)
  if (canEdit) {
    const { error: rpcErr } = await supabase.rpc("ensure_project_artifacts", {
      p_project_id: pid,
    });

    // Don't crash the UI if RPC is blocked/missing
    if (rpcErr) console.warn("[ensure_project_artifacts]", rpcErr.message);
  }

  // 4) Fetch current artifacts (guarded project id)
  const { data: currents, error: curErr } = await supabase
    .from("artifacts")
    .select("id,project_id,type,title,approval_status,is_current,is_locked")
    .eq("project_id", pid)
    .eq("is_current", true);

  if (curErr) throw new Error(curErr.message);

  const currentByType = new Map<string, ArtifactRow>();
  for (const a of (currents ?? []) as ArtifactRow[]) {
    if (a?.type) currentByType.set(a.type, a);
  }

  const items = (defs ?? []).map((d: DefRow) => {
    const current = currentByType.get(d.key) ?? null;

    const href = current
      ? `/projects/${pid}/artifacts/${current.id}`
      : canEdit
      ? `/projects/${pid}/artifacts/new?type=${encodeURIComponent(d.key)}`
      : `/projects/${pid}`; // viewers: no create

    return {
      key: d.key,
      label: d.label,
      ui_kind: d.ui_kind,
      current: current
        ? {
            id: current.id,
            title: current.title,
            approval_status: current.approval_status,
            is_locked: current.is_locked ?? null,
          }
        : null,
      href,
      canCreate: canEdit,
      canEdit,
    };
  });

  return (
    <ArtifactsSidebarClient items={items} role={role} projectId={pid} />
  );
}
