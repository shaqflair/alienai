import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Database = any; // generated types not yet in repo

export async function createClient<T = Database>(cookieStore = await cookies()) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anon) {
    throw new Error("Missing Supabase env: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createServerClient<T>(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Route handlers and Server Actions can set cookies; 
        // Server Components may throw if attempting to set during render.
        try {
          cookiesToSet.forEach(({ name, value, options }) => 
            cookieStore.set(name, value, options)
          );
        } catch {
          // The Next.js middleware or route handler will handle the actual header setting
        }
      },
    },
  });
}

