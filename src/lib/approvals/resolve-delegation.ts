// src/lib/approvals/resolve-delegation-recipients.ts
//
// Drop this helper into your notification functions to ensure delegates
// receive approval notifications during the approver's absence.
//
// Usage in notifyFirstStepApprovers / notifyNextStepApprovers:
//
//   const recipients = await resolveDelegationRecipients(supabase, {
//     orgId,
//     approverUserIds: stepApproverUserIds,
//   });
//   // recipients includes both original approvers AND active delegates
//   // Send emails / in-app notifications to all recipients
//
// The function is deliberately non-throwing — notification failures should
// never block the approval flow itself.

import "server-only";

export type DelegationRecipient = {
  userId: string;
  isDelegateFor: string | null;  // null = original approver, uuid = acting as delegate for this person
  delegationId: string | null;
};

/**
 * Given a list of assigned approver user IDs, returns the full recipient list:
 * the original approvers plus any active delegates covering them right now.
 *
 * Safe to call at any point — silently returns the original list on any error.
 */
export async function resolveDelegationRecipients(
  supabase: any,
  args: {
    orgId: string;
    approverUserIds: string[];
    nowIso?: string;
  }
): Promise<DelegationRecipient[]> {
  const { orgId, approverUserIds } = args;
  const now = args.nowIso ?? new Date().toISOString();

  // Start with the original approvers
  const recipients: DelegationRecipient[] = approverUserIds
    .filter(Boolean)
    .map(userId => ({ userId, isDelegateFor: null, delegationId: null }));

  if (!approverUserIds.length || !orgId) return recipients;

  try {
    // Find all active delegations covering NOW for any of these approvers
    const { data, error } = await supabase
      .from("approver_delegations")
      .select("id, from_user_id, to_user_id, starts_at, ends_at")
      .eq("organisation_id", orgId)
      .eq("is_active", true)
      .in("from_user_id", approverUserIds)
      .lte("starts_at", now)
      .gte("ends_at", now);

    if (error || !Array.isArray(data) || !data.length) return recipients;

    // Add delegates — deduplicate by userId so we don't double-notify
    const existingIds = new Set(recipients.map(r => r.userId));

    for (const grant of data) {
      const delegateId  = String(grant.to_user_id  ?? "").trim();
      const originalId  = String(grant.from_user_id ?? "").trim();
      const delegationId = String(grant.id ?? "").trim();

      if (!delegateId || !originalId) continue;
      if (existingIds.has(delegateId)) continue; // already in list (e.g. delegate is also a direct approver)

      existingIds.add(delegateId);
      recipients.push({
        userId:        delegateId,
        isDelegateFor: originalId,
        delegationId:  delegationId || null,
      });
    }

    return recipients;
  } catch {
    // Non-throwing — return original list if anything goes wrong
    return recipients;
  }
}

/**
 * Convenience function: returns just the user IDs (original + delegates).
 * Use this when you only need IDs for a notification query.
 */
export async function resolveDelegationRecipientIds(
  supabase: any,
  args: {
    orgId: string;
    approverUserIds: string[];
    nowIso?: string;
  }
): Promise<string[]> {
  const recipients = await resolveDelegationRecipients(supabase, args);
  return recipients.map(r => r.userId);
}

/**
 * Returns the delegated approver for a single approver (if any active delegation exists).
 * Useful for checking before sending a single-approver notification.
 */
export async function getActiveDelegateForApprover(
  supabase: any,
  args: {
    orgId: string;
    approverUserId: string;
    nowIso?: string;
  }
): Promise<{ delegateUserId: string; delegationId: string } | null> {
  const now = args.nowIso ?? new Date().toISOString();

  try {
    const { data, error } = await supabase
      .from("approver_delegations")
      .select("id, to_user_id")
      .eq("organisation_id", args.orgId)
      .eq("from_user_id", args.approverUserId)
      .eq("is_active", true)
      .lte("starts_at", now)
      .gte("ends_at", now)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.to_user_id) return null;

    return {
      delegateUserId: String(data.to_user_id),
      delegationId:   String(data.id ?? ""),
    };
  } catch {
    return null;
  }
}