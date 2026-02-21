// src/app/change/new/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeForm from "@/components/change/ChangeForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default function NewChangePage({
  searchParams,
}: {
  searchParams?: { projectId?: string; artifactId?: string; pid?: string; aid?: string };
}) {
  const projectId = safeStr(searchParams?.projectId || searchParams?.pid).trim();
  const artifactId = safeStr(searchParams?.artifactId || searchParams?.aid).trim();

  // ✅ If no project is provided, send user to pick a project
  if (!projectId) {
    redirect("/projects");
  }

  return (
    <main className="crPage">
      <ChangeHeader title="New Change Request" subtitle="Create a clean, decision-ready CR" />

      <ChangeForm mode="create" projectId={projectId} artifactId={artifactId || undefined} />
    </main>
  );
}