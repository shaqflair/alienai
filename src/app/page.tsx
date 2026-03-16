import "server-only";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import HomePage from "@/components/home/HomePage";
import { getHomeData } from "@/lib/home/getHomeData";
import LandingPage from "./landing/page";

export const runtime = "nodejs";

export default async function Page() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  // 1. Not logged in -- show landing page
  if (error || !user) {
    return <LandingPage />;
  }

  // 2. Logged in -- fetch dashboard data
  const data = await getHomeData();
  
  // 3. Handle data fetch failure (e.g., expired session or profile missing)
  if (!data?.ok) {
    redirect("/login");
  }

  // 4. Show the authenticated Home/Dashboard view
  return (
    <Suspense fallback={null}>
      <HomePage data={data} />
    </Suspense>
  );
}
