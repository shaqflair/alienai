// src/app/auth/callback/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeNext(x: string | null) {
  if (!x) return "/";
  if (x.startsWith("http://") || x.startsWith("https://")) return "/";
  if (!x.startsWith("/")) return "/";
  return x;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const code  = url.searchParams.get("code");
  const next  = safeNext(url.searchParams.get("next"));
  const type  = url.searchParams.get("type"); // "invite", "recovery", "magiclink" etc

  // If no code, send back to login
  if (!code) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", next);
    return NextResponse.redirect(login);
  }

  // For invite/recovery flows, always land on set-password page
  const isInvite   = type === "invite";
  const isRecovery = type === "recovery";
  const landingPath = (isInvite || isRecovery) ? "/auth/reset" : next;

  const res = NextResponse.redirect(new URL(landingPath, url.origin));
  const supabase = await createClient({ req, res } as any);

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const login = new URL("/login", url.origin);
    login.searchParams.set("next", next);
    login.searchParams.set("err", "auth_callback_failed");
    return NextResponse.redirect(login);
  }

  // If user has never confirmed email (invite flow) — send to set password
  // last_sign_in_at will be null or very recent (just now) for brand new users
  const isFirstLogin = !data?.user?.last_sign_in_at ||
    data?.user?.app_metadata?.provider === "email" && !data?.user?.confirmed_at;

  if (isFirstLogin || isInvite || isRecovery) {
    return NextResponse.redirect(new URL("/auth/reset", url.origin));
  }

  return res;
}