// src/app/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import HomePage from "@/components/home/HomePage";
import { getHomeData } from "@/lib/home/getHomeData";

export const runtime = "nodejs";

export default async function Page() {
  const supabase = await createClient();

  // 🔐 Check auth session FIRST
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // 🚨 If no session → go to login (prevents dashboard crash)
  if (error || !user) {
    redirect("/login");
  }

  // ✅ Only fetch dashboard data if authenticated
  const data = await getHomeData();

  // Optional safety: if backend returns not ok
  if (!data?.ok) {
    redirect("/login");
  }

  return <HomePage data={data} />;
}
