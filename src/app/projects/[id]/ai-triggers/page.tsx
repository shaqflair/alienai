import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import AiTriggersClient from "./AiTriggersClient";

export default async function AiTriggersPage({ params }: { params: { id: string } }) {
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
  const canEdit = role === "owner" || role === "admin";

  return <AiTriggersClient projectId={projectId} canEdit={canEdit} />;
}