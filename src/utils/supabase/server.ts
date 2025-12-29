import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

type CookieStoreLike = {
  getAll: () => Array<{ name: string; value: string }>;
  set: (name: string, value: string, options?: any) => void;
};

/**
 * Next can provide cookies() as sync or async depending on build/runtime.
 * This helper safely unwraps either form.
 */
async function getCookieStore(): Promise<CookieStoreLike> {
  const maybe = cookies() as any;
  // If cookies() returns a Promise/thenable, await it; otherwise use it directly.
  const store = typeof maybe?.then === "function" ? await maybe : maybe;
  return store as CookieStoreLike;
}

export async function createClient() {
  const cookieStore = await getCookieStore();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing Supabase environment variables. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        // cookieStore is now guaranteed to be the resolved store
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Can fail in some server render contexts; safe to ignore
        }
      },
    },
  });
}
