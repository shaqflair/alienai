/* src/lib/change/changeRequests.ts
   Change Requests helpers (Supabase)
*/

export type CrStatus =
  | "new"
  | "analysis"
  | "review"
  | "in_progress"
  | "implemented"
  | "approved"
  | "rejected";

export type CrPriority = "Low" | "Medium" | "High" | "Critical";

export type AiImpact = {
  days?: number;
  cost?: number;
  risk?: string;
  highlights?: string[];
};

export type ChangeRequest = {
  id: string;
  project_id: string;
  requester_id: string | null;

  title: string;
  description: string;

  impact_analysis: AiImpact;

  status: CrStatus;
  priority: CrPriority;
  tags: string[];

  created_at: string;
  updated_at: string;

  approval_date: string | null;
  approver_id: string | null;
};

export function normalizeImpact(x: any): AiImpact {
  const days = Number(x?.days ?? 0);
  const cost = Number(x?.cost ?? 0);
  const risk = String(x?.risk ?? "None identified").trim() || "None identified";
  const highlights = Array.isArray(x?.highlights)
    ? x.highlights.map((s: any) => String(s)).filter(Boolean)
    : [];

  return { days, cost, risk, highlights };
}

/** 2) Load board items (fast + card-ready) */
export async function fetchChangeRequestsForBoard(
  supabase: any,
  projectId: string
): Promise<ChangeRequest[]> {
  const { data, error } = await supabase
    .from("change_requests")
    .select(
      "id, project_id, requester_id, title, description, impact_analysis, status, priority, tags, created_at, updated_at, approval_date, approver_id"
    )
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []) as ChangeRequest[];
}

/** Optional: group by status (for columns) */
export function groupByStatus(items: ChangeRequest[]) {
  const map: Record<CrStatus, ChangeRequest[]> = {
    new: [],
    analysis: [],
    review: [],
    in_progress: [],
    implemented: [],
    approved: [],
    rejected: [],
  };

  for (const it of items) map[it.status]?.push(it);
  return map;
}

/** 3) Move card between columns (update status) */
export async function moveChangeRequestStatus(
  supabase: any,
  args: { id: string; projectId: string; status: CrStatus }
) {
  const { id, projectId, status } = args;

  const { data, error } = await supabase
    .from("change_requests")
    .update({ status })
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id, status, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** 4) Create a new Change Request (from the form) */
export async function createChangeRequest(
  supabase: any,
  input: {
    project_id: string;
    title: string;
    description: string;
    status?: CrStatus;
    priority?: CrPriority;
    tags?: string[];
    impact_analysis?: AiImpact;
    requester_id?: string | null; // optional; set server-side ideally
  }
) {
  const payload: any = {
    project_id: input.project_id,
    title: (input.title ?? "").trim(),
    description: (input.description ?? "").trim(),
    status: input.status ?? "new",
    priority: input.priority ?? "Medium",
    tags: input.tags ?? [],
    impact_analysis: normalizeImpact(input.impact_analysis),
  };

  // If you’re creating from server routes, set requester_id there (recommended).
  if (typeof input.requester_id !== "undefined") payload.requester_id = input.requester_id;

  const { data, error } = await supabase
    .from("change_requests")
    .insert(payload)
    .select(
      "id, project_id, requester_id, title, description, impact_analysis, status, priority, tags, created_at, updated_at, approval_date, approver_id"
    )
    .single();

  if (error) throw new Error(error.message);
  return data as ChangeRequest;
}

/** 5) Update an existing Change Request (edit form) */
export async function updateChangeRequest(
  supabase: any,
  args: {
    id: string;
    projectId: string;
    patch: Partial<
      Pick<ChangeRequest, "title" | "description" | "status" | "priority" | "tags" | "impact_analysis">
    >;
  }
) {
  const { id, projectId, patch } = args;

  const updatePayload: any = { ...patch };

  if (patch.title != null) updatePayload.title = patch.title.trim();
  if (patch.description != null) updatePayload.description = patch.description.trim();
  if (patch.impact_analysis != null) updatePayload.impact_analysis = normalizeImpact(patch.impact_analysis);

  const { data, error } = await supabase
    .from("change_requests")
    .update(updatePayload)
    .eq("id", id)
    .eq("project_id", projectId)
    .select(
      "id, project_id, requester_id, title, description, impact_analysis, status, priority, tags, created_at, updated_at, approval_date, approver_id"
    )
    .single();

  if (error) throw new Error(error.message);
  return data as ChangeRequest;
}

/** 6) Approve / Reject helpers (sets approver + approval_date)
    NOTE: recommended to call these from server routes (so approverId is auth.uid()).
*/
export async function approveChangeRequest(
  supabase: any,
  args: { id: string; projectId: string; approverId: string }
) {
  const { id, projectId, approverId } = args;

  const { data, error } = await supabase
    .from("change_requests")
    .update({
      status: "approved",
      approver_id: approverId,
      approval_date: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id, status, approver_id, approval_date, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function rejectChangeRequest(
  supabase: any,
  args: { id: string; projectId: string; approverId: string }
) {
  const { id, projectId, approverId } = args;

  const { data, error } = await supabase
    .from("change_requests")
    .update({
      status: "rejected",
      approver_id: approverId,
      approval_date: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("project_id", projectId)
    .select("id, status, approver_id, approval_date, updated_at")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** 8) Example usage in a component (pseudo)
 *
 * const items = await fetchChangeRequestsForBoard(supabase, projectId);
 * const grouped = groupByStatus(items);
 *
 * await moveChangeRequestStatus(supabase, { id: crId, projectId, status: "in_progress" });
 *
 * await createChangeRequest(supabase, {
 *   project_id: projectId,
 *   title: "Extend Firewall Scope",
 *   description: "Vendor access for Phase 2…",
 *   priority: "High",
 *   tags: ["Security","Customer-Driven"],
 *   impact_analysis: { days: 12, cost: 45000, risk: "Security review dependency" },
 * });
 *
 * await updateChangeRequest(supabase, {
 *   id: crId,
 *   projectId,
 *   patch: { status: "implemented" }
 * });
 */
