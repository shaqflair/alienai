// src/app/change/page.tsx
import "server-only";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChangeRootPage() {
  // ✅ Never show legacy/global change UI.
  // Portfolio lives at /changes, project Kanban at /projects/[id]/change
  redirect("/changes");
}