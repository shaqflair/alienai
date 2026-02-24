// src/proxy.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

function isStaticAssetPath(pathname: string) {
  if (pathname.startsWith("/_next/")) return true;

  if (
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.json"
  ) return true;

  if (
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/icons/") ||
    pathname.startsWith("/fonts/")
  ) return true;

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

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ✅ Never crash if env vars are missing (prevents 500/MIDDLEWARE_INVOCATION_FAILED)
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

    // 🔑 Refreshes session cookies for server components
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
    // ✅ exclude /api for perf & reduced side effects
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};