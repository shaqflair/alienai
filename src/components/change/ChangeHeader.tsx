// src/components/change/ChangeHeader.tsx
"use client";

import React from "react";
import Link from "next/link";

export default function ChangeHeader({
  title,
  subtitle,
  kicker,
  backHref,
  rightSlot,
  projectCode,
}: {
  title: string;
  subtitle?: string;
  kicker?: string;
  backHref?: string;
  rightSlot?: React.ReactNode;
  projectCode?: string;
}) {
  const cleanProjectCode =
    typeof projectCode === "string" && projectCode.trim() ? projectCode.trim() : "";

  return (
    <header className="rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 px-6 py-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            {kicker ? (
              <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                {kicker}
              </span>
            ) : null}

            {cleanProjectCode ? (
              <span className="inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                {cleanProjectCode}
              </span>
            ) : null}
          </div>

          <div className="mt-3">
            <h1 className="text-2xl font-bold tracking-tight text-slate-950">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm text-slate-600">{subtitle}</p> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 md:justify-end">
          {rightSlot ? <div className="flex flex-wrap items-center gap-3">{rightSlot}</div> : null}

          {backHref ? (
            <Link
              href={backHref}
              className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-950"
            >
              ← Back
            </Link>
          ) : null}
        </div>
      </div>
    </header>
  );
}