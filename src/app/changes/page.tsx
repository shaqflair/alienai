// src/app/changes/page.tsx
import "server-only";

import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ChangesAliasPage() {
  redirect("/change");
}
