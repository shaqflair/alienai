"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import type { Scenario } from "./_lib/scenario-engine";

// NOTE:
// "use server" modules may ONLY export async functions.
// Any constants/strings (like migration SQL) must live in a non-"use server" module.

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
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const scenario_id = norm(formData.get("scenario_id")) || null;
  const organisation_id = norm(formData.get("organisation_id"));
  const name = norm(formData.get("name")) || "Untitled scenario";
  const description = norm(formData.get("description")) || "";
  const changes_json = norm(formData.get("changes_json"));

  let changes: any[] = [];
  try {
    changes = JSON.parse(changes_json);
    if (!Array.isArray(changes)) changes = [];
  } catch {
    changes = [];
  }

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
  const supabase = await createClient();
  await requireUser(supabase);

  const scenario_id = norm(formData.get("scenario_id"));
  const org_id = norm(formData.get("organisation_id"));

  const { error } = await supabase
    .from("scenarios")
    .delete()
    .eq("id", scenario_id)
    .eq("organisation_id", org_id);

  if (error) throwDb(error, "scenarios.delete");

  revalidatePath("/scenarios");
  redirect("/scenarios");
}