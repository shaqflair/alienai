import "server-only";
import { createClient } from "@/utils/supabase/server";

type Severity = "high" | "medium" | "info" | "success";
type Type =
  | "approval_required"
  | "ai_warning"
  | "risk_raised"
  | "issue_raised"
  | "milestone_due"
  | "milestone_slip"
  | "action_assigned"
  | "action_overdue"
  | "mention"
  | "portfolio_signal"
  | "success_signal"
  | "system";

export async function notify(params: {
  recipient_user_id: string;
  type: Type;
  severity: Severity;
  title: string;
  body?: string | null;
  href?: string | null;
  meta?: any;
  organisation_id?: string | null;
  project_id?: string | null;
}) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_notification", {
    p_recipient_user_id: params.recipient_user_id,
    p_type: params.type,
    p_severity: params.severity,
    p_title: params.title,
    p_body: params.body ?? "",
    p_href: params.href ?? null,
    p_meta: params.meta ?? {},
    p_organisation_id: params.organisation_id ?? null,
    p_project_id: params.project_id ?? null,
  });

  if (error) throw new Error(error.message);
}
