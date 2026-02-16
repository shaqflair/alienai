import "server-only";

import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client (server-only).
 * Used for Storage operations to avoid Storage RLS blocking uploads/deletes.
 *
 * ⚠️ Requires: SUPABASE_SERVICE_ROLE_KEY in server env (never expose to client).
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
