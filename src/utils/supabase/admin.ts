// src/utils/supabase/admin.ts
import "server-only";

/**
 * Backward-compatible alias for the service role client.
 * Prefer importing createServiceClient from "@/lib/supabase/service".
 */
export { createServiceClient as createAdminClient } from "@/lib/supabase/service";