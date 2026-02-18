// src/app/wbs/items/page.tsx
import "server-only";

import WbsItemsClient, { type Bucket, type DaysParam, type StatusFilter } from "./WbsItemsClient";

export const runtime = "nodejs";

function firstStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function clampDaysParam(x: unknown): DaysParam {
  const s = String(firstStr(x) ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  if (!Number.isFinite(n) || !allowed.has(n)) return 30;
  return n as 7 | 14 | 30 | 60;
}

function clampBucket(x: unknown): Bucket {
  const s = String(firstStr(x) ?? "").trim();
  const allowed = new Set(["", "overdue", "due_7", "due_14", "due_30", "due_60"]);
  return allowed.has(s) ? (s as Bucket) : "";
}

function clampStatus(x: unknown): StatusFilter {
  const s = String(firstStr(x) ?? "").trim().toLowerCase();
  if (s === "open") return "open";
  if (s === "done") return "done";
  return "";
}

export default function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const initialDays = clampDaysParam(searchParams?.days);
  const initialBucket = clampBucket(searchParams?.bucket);
  const initialStatus = clampStatus(searchParams?.status);
  const initialMissingEffort = firstStr(searchParams?.missingEffort) === "1";
  const initialQ = firstStr(searchParams?.q).trim();

  return (
    <WbsItemsClient
      initialDays={initialDays}
      initialBucket={initialBucket}
      initialStatus={initialStatus}
      initialMissingEffort={initialMissingEffort}
      initialQ={initialQ}
    />
  );
}
