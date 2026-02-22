// src/app/projects/[id]/changes/page.tsx
import { redirect } from "next/navigation";

/**
 * CHANGE ROUTE COMPATIBILITY SHIM
 *
 * Old UI + global list links still point to:
 *   /projects/:id/changes   (plural)
 *
 * Real board lives at:
 *   /projects/:id/change    (singular)
 *
 * This file prevents 404 and keeps all links working.
 */

export default async function ChangesRedirectPage({
  params,
}: {
  params: { id: string };
}) {
  const projectId = params?.id;

  if (!projectId) {
    redirect("/projects");
  }

  // ✅ Always redirect to real Kanban board
  redirect(`/projects/${projectId}/change`);
}