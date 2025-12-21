"use server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export async function generatePID(projectId: string) {
  if (!projectId) return;

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();

  if (!auth?.user) redirect("/login");

  await supabase.from("artifacts").insert({
    project_id: projectId,
    user_id: auth.user.id,
    type: "PID",
    content: "Placeholder PID content – AI will generate this later.",
  });
}
