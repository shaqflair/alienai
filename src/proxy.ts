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
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  if (req.headers.get("x-middleware-prefetch") === "1") return false;
  const accept = (req.headers.get("accept") || "").toLowerCase();
  if (accept && !accept.includes("text/html") && !accept.includes("*/*")) return false;
  return true;
}

/** Paths that should never trigger the onboarding gate */
function isOnboardingExempt(pathname: string) {
  return (
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/login") ||
    pathname.startsWith("/auth") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/organisations/invite")
  );
}

// Cookie name -- set after onboarding completes so DB is not hit every request
const ONBOARDING_DONE_COOKIE = "aliena_onboarding_done";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip static assets immediately
  if (isStaticAssetPath(pathname)) {
    return NextResponse.next({ request: { headers: req.headers } });
  }

  // Skip non-page-like requests
  if (!shouldRefreshSession(req)) {
    return NextResponse.next({ request: { headers: req.headers } });
  }

  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[proxy] Supabase env missing; skipping session refresh");
    }
    return NextResponse.next({ request: { headers: req.headers } });
  }

  if (process.env.NODE_ENV === "production" && supabaseUrl.startsWith("http://")) {
    console.warn("[proxy] Supabase URL is http in production; cookies may be insecure");
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

    // Refresh session cookies for server components
    const { data: { user } } = await supabase.auth.getUser();

    // -- Onboarding gate ------------------------------------------------------
    // Only runs for logged-in users on non-exempt page routes.
    // Uses a cookie to avoid a DB hit on every request once onboarding is done.
    if (user && !isOnboardingExempt(pathname)) {

      // If the cookie says onboarding is complete, skip DB check entirely
      const doneCookie = req.cookies.get(ONBOARDING_DONE_COOKIE)?.value;
      if (doneCookie === user.id) {
        // Already onboarded -- pass through
        return res;
      }

      // Check the profile for job_title (the completion signal)
      const { data: profile } = await supabase
        .from("profiles")
        .select("job_title")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!profile?.job_title) {
        // Profile incomplete -- redirect to onboarding
        const url = req.nextUrl.clone();
        url.pathname = "/onboarding";
        return NextResponse.redirect(url);
      }

      // Profile complete -- set the cookie so we skip DB next time (30 days)
      res.cookies.set(ONBOARDING_DONE_COOKIE, user.id, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 30,
        path: "/",
      });
    }
    // -- End onboarding gate --------------------------------------------------

  } catch {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[proxy] session refresh failed");
    }
  }

  return res;
}

export const config = {
  matcher: [
    "/((?!api/|_next/|favicon.ico|robots.txt|sitemap.xml|manifest.json).*)",
  ],
};