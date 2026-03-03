import "server-only";

import { headers } from "next/headers";
import { createClient as createSupabaseJsClient, type SupabaseClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/utils/supabase/server";

/**
 * Route Supabase client selector:
 * - Normal mode: cookie/session based (createServerClient)
 * - Dev bypass: service-role client if ALLOW_DEV_BYPASS=true and x-dev-bypass header present
 *
 * This is ONLY for local/dev scripting (PowerShell, CI smoke tests, etc).
 * Never enabled in production.
 */
export async function getRouteSupabaseClient(): Promise<SupabaseClient> {
  const h = headers();
  const wantsBypass = ["1", "true", "yes"].includes((h.get("x-dev-bypass") || "").toLowerCase());
  const allowBypass = process.env.ALLOW_DEV_BYPASS === "true";
  const isProd = process.env.NODE_ENV === "production";

  if (wantsBypass && allowBypass && !isProd) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      throw new Error("Dev bypass requested but NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing.");
    }

    return createSupabaseJsClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  return await createServerClient();
}
