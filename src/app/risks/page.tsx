// src/app/risks/page.tsx
import "server-only";

import RisksClient from "./RisksClient";

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

function safeScope(x: unknown): "window" | "overdue" | "all" {
  const v = String(firstStr(x) || "").toLowerCase();
  if (v === "window" || v === "overdue" || v === "all") return v as any;
  return "all";
}

function safeStatusUi(x: unknown): "all" | "open" | "in_progress" | "mitigated" | "closed" | "invalid" {
  const v = String(firstStr(x) || "").toLowerCase();
  const ok = new Set(["all", "open", "in_progress", "mitigated", "closed", "invalid"]);
  return (ok.has(v) ? v : "all") as any;
}

function safeTypeUi(x: unknown): "all" | "Risk" | "Issue" | "Assumption" | "Dependency" {
  const v = String(firstStr(x) || "");
  const ok = new Set(["all", "Risk", "Issue", "Assumption", "Dependency"]);
  return (ok.has(v) ? v : "all") as any;
}

export default function Page({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const initialWindowDays = clampDays(searchParams?.window, 30);
  const initialScope = safeScope(searchParams?.scope);
  const initialType = safeTypeUi(searchParams?.type ?? "all");
  const initialStatus = safeStatusUi(searchParams?.status ?? "all");

  return (
    <RisksClient
      initialWindowDays={initialWindowDays}
      initialScope={initialScope}
      initialType={initialType}
      initialStatus={initialStatus}
    />
  );
}
