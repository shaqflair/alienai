import "server-only";

import { sb, requireUser, requireProjectRole, canEdit, safeStr } from "@/lib/change/server-helpers";

export type ChangeAccess = {
  supabase: any;
  user: { id: string; email?: string | null };
  role: "owner" | "editor" | "viewer";
  canEdit: boolean;
  change?: any | null;
  projectId: string;
};

export async function requireChangeAccess(args: {
  req?: Request;
  changeId?: string | null;
  projectId?: string | null;
  minRole?: "viewer" | "editor" | "owner";
  needsEdit?: boolean; // enforce canEdit(role)
}) : Promise<ChangeAccess> {
  const supabase = await sb();
  const user = await requireUser(supabase);

  const minRole = args.minRole ?? "viewer";
  const needsEdit = !!args.needsEdit;

  let projectId = safeStr(args.projectId || "");
  let change: any | null = null;

  if (!projectId && args.changeId) {
    const cid = safeStr(args.changeId);
    const { data, error } = await supabase
      .from("change_requests")
      .select("*")
      .eq("id", cid)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) throw new Error("Not found");

    change = data;
    projectId = safeStr(data.project_id);
  }

  if (!projectId) throw new Error("Missing project");

  const role = await requireProjectRole(supabase, projectId, user.id);
  if (!role) throw new Error("Forbidden");

  // enforce minimum role (viewer < editor < owner)
  const rank = (r: string) => (r === "owner" ? 3 : r === "editor" ? 2 : 1);
  if (rank(role) < rank(minRole)) throw new Error("Forbidden");

  const editable = canEdit(role);
  if (needsEdit && !editable) throw new Error("Forbidden");

  return {
    supabase,
    user,
    role,
    canEdit: editable,
    change,
    projectId,
  };
}
