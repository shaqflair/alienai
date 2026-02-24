// src/proxy.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/** Fast allowlist for paths that never need auth cookie refresh */
function isStaticAssetPath(pathname: string) {
  if (pathname.startsWith("/_next/")) return true;

  if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json"
  )
    return true;

  if (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/fonts/")
  )
    return true;

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
    lower.endsWith(".mjs") ||
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

/** Conservative check: only refresh for typical page navigations */
function shouldRefreshSession(req: NextRequest) {
  // Only GET/HEAD should ever matter here
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  // Next prefetches can be very chatty; skip for perf
  // (header used by Next Router for prefetch)
  if (req.headers.get("x-middleware-prefetch") === "1") return false;

  // If Accept header doesn't include HTML, likely an asset/data request
  const accept = (req.headers.get("accept") || "").toLowerCase();
  if (accept && !accept.includes("text/html") && !accept.includes("*/*")) return false;

  return true;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ Skip static assets immediately
  if (isStaticAssetPath(pathname)) {
    return NextResponse.next({ request: { headers: req.headers } });
  }

  // ✅ Skip non-page-like requests for perf
  if (!shouldRefreshSession(req)) {
    return NextResponse.next({ request: { headers: req.headers } });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ✅ Never crash if env vars are missing (prevents 500 / invocation failures)
  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[proxy] Supabase env missing; skipping session refresh");
    }
    return NextResponse.next({ request: { headers: req.headers } });
  }

  if (
    process.env.NODE_ENV === "production" &&
    supabaseUrl.startsWith("http://")
  ) {
    console.warn(
      "[proxy] Supabase URL is http in production; cookies may be insecure"
    );
  }

  const res = NextResponse.next({ request: { headers: req.headers } });

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    });

    // 🔑 Refresh session cookies for server components
    await supabase.auth.getUser();
  } catch {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[proxy] session refresh failed");
    }
  }

  return res;
}

export const config = {
  matcher: [
    // ✅ Exclude: /api, all Next internals, and common public files
    "/((?!api/|_next/|favicon.ico|robots.txt|sitemap.xml|manifest.json).*)",
  ],
};