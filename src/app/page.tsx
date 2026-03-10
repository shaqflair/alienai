// src/app/page.tsx
import "server-only";

import { redirect } from "next/navigation";

import HomePage from "@/components/home/HomePage";
import { getHomeData } from "@/lib/home/getHomeData";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

export default async function Page() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/login");
  }

  const data = await getHomeData();

  if (!data?.ok) {
    redirect("/login");
  }

  return <HomePage data={data} />;
}