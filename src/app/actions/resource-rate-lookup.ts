"use server";
import { createClient } from "@/utils/supabase/server";
import type { ResourceRateType, ResourceType } from "@/components/artifacts/FinancialPlanEditor";

// ── Returned by getRateForUser ────────────────────────────────────────────────

export type RateCardMatch = {
  rate_type:     ResourceRateType;
  rate:          number;
  currency:      string;
  resource_type: ResourceType;
  role_label:    string;
};

/**
 * Look up the latest rate for a user within an org.
 * Falls back to role-based rate (user_id IS NULL) if no person-specific rate exists.
 * Returns null if no rate at all.
 */
export async function getRateForUser(
  organisationId: string,
  userId: string,
): Promise<RateCardMatch | null> {
  const supabase = await createClient();

  // 1. Try person-specific rate first
  const { data: personal } = await supabase
    .from("v_resource_rates_latest")
    .select("rate_type, rate, currency, resource_type, role_label")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (personal) {
    return {
      rate_type:     personal.rate_type     as ResourceRateType,
      rate:          Number(personal.rate),
      currency:      personal.currency,
      resource_type: personal.resource_type as ResourceType,
      role_label:    personal.role_label,
    };
  }

  // 2. No personal rate — try to find a role-based rate via profile job_title
  // First get their job_title / department from profiles
  const { data: profile } = await supabase
    .from("profiles")
    .select("job_title, department")
    .eq("user_id", userId)
    .maybeSingle();

  if (profile?.job_title) {
    const { data: roleRate } = await supabase
      .from("v_resource_rates_latest")
      .select("rate_type, rate, currency, resource_type, role_label")
      .eq("organisation_id", organisationId)
      .is("user_id", null)
      .ilike("role_label", profile.job_title)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (roleRate) {
      return {
        rate_type:     roleRate.rate_type     as ResourceRateType,
        rate:          Number(roleRate.rate),
        currency:      roleRate.currency,
        resource_type: roleRate.resource_type as ResourceType,
        role_label:    roleRate.role_label,
      };
    }
  }

  return null;
}

/**
 * Get all rates for an org (for role picker / rate card display).
 * Used by ResourcePicker to show available roles without picking a person.
 */
export async function getOrgRoles(
  organisationId: string,
): Promise<RateCardMatch[]> {
  const supabase = await createClient();

  const { data } = await supabase
    .from("v_resource_rates_latest")
    .select("rate_type, rate, currency, resource_type, role_label")
    .eq("organisation_id", organisationId)
    .is("user_id", null)
    .order("role_label");

  return (data ?? []).map(r => ({
    rate_type:     r.rate_type     as ResourceRateType,
    rate:          Number(r.rate),
    currency:      r.currency,
    resource_type: r.resource_type as ResourceType,
    role_label:    r.role_label,
  }));
}
