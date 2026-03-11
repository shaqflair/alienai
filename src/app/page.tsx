// src/app/page.tsx
import "server-only";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import HomePage from "@/components/home/HomePage";
import { getHomeData } from "@/lib/home/getHomeData";
export const runtime = "nodejs";
export default async function Page() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  const data = await getHomeData();
  if (!data?.ok) return <pre style={{color:"red",padding:"2rem"}}>{JSON.stringify(data,null,2)}</pre>;
  return (
    <Suspense fallback={null}>
      <HomePage data={data} />
    </Suspense>
  );
}
