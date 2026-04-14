// src/app/organisations/[orgId]/settings/apply-currency-action.ts
"use server";

import { createClient } from "@/utils/supabase/server";
import { revalidatePath } from "next/cache";
import { SUPPORTED_CURRENCIES } from "@/lib/server/getOrgCurrency";

const VALID_CODES = new Set(SUPPORTED_CURRENCIES.map((c) => c.code));

export async function applyOrgCurrencyToAllPlans(
  organisationId: string,
  currency: string
): Promise<{ ok: boolean; updated: number; error?: string }> {
  if (!organisationId) return { ok: false, updated: 0, error: "Missing organisation_id" };
  if (!VALID_CODES.has(currency)) return { ok: false, updated: 0, error: "Invalid currency" };

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, updated: 0, error: "Unauthorized" };

  // Get all current financial plan artifacts for this org
  const { data: artifacts, error: fetchErr } = await supabase
    .from("artifacts")
    .select("id, content_json")
    .eq("is_current", true)
    .eq("artifact_type", "financial_plan")
    .in(
      "project_id",
      supabase
        .from("projects")
        .select("id")
        .eq("organisation_id", organisationId)
    );

  if (fetchErr) return { ok: false, updated: 0, error: fetchErr.message };
  if (!artifacts?.length) return { ok: true, updated: 0 };

  // Update each artifact content_json.currency
  let updated = 0;
  for (const art of artifacts) {
    const existing = (art.content_json as any) ?? {};
    const updated_json = { ...existing, currency };
    const { error: upErr } = await supabase
      .from("artifacts")
      .update({ content_json: updated_json, updated_at: new Date().toISOString() })
      .eq("id", art.id);
    if (!upErr) updated++;
  }

  revalidatePath(`/organisations/${organisationId}/settings`);
  return { ok: true, updated };
}
