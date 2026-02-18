// src/proxy.ts
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * 🔐 Production-safe Supabase session refresh proxy (Next 16)
 *
 * Goals:
 * - Never crash → prevents Vercel MIDDLEWARE_INVOCATION_FAILED
 * - Skip static assets + heavy routes for performance
 * - Refresh Supabase session only when needed
 */

function envStr(x: unknown) {
  return typeof x === "string" ? x.trim() : "";
}

/**
 * Routes we NEVER want auth refresh on
 * (static assets, exports, heavy API)
 */
function shouldSkip(req: NextRequest) {
  const path = req.nextUrl.pathname;

  // Static + Next internals
  if (
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||
    path.startsWith("/images") ||
    path.startsWith("/icons") ||
    path.startsWith("/public")
  ) return true;

  // File extensions (fast skip)
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|xml)$/i.test(path))
    return true;

  // Heavy exports / binary routes
  if (
    path.startsWith("/api/export") ||
    path.includes("/export/") ||
    path.includes("/download")
  ) return true;

  return false;
}

export async function proxy(req: NextRequest) {
  const res = NextResponse.next({ request: { headers: req.headers } });

  try {
    // 🚀 Skip static & heavy routes completely
    if (shouldSkip(req)) return res;

    const supabaseUrl = envStr(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const supabaseAnon = envStr(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

    // If env missing → don't crash whole site
    if (!supabaseUrl || !supabaseAnon) {
      console.warn("[proxy] Supabase env missing — skipping refresh");
      return res;
    }

    const supabase = createServerClient(supabaseUrl, supabaseAnon, {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => {
            res.cookies.set(name, value, options);
          });
        },
      },
    });

    // 🔑 Refresh session silently
    await supabase.auth.getUser();

    return res;
  } catch (err: any) {
    // NEVER crash middleware/proxy
    console.error("[proxy] session refresh failed:", err?.message || err, {
      path: req.nextUrl.pathname,
    });

    return res;
  }
}

/**
 * Matcher:
 * Run everywhere except static/image/favicon
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
