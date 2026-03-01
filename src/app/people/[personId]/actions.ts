"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function norm(x: FormDataEntryValue | null) {
  return safeStr(x).trim();
}
function throwDb(err: any, label: string): never {
  throw new Error(`[${label}] ${err?.message ?? err}`);
}

async function requireUser(supabase: any) {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  return user;
}

async function canEdit(supabase: any, targetPersonId: string, organisationId: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  if (user.id === targetPersonId) return true;
  
  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();
    
  return safeStr(mem?.role).toLowerCase() === "admin";
}

export async function updateProfileBio(formData: FormData) {
  const supabase = await createClient();
  await requireUser(supabase);

  const personId = norm(formData.get("person_id"));
  const organisationId = norm(formData.get("organisation_id"));

  if (!await canEdit(supabase, personId, organisationId))
    throw new Error("Permission denied");

  const { error } = await supabase
    .from("profiles")
    .update({
      bio:          norm(formData.get("bio"))          || null,
      location:     norm(formData.get("location"))     || null,
      linkedin_url: norm(formData.get("linkedin_url")) || null,
    })
    .eq("user_id", personId);

  if (error) throwDb(error, "profiles.updateBio");
  revalidatePath(`/people/${personId}`);
}

export async function updateSkills(formData: FormData) {
  const supabase = await createClient();
  await requireUser(supabase);

  const personId = norm(formData.get("person_id"));
  const organisationId = norm(formData.get("organisation_id"));
  const skillsJson = norm(formData.get("skills_json"));

  if (!await canEdit(supabase, personId, organisationId))
    throw new Error("Permission denied");

  let skills: string[] = [];
  try { skills = JSON.parse(skillsJson); } catch {}
  skills = skills.map(s => safeStr(s).trim()).filter(Boolean).slice(0, 50);

  const { error } = await supabase
    .from("profiles")
    .update({ skills })
    .eq("user_id", personId);

  if (error) throwDb(error, "profiles.updateSkills");
  revalidatePath(`/people/${personId}`);
}

export async function updateCertifications(formData: FormData) {
  const supabase = await createClient();
  await requireUser(supabase);

  const personId = norm(formData.get("person_id"));
  const organisationId = norm(formData.get("organisation_id"));
  const certsJson = norm(formData.get("certifications_json"));

  if (!await canEdit(supabase, personId, organisationId))
    throw new Error("Permission denied");

  let certifications: any[] = [];
  try { certifications = JSON.parse(certsJson); } catch {}

  certifications = certifications
    .filter(c => c && c.title)
    .map(c => ({
      title:        safeStr(c.title).trim(),
      issuer:       safeStr(c.issuer || "").trim() || null,
      issued_date:  c.issued_date  ? safeStr(c.issued_date)  : null,
      expiry_date:  c.expiry_date  ? safeStr(c.expiry_date)  : null,
    }))
    .slice(0, 20);

  const { error } = await supabase
    .from("profiles")
    .update({ certifications })
    .eq("user_id", personId);

  if (error) throwDb(error, "profiles.updateCertifications");
  revalidatePath(`/people/${personId}`);
}
