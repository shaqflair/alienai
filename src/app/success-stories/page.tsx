import { Suspense } from "react";
import SuccessStoriesClient from "./success-stories-client";

export const runtime = "nodejs";

type SP = { [k: string]: string | string[] | undefined };

function asStr(x: any) {
  return typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "";
}

function clampDays(x: string) {
  const n = Number(x);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : 30;
}

function clampNullableNumberStr(x: string) {
  const s = String(x || "").trim();
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : "";
}

function safeCategory(x: string) {
  return String(x || "").trim().slice(0, 64);
}

export default function SuccessStoriesPage({ searchParams }: { searchParams: SP }) {
  const days = clampDays(asStr(searchParams?.days));
  const projectId = asStr(searchParams?.projectId);
  const category = safeCategory(asStr(searchParams?.category));
  const fv = clampNullableNumberStr(asStr(searchParams?.fv));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Success Stories</h1>
          <p className="mt-2 text-slate-500">
            Positive signals generated from your artifacts (Schedule, RAID, WBS, Change, Lessons).
          </p>
        </div>

        <Suspense fallback={
          <div className="flex items-center gap-2 text-slate-500">
            <div className="h-4 w-4 border-2 border-slate-300 border-t-slate-500 rounded-full animate-spin" />
            Loading…
          </div>
        }>
          <SuccessStoriesClient
            initialDays={days}
            initialProjectId={projectId}
            initialCategory={category}
            initialForecastVariance={fv}
          />
        </Suspense>
      </div>
    </div>
  );
}
