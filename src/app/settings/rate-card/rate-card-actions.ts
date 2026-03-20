"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type RateCardEntry = {
  id: string;
  organisation_id: string;
  role_title: string;
  seniority_level: string;
  day_rate: number;
  currency: string;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function requireAdmin(supabase: any, orgId: string) {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .maybeSingle();

  const role = safeStr(mem?.role).toLowerCase();
  if (!["admin", "owner"].includes(role)) {
    throw new Error("Only organisation admins can manage rate cards.");
  }
  return auth.user;
}

export async function loadRateCard(orgId: string): Promise<RateCardEntry[]> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return [];

  const { data, error } = await supabase
    .from("organisation_rate_cards")
    .select("*")
    .eq("organisation_id", orgId)
    .order("role_title", { ascending: true })
    .order("seniority_level", { ascending: true });

  if (error) return [];
  return (data ?? []) as RateCardEntry[];
}

export async function loadRateCardForProject(projectId: string): Promise<Record<string, number>> {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  const orgId = (project as any)?.organisation_id;
  if (!orgId) return {};

  const { data } = await supabase
    .from("organisation_rate_cards")
    .select("role_title, seniority_level, day_rate")
    .eq("organisation_id", orgId)
    .eq("is_active", true);

  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    const key = `${row.seniority_level} ${row.role_title}`.trim();
    map[key] = Number(row.day_rate);
    map[row.role_title] = Number(row.day_rate);
  }
  return map;
}

export async function upsertRateCardEntry(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();

  const orgId         = safeStr(formData.get("organisation_id")).trim();
  const roleTitle     = safeStr(formData.get("role_title")).trim();
  const seniority     = safeStr(formData.get("seniority_level")).trim() || "Senior";
  const dayRate       = Number(formData.get("day_rate"));
  const currency      = safeStr(formData.get("currency") || "GBP").trim();
  const notes         = safeStr(formData.get("notes")).trim() || null;
  const entryId       = safeStr(formData.get("entry_id")).trim() || null;

  if (!orgId || !roleTitle || !dayRate) return { ok: false, error: "Role title and day rate are required." };
  if (dayRate <= 0) return { ok: false, error: "Day rate must be greater than zero." };

  await requireAdmin(supabase, orgId);

  const now = new Date().toISOString();
  const { data: authData } = await supabase.auth.getUser();

  if (entryId) {
    const { error } = await supabase
      .from("organisation_rate_cards")
      .update({ role_title: roleTitle, seniority_level: seniority, day_rate: dayRate, currency, notes, updated_at: now, updated_by: authData.user?.id })
      .eq("id", entryId)
      .eq("organisation_id", orgId);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await supabase
      .from("organisation_rate_cards")
      .upsert(
        { organisation_id: orgId, role_title: roleTitle, seniority_level: seniority, day_rate: dayRate, currency, notes, is_active: true, created_at: now, created_by: authData.user?.id, updated_at: now, updated_by: authData.user?.id },
        { onConflict: "organisation_id,role_title,seniority_level" }
      );
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/settings/rate-card");
  return { ok: true };
}

export async function deleteRateCardEntry(entryId: string, orgId: string): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireAdmin(supabase, orgId);

  const { error } = await supabase
    .from("organisation_rate_cards")
    .delete()
    .eq("id", entryId)
    .eq("organisation_id", orgId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/rate-card");
  return { ok: true };
}

export async function toggleRateCardEntry(entryId: string, orgId: string, isActive: boolean): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  await requireAdmin(supabase, orgId);

  const { error } = await supabase
    .from("organisation_rate_cards")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", entryId)
    .eq("organisation_id", orgId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/settings/rate-card");
  return { ok: true };
}

export async function seedDefaultRateCard(orgId: string): Promise<{ ok: boolean; inserted: number; error?: string }> {
  const supabase = await createClient();
  await requireAdmin(supabase, orgId);
  const { data: authData } = await supabase.auth.getUser();

  const now = new Date().toISOString();
  const defaults = [
    { role_title: "Project Manager",    seniority_level: "Junior",    day_rate: 450 },
    { role_title: "Project Manager",    seniority_level: "Mid",       day_rate: 550 },
    { role_title: "Project Manager",    seniority_level: "Senior",    day_rate: 650 },
    { role_title: "Project Manager",    seniority_level: "Lead",      day_rate: 750 },
    { role_title: "Delivery Manager",   seniority_level: "Senior",    day_rate: 650 },
    { role_title: "Delivery Manager",   seniority_level: "Lead",      day_rate: 750 },
    { role_title: "Product Manager",    seniority_level: "Senior",    day_rate: 700 },
    { role_title: "Engineer",           seniority_level: "Junior",    day_rate: 450 },
    { role_title: "Engineer",           seniority_level: "Mid",       day_rate: 550 },
    { role_title: "Engineer",           seniority_level: "Senior",    day_rate: 650 },
    { role_title: "Engineer",           seniority_level: "Lead",      day_rate: 800 },
    { role_title: "Engineer",           seniority_level: "Principal", day_rate: 950 },
    { role_title: "Architect",          seniority_level: "Senior",    day_rate: 900 },
    { role_title: "Designer",           seniority_level: "Senior",    day_rate: 550 },
    { role_title: "Designer",           seniority_level: "Lead",      day_rate: 700 },
    { role_title: "Analyst",            seniority_level: "Senior",    day_rate: 500 },
    { role_title: "Data Scientist",     seniority_level: "Senior",    day_rate: 700 },
    { role_title: "QA Engineer",        seniority_level: "Senior",    day_rate: 550 },
    { role_title: "DevOps Engineer",    seniority_level: "Senior",    day_rate: 650 },
    { role_title: "Consultant",         seniority_level: "Senior",    day_rate: 800 },
  ].map(r => ({
    ...r,
    organisation_id: orgId,
    currency: "GBP",
    is_active: true,
    created_at: now,
    created_by: authData.user?.id,
    updated_at: now,
  }));

  const { data, error } = await supabase
    .from("organisation_rate_cards")
    .upsert(defaults, { onConflict: "organisation_id,role_title,seniority_level", ignoreDuplicates: true })
    .select("id");

  if (error) return { ok: false, inserted: 0, error: error.message };
  revalidatePath("/settings/rate-card");
  return { ok: true, inserted: (data ?? []).length };
}
