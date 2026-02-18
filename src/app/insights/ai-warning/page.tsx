// src/app/insights/ai-warning/page.tsx
import "server-only";

import AiWarningClient from "./AiWarningClient";

export const runtime = "nodejs";

function firstStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function clampDays(x: unknown, fallback = 30): 7 | 14 | 30 | 60 {
  const n = Number(firstStr(x));
  const allowed = new Set([7, 14, 30, 60]);
  if (!Number.isFinite(n) || !allowed.has(n)) return fallback as any;
  return n as any;
}

export default function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const days = clampDays(searchParams?.days, 30);
  return <AiWarningClient days={days} />;
}
