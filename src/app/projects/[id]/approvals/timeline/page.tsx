// src/app/projects/[id]/approvals/timeline/page.tsx
import "server-only";

import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ApprovalTimeline from "@/components/approvals/ApprovalTimeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default async function ApprovalTimelinePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { artifactId?: string; changeId?: string };
}) {
  const supabase = await createClient();

  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) notFound();

  // Your app resolves [id] as uuid or project_code elsewhere.
  // For this page we assume it's already UUID. If you use codes, you can swap in your resolver.
  const projectId = safeStr(params.id);
  if (!projectId) notFound();

  const artifactId = safeStr(searchParams?.artifactId || "");
  const changeId = safeStr(searchParams?.changeId || "");

  return (
    <div className="p-6">
      <div className="mb-4">
        <div className="text-lg font-semibold text-slate-900">Approvals</div>
        <div className="text-sm text-slate-600">
          Timeline view (project: <span className="font-medium">{projectId}</span>)
        </div>
      </div>

      <ApprovalTimeline
        projectId={projectId}
        artifactId={artifactId || null}
        changeId={changeId || null}
      />
    </div>
  );
}