// src/app/wbs/stats/page.tsx
import "server-only";

import WbsStatsClient from "./WbsStatsClient";

export const runtime = "nodejs";

type DaysParam = 7 | 14 | 30 | 60 | "all";

function firstStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function clampDays(x: unknown, fallback: DaysParam = 30): DaysParam {
  const s = String(firstStr(x) ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  if (!Number.isFinite(n) || !allowed.has(n)) return fallback;
  return n as 7 | 14 | 30 | 60;
}

export default function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const initialDays = clampDays(searchParams?.days, 30);

  return <WbsStatsClient initialDays={initialDays} />;
}
