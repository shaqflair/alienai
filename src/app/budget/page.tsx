// src/app/budget/page.tsx
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import BudgetClient from "@/components/budget/BudgetClient";

export const dynamic = "force-dynamic";

export default async function BudgetPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  return <BudgetClient />;
}
