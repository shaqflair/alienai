// src/app/changes/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import ChangesClient from "./ChangesClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default function ChangesPage({
  searchParams,
}: {
  searchParams?: { [k: string]: string | string[] | undefined };
}) {
  const q = safeStr(searchParams?.q).trim();
  const priority = safeStr(searchParams?.priority).trim();
  const stale = safeStr(searchParams?.stale).trim() === "1";

  // If you want to force auth-only pages, do it here; otherwise render.
  // (Keeping it simple: render the client)
  return <ChangesClient initialQ={q} initialPriority={priority} initialStale={stale} />;
}