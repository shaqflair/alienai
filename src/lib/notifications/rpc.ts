// lib/notifications/rpc.ts
import { createClient } from "@/utils/supabase/server";

export type RpcListArgs = {
  onlyUnread?: boolean;
  limit?: number;
  before?: string | null; // ISO timestamp
};

/**
 * 🚨 IMPORTANT:
 * Your generator writes notifications.user_id.
 * If your DB RPC functions filter on recipient_user_id, they will return 0.
 *
 * To make "Run engine (dev)" instantly visible, we query the table directly here.
 * You can switch back to RPC after aligning the SQL functions to user_id.
 */

export async function listNotifications(args: RpcListArgs = {}) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  let q = supabase
    .from("notifications")
    .select(
      "id,user_id,project_id,artifact_id,type,title,body,link,is_read,created_at,actor_user_id,metadata,source_type,source_id,due_date,bucket"
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(args.limit ?? 30);

  if (args.onlyUnread) q = q.neq("is_read", true);

  // optional pagination: items older than timestamp
  if (args.before) q = q.lt("created_at", args.before);

  const { data, error } = await q;
  if (error) throw new Error(error.message);

  return data ?? [];
}

export async function markNotificationsRead(ids: string[]) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const cleanIds = (ids || []).map(String).filter(Boolean);
  if (!cleanIds.length) return 0;

  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .in("id", cleanIds)
    .select("id");

  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Keep this RPC as-is (it doesn't block Overdue/DueSoon population),
 * but if it also depends on notifications.user_id vs recipient_user_id, align the SQL similarly.
 */
export async function approvalPendingAlerts() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const { data, error } = await supabase.rpc("rpc_approval_pending_alerts", {
    p_user_id: userId,
  });

  if (error) throw new Error(error.message);
  return (data?.[0] ?? { pending_count: 0, latest_at: null }) as {
    pending_count: number;
    latest_at: string | null;
  };
}
