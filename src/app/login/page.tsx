// src/app/login/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import AuthForm from "@/components/AuthForm";

type SP = { next?: string };

export const runtime = "nodejs";

function safeNext(x: unknown) {
  const v = typeof x === "string" ? x : "";
  if (!v) return "/projects";
  if (v.startsWith("http://") || v.startsWith("https://")) return "/projects";
  if (!v.startsWith("/")) return "/projects";
  return v;
}

export default async function AuthPage({
  searchParams,
}: {
  searchParams?: Promise<SP> | SP;
}) {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getUser();

  const sp = (await searchParams) ?? {};
  const nextUrl = safeNext(sp.next);

  // If already logged in, go to destination
  if (!error && data?.user) redirect(nextUrl);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <AuthForm next={nextUrl} />
    </div>
  );
}
