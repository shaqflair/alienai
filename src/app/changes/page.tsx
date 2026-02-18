// src/app/changes/page.tsx
import "server-only";

import ChangesClient from "./ChangesClient";

export const runtime = "nodejs";

function firstStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function truthy1(x: unknown): boolean {
  const s = firstStr(x).trim();
  return s === "1" || s.toLowerCase() === "true" || s.toLowerCase() === "yes";
}

export default function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const initialQ = firstStr(searchParams?.q);
  const initialPriority = firstStr(searchParams?.priority); // e.g. "High,Critical"
  const initialStale = truthy1(searchParams?.stale);

  return (
    <ChangesClient
      initialQ={initialQ}
      initialPriority={initialPriority}
      initialStale={initialStale}
    />
  );
}
