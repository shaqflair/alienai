"use server";
import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

// -- Shared types -----------------------------------------------------------

export type OrgMemberForPicker = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
  role: string;
};

export type ResourceRate = {
  id: string;
  organisation_id: string;
  user_id: string | null;
  role_label: string;
  rate_type: "day_rate" | "monthly_cost";
  rate: number;
  currency: string;
  resource_type: "internal" | "contractor" | "vendor" | "consultant";
  notes: string | null;
  effective_from: string;
  // joined from profiles
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
};

// -- Fetch all org members (for the person picker) --------------------------

export async function getOrgMembersForPicker(
  organisationId: string
): Promise<OrgMemberForPicker[]> {
  const supabase = await createClient();

  const { data: members, error } = await supabase
    .from("organisation_members")
    .select("user_id, role")
    .eq("organisation_id", organisationId)
    .is("removed_at", null)
    .order("role");

  if (error) throw new Error(error.message);
  if (!members?.length) return [];

  const userIds = members.map((m: any) => m.user_id).filter(Boolean);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, avatar_url, department")
    .in("user_id", userIds);

  const profileMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));

  return members.map((row: any) => {
    const p = profileMap.get(row.user_id) ?? {};
    return {
      user_id:    row.user_id,
      full_name:  p.full_name  ?? null,
      email:      p.email      ?? null,
      avatar_url: p.avatar_url ?? null,
      department: p.department ?? null,
      role:       row.role,
    };
  });
}

// -- Fetch latest resource rates for an org ---------------------------------

export async function getResourceRates(
  organisationId: string
): Promise<ResourceRate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_resource_rates_latest")
    .select("*")
    .eq("organisation_id", organisationId)
    .order("role_label");
  if (error) { console.error("[getResourceRates]", error.message); return []; }
  return (data ?? []) as ResourceRate[];
}

// -- Fetch rate for a specific user -----------------------------------------

export async function getResourceRateForUser(
  organisationId: string,
  userId: string
): Promise<ResourceRate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_resource_rates_latest")
    .select("*")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
  return (data ?? []) as ResourceRate[];
}

// -- Upsert a rate (admin only - RLS enforces this) -------------------------

export async function upsertResourceRate(payload: {
  id?: string;
  organisationId: string;
  userId?: string | null;
  roleLabel: string;
  rateType: "day_rate" | "monthly_cost";
  rate: number;
  currency: string;
  resourceType: "internal" | "contractor" | "vendor" | "consultant";
  notes?: string | null;
  effectiveFrom: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const actorId = userData?.user?.id;

  const row: Record<string, any> = {
    organisation_id: payload.organisationId,
    user_id:         payload.userId || null,
    role_label:      payload.roleLabel,
    rate_type:       payload.rateType,
    rate:            payload.rate,
    currency:        payload.currency,
    resource_type:   payload.resourceType,
    notes:           payload.notes || null,
    effective_from:  payload.effectiveFrom,
    updated_by:      actorId,
  };

  if (payload.id) {
    row.id = payload.id;
  } else {
    row.created_by = actorId;
  }

  const { error } = await supabase
    .from("resource_rates")
    .upsert(row, { onConflict: payload.id ? "id" : undefined });

  if (error) return { error: error.message };

  revalidatePath(`/organisations/${payload.organisationId}/settings`);
  return {};
}

// -- Delete a rate ----------------------------------------------------------

export async function deleteResourceRate(payload: {
  id: string;
  organisationId: string;
}): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("resource_rates")
    .delete()
    .eq("id", payload.id)
    .eq("organisation_id", payload.organisationId);

  if (error) return { error: error.message };

  revalidatePath(`/organisations/${payload.organisationId}/settings`);
  return {};
}
