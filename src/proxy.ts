// src/proxy.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function hasSupabaseEnv() {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function isStaticPath(pathname: string) {
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/robots.txt") ||
    pathname.startsWith("/sitemap") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/images/")
  ) {
    return true;
  }

  // common static file extensions
  if (/\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml|woff2?|ttf|eot)$/i.test(pathname)) {
    return true;
  }

  return false;
}

function isHtmlNavigation(req: NextRequest) {
  // Only run session refresh for actual document navigations.
  // This avoids touching API/json/assets and reduces edge overhead.
  const accept = (req.headers.get("accept") || "").toLowerCase();
  const secFetchDest = (req.headers.get("sec-fetch-dest") || "").toLowerCase();

  if (secFetchDest === "document") return true;
  if (accept.includes("text/html")) return true;

  return false;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ✅ Skip assets entirely
  if (isStaticPath(pathname)) return NextResponse.next();

  // ✅ If Supabase env is missing, don't blow up production
  if (!hasSupabaseEnv()) return NextResponse.next();

  // ✅ Only refresh session cookies for HTML page navigations
  if (!isHtmlNavigation(req)) return NextResponse.next();

  let res = NextResponse.next({
    request: { headers: req.headers },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value, options } of cookiesToSet) {
            res.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // 🔑 Refresh session cookies for server components
  await supabase.auth.getUser();

  return res;
}

export const config = {
  matcher: [
    // Apply broadly, but we do our own skipping for assets internally.
    "/:path*",
  ],
};
