// src/app/auth/callback/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeNext(x: string | null) {
  // prevent open redirects
  if (!x) return "/projects";
  if (x.startsWith("http://") || x.startsWith("https://")) return "/projects";
  if (!x.startsWith("/")) return "/projects";
  return x;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  // If no code, send back to login
  if (!code) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  // IMPORTANT: create the response FIRST so cookie writes attach to it
  const res = NextResponse.redirect(new URL(next, url.origin));

  // Your createClient() should be implemented to read req cookies and
  // write updated cookies onto the provided response (Supabase SSR pattern).
  const supabase = await createClient({ req, res } as any);

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  // If exchange fails, go back to login
  if (error) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", next);
    login.searchParams.set("err", "auth_callback_failed");
    return NextResponse.redirect(login);
  }

  return res;
}
