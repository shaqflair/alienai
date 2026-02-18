// src/utils/supabase/server.ts
import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

type CookieStoreLike = {
  getAll?: () => Array<{ name: string; value: string }>;
  set?: (name: string, value: string, options?: any) => void;
};

type CreateClientOpts =
  | {
      /**
       * ✅ Route Handlers / Middleware style
       * Pass req + res so Supabase can write Set-Cookie onto the response.
       */
      req: NextRequest;
      res: NextResponse;
    }
  | {
      /**
       * Optional override for advanced cases.
       * If omitted, we use next/headers cookies().
       */
      cookieStore?: CookieStoreLike;
    }
  | undefined;

async function getCookieStore(): Promise<CookieStoreLike> {
  const maybe = cookies() as any;
  return typeof maybe?.then === "function" ? await maybe : maybe;
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing Supabase env var: ${name}`);
  return v;
}

function mustValidSupabaseUrl(raw: string) {
  const v = String(raw).trim();
  if (!v || v === "undefined" || v === "null") {
    throw new Error(`Invalid NEXT_PUBLIC_SUPABASE_URL: "${raw}"`);
  }
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`Invalid NEXT_PUBLIC_SUPABASE_URL (not a URL): "${raw}"`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(
      `Invalid NEXT_PUBLIC_SUPABASE_URL protocol: "${u.protocol}" (expected http/https)`
    );
  }
  return u.toString().replace(/\/+$/, ""); // strip trailing slash
}

/**
 * ✅ Async server client. MUST be awaited by callers.
 *
 * Usage:
 * - Server Components:      const supabase = await createClient();
 * - Route handlers:         const res = NextResponse.redirect(...);
 *                           const supabase = await createClient({ req, res });
 */
export async function createClient(opts?: CreateClientOpts) {
  const url = mustValidSupabaseUrl(mustEnv("NEXT_PUBLIC_SUPABASE_URL"));
  const anonKey = mustEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY").trim();

  // Route handlers / middleware (cookie writes must attach to NextResponse)
  if (opts && "req" in opts && "res" in opts && opts.req && opts.res) {
    const req = opts.req;
    const res = opts.res;

    return createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          try {
            return req.cookies.getAll();
          } catch {
            return [];
          }
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              // NextResponse cookies API
              res.cookies.set(name, value, options);
            }
          } catch {
            // ignore
          }
        },
      },
    });
  }

  // Server Components / default path (uses next/headers cookies())
  const cookieStore = (opts && "cookieStore" in opts && opts.cookieStore) ? opts.cookieStore : await getCookieStore();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        try {
          return typeof cookieStore?.getAll === "function" ? cookieStore.getAll() : [];
        } catch {
          return [];
        }
      },
      setAll(cookiesToSet) {
        try {
          if (typeof (cookieStore as any)?.set !== "function") return;
          for (const { name, value, options } of cookiesToSet) {
            (cookieStore as any).set(name, value, options);
          }
        } catch {
          // ignore
        }
      },
    },
  });
}
