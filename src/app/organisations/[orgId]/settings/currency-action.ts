// src/app/organisations/[orgId]/settings/currency-action.ts
"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { SUPPORTED_CURRENCIES } from "@/lib/server/getOrgCurrency";

const VALID_CODES = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

export async function updateOrgCurrency(formData: FormData) {
  const organisationId = String(formData.get("organisation_id") ?? "").trim();
  const currency = String(formData.get("default_currency") ?? "").trim().toUpperCase();

  if (!organisationId) throw new Error("Missing organisation_id");
  if (!VALID_CODES.has(currency)) throw new Error("Invalid currency");

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("organisations")
    .update({ default_currency: currency })
    .eq("id", organisationId);

  if (error) throw new Error(error.message);

  revalidatePath(`/organisations/${organisationId}/settings`);
}
