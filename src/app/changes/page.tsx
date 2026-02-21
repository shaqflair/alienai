// src/app/changes/page.tsx
import "server-only";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default function ChangesAliasPage({
  searchParams,
}: {
  searchParams?: { project?: string | string[] };
}) {
  const raw = searchParams?.project;
  const project =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
      ? raw[0]
      : "";

  const clean = safeStr(project).trim();

  // ✅ If a project is supplied → go to Kanban
  if (clean) {
    redirect(`/projects/${encodeURIComponent(clean)}/change`);
  }

  // ✅ Otherwise go to projects list
  redirect("/projects");
}