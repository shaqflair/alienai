import "server-only";
import { createClient } from "@/utils/supabase/server";

function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

export type ManagerFilterResult = {
  active:          boolean;
  managerUserId:   string | null;
  managerName:      string | null;
  directReportIds: string[];
};

export async function resolveManagerFilter(
  managerId: string | null | undefined
): Promise<ManagerFilterResult> {
  if (!managerId || !isUuid(managerId)) {
    return { active: false, managerUserId: null, managerName: null, directReportIds: [] };
  }

  const sb = await createClient();

  const [profileRes, reportsRes] = await Promise.all([
    sb.from("profiles")
      .select("full_name")
      .eq("user_id", managerId)
      .maybeSingle(),

    sb.from("profiles")
      .select("user_id")
      .eq("line_manager_id", managerId),
  ]);

  const managerName     = safeStr(profileRes.data?.full_name) || null;
  const directReportIds = (reportsRes.data ?? []).map((r: any) => safeStr(r.user_id)).filter(Boolean);

  return {
    active:          true,
    managerUserId:   managerId,
    managerName,
    directReportIds,
  };
}
