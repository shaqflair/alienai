// src/app/change/page.tsx
import "server-only";

import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChangeRootPage() {
  // ✅ Never render old/global change UI.
  // Portfolio view is /changes, project kanban is /projects/[id]/change
  redirect("/changes");
}