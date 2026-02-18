// src/proxy.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Proxy (formerly middleware) for Supabase session refresh.
 *
 * Goals:
 * 1) NEVER hard-fail production (no 500s) if env vars are missing.
 * 2) Skip static assets and common public files (performance + avoids oddities).
 * 3) Still run for app routes + auth routes so cookies/session refresh works.
 */

function isStaticAssetPath(pathname: string) {
  // Next internals
  if (pathname.startsWith("/_next/")) return true;

  // Public / common files
  if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json"
  )
    return true;

  // Obvious asset folders (adjust if you use any of these)
  if (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/fonts/")
  )
    return true;

  // File extensions (covers direct static file hits)
  const lower = pathname.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".svg") ||
    lower.endsWith(".ico") ||
    lower.endsWith(".css") ||
    lower.endsWith(".js") ||
    lower.endsWith(".map") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".xml") ||
    lower.endsWith(".woff") ||
    lower.endsWith(".woff2") ||
    lower.endsWith(".ttf") ||
    lower.endsWith(".eot") ||
    lower.endsWith(".otf") ||
    lower.endsWith(".pdf") ||
    lower.endsWith(".zip")
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ Skip static assets immediately
  if (isStaticAssetPath(pathname)) {
    return NextResponse.next({ request: { headers: req.headers } });
  }

  // ✅ Never crash if env vars are missing (prevents 500/MIDDLEWARE_INVOCATION_FAILED)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    // Let the request continue; app can show a friendly error elsewhere if needed.
    return NextResponse.next({ request: { headers: req.headers } });
  }

  let res = NextResponse.next({ request: { headers: req.headers } });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    });

    // 🔑 Refreshes session cookies for server components
    await supabase.auth.getUser();
  } catch {
    // ✅ swallow errors so proxy never breaks prod traffic
    // (auth will just behave as "not signed in" for that request)
  }

  return res;
}

export const config = {
  matcher: [
    /**
     * Run broadly, but exclude Next internals via matcher.
     * Static files are also excluded again in code (belt & braces).
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
