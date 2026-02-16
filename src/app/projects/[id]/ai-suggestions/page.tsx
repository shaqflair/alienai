import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import AiSuggestionsClient from "./AiSuggestionsClient";

export default async function AiSuggestionsPage({
  params,
}: {
  params: { id: string };
}) {
  const projectId = params.id;
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) notFound();

  const { data: mem } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!mem) notFound();

  const role = String(mem.role ?? "").toLowerCase();
  const canAct = role === "owner" || role === "admin" || role === "editor";

  return <AiSuggestionsClient projectId={projectId} canAct={canAct} />;
}
