"use client";

import React, { useMemo, useState, useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Search,
  SlidersHorizontal,
  Download,
  Bell,
  Settings,
  X,
} from "lucide-react";
import {
  PortfolioFilters,
  DEFAULT_RANGE,
  filtersToSearchParams,
  searchParamsToFilters,
  hasActiveFilters,
} from "@/lib/portfolio/filters";

type Props = {
  title?: string;
  // optional: provide these if you already load them on the page
  projectOptions?: { id: string; name: string; code?: string | null }[];
  pmOptions?: { id: string; name: string }[];
  deptOptions?: { value: string; label: string }[];
  onExportCsv?: (filters: PortfolioFilters) => void; // hook export later
};

export default function OrgPortfolioTopBar({
  title = "Organisation Portfolio Overview",
  projectOptions = [],
  pmOptions = [],
  deptOptions = [],
  onExportCsv,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const filters = useMemo(() => {
    const f = searchParamsToFilters(new URLSearchParams(sp?.toString() || ""));
    return { range: DEFAULT_RANGE, ...f } as PortfolioFilters;
  }, [sp]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [qDraft, setQDraft] = useState(filters.q ?? "");

  const applyFilters = useCallback(
    (next: PortfolioFilters) => {
      const params = filtersToSearchParams({ range: DEFAULT_RANGE, ...next });
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname]
  );

  const clearAll = useCallback(() => {
    const params = filtersToSearchParams({ range: DEFAULT_RANGE });
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    setQDraft("");
  }, [router, pathname]);

  const active = hasActiveFilters(filters);

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-lg font-semibold text-slate-900">{title}</div>
        <div className="text-xs text-slate-500">
          Enterprise project portfolio overview
          {active ? " • filtered" : ""}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Range pills */}
        <div className="flex items-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 overflow-hidden">
          {(["7d", "14d", "30d", "60d"] as const).map((r) => (
            <button
              key={r}
              onClick={() => applyFilters({ ...filters, range: r })}
              className={[
                "px-3 py-1.5 text-xs font-medium",
                filters.range === r
                  ? "bg-slate-900 text-white"
                  : "text-slate-600 hover:bg-slate-50",
              ].join(" ")}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Icon group */}
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="hidden md:flex items-center gap-2 rounded-full bg-white shadow-sm ring-1 ring-slate-200 px-3 py-2">
            <Search className="h-4 w-4 text-slate-500" />
            <input
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters({ ...filters, q: qDraft });
                if (e.key === "Escape") setQDraft(filters.q ?? "");
              }}
              placeholder="Search projects, code, PM, dept…"
              className="w-[260px] bg-transparent text-sm outline-none placeholder:text-slate-400"
            />
            {qDraft ? (
              <button
                onClick={() => {
                  setQDraft("");
                  applyFilters({ ...filters, q: undefined });
                }}
                className="text-slate-400 hover:text-slate-700"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          <button
            onClick={() => setDrawerOpen(true)}
            className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <Search className="h-4 w-4" />
          </button>

          <button
            onClick={() => setDrawerOpen(true)}
            className={[
              "inline-flex h-10 w-10 items-center justify-center rounded-full shadow-sm ring-1",
              active
                ? "bg-slate-900 text-white ring-slate-900"
                : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
            ].join(" ")}
          >
            <SlidersHorizontal className="h-4 w-4" />
          </button>

          <button
            onClick={() => onExportCsv?.(filters)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
          </button>

          <button className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50">
            <Bell className="h-4 w-4" />
          </button>
          <button className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-200 text-slate-600 hover:bg-slate-50">
            <Settings className="h-4 w-4" />
          </button>
        </div>
      </div>

      {drawerOpen && (
        <FilterDrawer
          initial={filters}
          onClose={() => setDrawerOpen(false)}
          onApply={(next) => {
            applyFilters(next);
            setQDraft(next.q ?? "");
            setDrawerOpen(false);
          }}
          onClear={() => {
            clearAll();
            setDrawerOpen(false);
          }}
          projectOptions={projectOptions}
          pmOptions={pmOptions}
          deptOptions={deptOptions}
        />
      )}
    </div>
  );
}

function pill(on: boolean) {
  return on
    ? "bg-slate-900 text-white border-slate-900"
    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50";
}

function FilterDrawer({
  initial,
  onClose,
  onApply,
  onClear,
  projectOptions,
  pmOptions,
  deptOptions,
}: {
  initial: PortfolioFilters;
  onClose: () => void;
  onApply: (next: PortfolioFilters) => void;
  onClear: () => void;
  projectOptions: { id: string; name: string; code?: string | null }[];
  pmOptions: { id: string; name: string }[];
  deptOptions: { value: string; label: string }[];
}) {
  const [local, setLocal] = useState<PortfolioFilters>(initial);

  const toggle = (key: keyof PortfolioFilters, value: string) => {
    setLocal((prev) => {
      const arr = (prev[key] as string[] | undefined) ?? [];
      const exists = arr.includes(value);
      const nextArr = exists ? arr.filter((x) => x !== value) : [...arr, value];
      return { ...prev, [key]: nextArr.length ? nextArr : undefined };
    });
  };

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[420px] bg-white shadow-2xl ring-1 ring-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Filters</div>
            <div className="text-xs text-slate-500">Filter the organisational view.</div>
          </div>
          <button onClick={onClose} className="h-9 w-9 rounded-full ring-1 ring-slate-200 flex items-center justify-center">
            <X className="h-4 w-4 text-slate-600" />
          </button>
        </div>

        <div className="p-4 space-y-5 overflow-auto flex-1">
          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">Search</div>
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 px-3 py-2">
              <Search className="h-4 w-4 text-slate-500" />
              <input
                value={local.q ?? ""}
                onChange={(e) => setLocal((p) => ({ ...p, q: e.target.value }))}
                placeholder="Project name, code..."
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-slate-700 mb-2">Projects</div>
            <div className="flex flex-wrap gap-2">
              {projectOptions.map((p) => (
                <button
                  key={p.id}
                  onClick={() => toggle("projectIds", p.id)}
                  className={["px-3 py-1.5 rounded-full text-xs border", pill((local.projectIds ?? []).includes(p.id))].join(" ")}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-slate-200 flex items-center justify-between">
          <button onClick={onClear} className="px-3 py-2 text-sm rounded-xl ring-1 ring-slate-200 hover:bg-slate-50">Clear</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-2 text-sm rounded-xl ring-1 ring-slate-200 hover:bg-slate-50">Cancel</button>
            <button onClick={() => onApply(local)} className="px-4 py-2 text-sm rounded-xl bg-slate-900 text-white">Apply</button>
          </div>
        </div>
      </div>
    </div>
  );
}
