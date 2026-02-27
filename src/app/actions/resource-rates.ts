"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";

// ── Shared types ──────────────────────────────────────────────────────────────

export type OrgMemberForPicker = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
  job_title: string | null;
  role: string; // org role: member | admin | owner
};

export type ResourceRate = {
  id: string;
  organisation_id: string;
  user_id: string;
  role_label: string;
  rate_type: "day_rate" | "monthly_cost";
  rate: number;
  currency: string;
  resource_type: "internal" | "contractor" | "vendor" | "consultant";
  notes: string | null;
  effective_from: string;
  // joined from profiles + organisation_members
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
  job_title: string | null;
};

// ── Fetch all org members (for the person picker in financial plan) ────────────

export async function getOrgMembersForPicker(
  organisationId: string
): Promise<OrgMemberForPicker[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("organisation_members")
    .select(
      `
      user_id,
      role,
      profiles!inner (
        full_name,
        email,
        avatar_url,
        department
      )
    `
    )
    .eq("organisation_id", organisationId)
    .is("removed_at", null)
    .order("role");

  if (error) throw new Error(error.message);

  return ((data ?? []) as any[]).map((row) => ({
    user_id:    row.user_id,
    full_name:  row.profiles?.full_name ?? null,
    email:      row.profiles?.email     ?? null,
    avatar_url: row.profiles?.avatar_url ?? null,
    department: row.profiles?.department ?? null,
    job_title:  row.job_title            ?? null,
    role:       row.role,
  }));
}

// ── Fetch latest resource rates for an org (admin rate card view) ─────────────

export async function getResourceRates(
  organisationId: string
): Promise<ResourceRate[]> {
  const supabase = await createClient();

  // Use the view which already deduplicates to latest effective_from
  const { data, error } = await supabase
    .from("v_resource_rates_latest")
    .select("*")
    .eq("organisation_id", organisationId)
    .order("full_name");

  if (error) throw new Error(error.message);
  return (data ?? []) as ResourceRate[];
}

// ── Fetch rate for a specific user (used when PM picks a person) ──────────────

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

// ── Upsert a rate (admin only — RLS enforces this) ────────────────────────────

export async function upsertResourceRate(payload: {
  id?: string;
  organisation_id: string;
  user_id: string;
  role_label: string;
  rate_type: "day_rate" | "monthly_cost";
  rate: number;
  currency: string;
  resource_type: "internal" | "contractor" | "vendor" | "consultant";
  notes?: string;
  effective_from: string;
}): Promise<{ id: string }> {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  const actorId = userData?.user?.id;

  const row = {
    ...payload,
    updated_by: actorId,
    ...(payload.id ? {} : { created_by: actorId }),
  };

  const { data, error } = await supabase
    .from("resource_rates")
    .upsert(row, {
      onConflict: "organisation_id,user_id,rate_type,effective_from",
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);

  revalidatePath(`/organisations/${payload.organisation_id}/settings`);
  return { id: data.id };
}

// ── Delete a rate row ─────────────────────────────────────────────────────────

export async function deleteResourceRate(
  id: string,
  organisationId: string
): Promise<void> {
  const supabase = await createClient();

  const { error } = await supabase
    .from("resource_rates")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);

  revalidatePath(`/organisations/${organisationId}/settings`);
}