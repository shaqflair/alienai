"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import type { Scenario } from "./_lib/scenario-engine";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function norm(x: FormDataEntryValue | null) {
  return safeStr(x).trim();
}
function throwDb(error: any, label: string): never {
  throw new Error(`[${label}] ${error?.code ?? ""} ${error?.message ?? ""}`);
}

async function requireUser(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error) throwDb(error, "auth");
  if (!auth?.user) redirect("/login");
  return auth.user;
}

export async function saveScenario(formData: FormData) {
  const supabase       = await createClient();
  const user            = await requireUser(supabase);
  const scenario_id    = norm(formData.get("scenario_id"))    || null;
  const organisation_id = norm(formData.get("organisation_id"));
  const name            = norm(formData.get("name"))           || "Untitled scenario";
  const description    = norm(formData.get("description"))    || "";
  const changes_json   = norm(formData.get("changes_json"));

  let changes: any[] = [];
  try { changes = JSON.parse(changes_json); } catch {}

  const payload = {
    organisation_id,
    name,
    description,
    changes,
    created_by: user.id,
    updated_at: new Date().toISOString(),
  };

  if (scenario_id) {
    const { error } = await supabase
      .from("scenarios")
      .update(payload)
      .eq("id", scenario_id)
      .eq("organisation_id", organisation_id);
    if (error) throwDb(error, "scenarios.update");
  } else {
    const { data, error } = await supabase
      .from("scenarios")
      .insert({ ...payload, created_at: new Date().toISOString() })
      .select("id")
      .single();
    if (error) throwDb(error, "scenarios.insert");
    revalidatePath("/scenarios");
    return { id: data.id };
  }

  revalidatePath("/scenarios");
}

export async function deleteScenario(formData: FormData) {
  const supabase      = await createClient();
  const user          = await requireUser(supabase);
  const scenario_id   = norm(formData.get("scenario_id"));
  const org_id        = norm(formData.get("organisation_id"));

  const { error } = await supabase
    .from("scenarios")
    .delete()
    .eq("id", scenario_id)
    .eq("organisation_id", org_id);

  if (error) throwDb(error, "scenarios.delete");
  revalidatePath("/scenarios");
  redirect("/scenarios");
}

export const SCENARIOS_MIGRATION = `
-- Migration SQL included in code for reference
create table if not exists scenarios (
  id                uuid         primary key default gen_random_uuid(),
  organisation_id  uuid         not null references organisations(id) on delete cascade,
  name               text         not null,
  description       text,
  changes           jsonb        not null default '[]',
  created_by        uuid         references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- ... (rest of the migration SQL)
`;
