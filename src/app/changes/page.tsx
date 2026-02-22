// src/app/changes/page.tsx
import "server-only";

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

  return <ChangesClient initialQ={q} initialPriority={priority} initialStale={stale} />;
}