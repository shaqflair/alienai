"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type DaysParam = 7 | 14 | 30 | 60 | "all";
type Bucket = "overdue" | "due_7" | "due_14" | "due_30" | "due_60" | "";
type StatusFilter = "open" | "done" | "";

type WbsItemRow = {
  // identifiers (kept for linking / debug, but NOT shown in UI)
  project_id?: string | null;
  artifact_id?: string | null;
  wbs_row_id?: string | null;

  // display
  title?: string | null; // work package name/title
  project_title?: string | null;

  // ✅ human project id (project_code)
  project_code?: string | number | null;

  owner_label?: string | null;

  due_date?: string | null; // ISO string
  status?: string | null; // "done" | "open" etc

  missing_effort?: boolean | null;
};

type ApiResp =
  | { ok: false; error: string; meta?: any }
  | {
      ok: true;
      items: WbsItemRow[];
      nextCursor?: string | null;
      meta?: any;
    };

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampDaysParam(x: string | null): DaysParam {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  if (!Number.isFinite(n) || !allowed.has(n)) return 30;
  return n as 7 | 14 | 30 | 60;
}

function clampBucket(x: string | null): Bucket {
  const s = String(x ?? "").trim();
  const allowed = new Set(["", "overdue", "due_7", "due_14", "due_30", "due_60"]);
  return allowed.has(s) ? (s as Bucket) : "";
}

function clampStatus(x: string | null): StatusFilter {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "open") return "open";
  if (s === "done") return "done";
  return "";
}

function ukDate(iso?: string | null) {
  const s = safeStr(iso).trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d); // dd/MM/yyyy
}

function buildHref(params: Record<string, any>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  const qs = sp.toString();
  return qs ? `/wbs/items?${qs}` : "/wbs/items";
}

function chipClass(active: boolean) {
  return [
    "rounded-full border px-3 py-1.5 text-sm transition",
    active
      ? "border-gray-900 bg-gray-900 text-white"
      : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
  ].join(" ");
}

function FlagPill({ label, tone }: { label: string; tone: "open" | "done" | "warn" | "info" }) {
  const base = "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold";
  if (tone === "done") return <span className={`${base} border-emerald-200 bg-emerald-50 text-emerald-800`}>{label}</span>;
  if (tone === "open") return <span className={`${base} border-sky-200 bg-sky-50 text-sky-800`}>{label}</span>;
  if (tone === "warn") return <span className={`${base} border-amber-200 bg-amber-50 text-amber-800`}>{label}</span>;
  return <span className={`${base} border-gray-200 bg-gray-50 text-gray-700`}>{label}</span>;
}

export default function WbsItemsPage() {
  const sp = useSearchParams();

  const days = useMemo(() => clampDaysParam(sp.get("days")), [sp]);
  const bucket = useMemo(() => clampBucket(sp.get("bucket")), [sp]);
  const status = useMemo(() => clampStatus(sp.get("status")), [sp]);
  const missingEffort = useMemo(() => sp.get("missingEffort") === "1", [sp]);
  const q = useMemo(() => safeStr(sp.get("q")).trim(), [sp]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [items, setItems] = useState<WbsItemRow[]>([]);

  async function load() {
    setLoading(true);
    setErr("");

    try {
      const url = buildHref({
        days,
        bucket: bucket || undefined,
        status: status || undefined,
        missingEffort: missingEffort ? 1 : undefined,
        q: q || undefined,
      }).replace("/wbs/items", "/api/wbs/items");

      const r = await fetch(url, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as ApiResp | null;

      if (!r.ok) throw new Error((j as any)?.error || `Request failed (${r.status})`);
      if (!j || (j as any).ok !== true) throw new Error((j as any)?.error || "Invalid response");

      setItems((j as any).items || []);
    } catch (e: any) {
      setItems([]);
      setErr(e?.message || "Failed to load WBS items");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, bucket, status, missingEffort, q]);

  const title = useMemo(() => {
    if (bucket === "overdue") return "Overdue work packages";
    if (bucket === "due_7") return "Due in 7 days";
    if (bucket === "due_14") return "Due in 14 days";
    if (bucket === "due_30") return "Due in 30 days";
    if (bucket === "due_60") return "Due in 60 days";
    if (missingEffort) return "Missing effort";
    if (status === "done") return "Completed work packages";
    if (status === "open") return "Open work packages";
    return "All work packages";
  }, [bucket, missingEffort, status]);

  const subtitle = useMemo(() => {
    const d = days === "all" ? "All" : `${days} days`;
    const parts = [`Window: ${d}`];
    if (q) parts.push(`Search: “${q}”`);
    return parts.join(" • ");
  }, [days, q]);

  return (
    <div className="min-h-[calc(100vh-64px)] bg-white text-gray-900 font-['Inter','system-ui',sans-serif]">
      <div className="mx-auto max-w-7xl px-6 py-10">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm md:text-base text-gray-600">{subtitle}</p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              className="border-gray-300 text-gray-700 hover:bg-gray-50"
              onClick={load}
              disabled={loading}
            >
              Refresh
            </Button>

            <Link
              href={`/wbs/pulse?days=${encodeURIComponent(String(days))}`}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              title="Back to WBS pulse"
            >
              Pulse <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-gray-900">Window:</span>

              <Link href={buildHref({ ...Object.fromEntries(sp.entries()), days: "all" })} className={chipClass(days === "all")}>
                All
              </Link>

              {[7, 14, 30, 60].map((d) => (
                <Link
                  key={d}
                  href={buildHref({ ...Object.fromEntries(sp.entries()), days: d })}
                  className={chipClass(days === d)}
                >
                  {d}d
                </Link>
              ))}

              <span className="mx-2 h-5 w-px bg-gray-200" />

              <span className="text-sm font-semibold text-gray-900">Quick:</span>

              <Link href={buildHref({ days, bucket: "overdue" })} className={chipClass(bucket === "overdue")}>
                Overdue
              </Link>

              <Link href={buildHref({ days, bucket: "due_7" })} className={chipClass(bucket === "due_7")}>
                Due 7d
              </Link>

              <Link href={buildHref({ days, bucket: "due_14" })} className={chipClass(bucket === "due_14")}>
                Due 14d
              </Link>

              <Link href={buildHref({ days, bucket: "due_30" })} className={chipClass(bucket === "due_30")}>
                Due 30d
              </Link>

              <Link href={buildHref({ days, bucket: "due_60" })} className={chipClass(bucket === "due_60")}>
                Due 60d
              </Link>

              <Link href={buildHref({ days, missingEffort: 1 })} className={chipClass(missingEffort)}>
                Missing effort
              </Link>

              <span className="mx-2 h-5 w-px bg-gray-200" />

              <Link href={buildHref({ days, status: "open" })} className={chipClass(status === "open")}>
                Open
              </Link>
              <Link href={buildHref({ days, status: "done" })} className={chipClass(status === "done")}>
                Done
              </Link>

              {(bucket || status || missingEffort || q) ? (
                <Link
                  href={buildHref({ days })}
                  className="ml-1 inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  title="Clear filters"
                >
                  <X className="h-4 w-4" />
                  Clear
                </Link>
              ) : null}
            </div>

            <div className="relative w-full md:w-[360px]">
              <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Search className="h-4 w-4" />
              </div>
              <input
                className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-900"
                placeholder="Search work package / project…"
                defaultValue={q}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  const v = (e.target as HTMLInputElement).value.trim();
                  const href = buildHref({
                    days,
                    bucket: bucket || undefined,
                    status: status || undefined,
                    missingEffort: missingEffort ? 1 : undefined,
                    q: v || undefined,
                  });
                  window.location.href = href;
                }}
              />
              <div className="mt-1 text-xs text-gray-500">Press Enter to search</div>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-10 text-center text-gray-600">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading…
              </span>
            </div>
          ) : err ? (
            <div className="p-6 text-rose-800 bg-rose-50 border-t border-rose-200">{err}</div>
          ) : items.length === 0 ? (
            <div className="p-10 text-center text-gray-600">No items match your filters.</div>
          ) : (
            <div className="w-full overflow-x-auto">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-gray-50 text-gray-700">
                  <tr className="text-left">
                    <th className="px-6 py-4 font-semibold">Work package</th>
                    <th className="px-6 py-4 font-semibold">Project ID</th>
                    <th className="px-6 py-4 font-semibold">Project</th>
                    <th className="px-6 py-4 font-semibold">Owner</th>
                    <th className="px-6 py-4 font-semibold">Due</th>
                    <th className="px-6 py-4 font-semibold">Flags</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {items.map((it, idx) => {
                    const wp = safeStr(it.title).trim() || "Work package";
                    const projTitle = safeStr(it.project_title).trim() || "—";
                    const projCode = it.project_code == null ? "" : String(it.project_code);

                    const due = ukDate(it.due_date);
                    const st = safeStr(it.status).toLowerCase();
                    const isDone = st === "done" || st === "closed" || st === "complete" || st === "completed";

                    // ✅ keyed flags (fixes React warning)
                    const flags: { key: string; node: React.ReactNode }[] = [];
                    flags.push({
                      key: isDone ? "status-done" : "status-open",
                      node: <FlagPill label={isDone ? "Done" : "Open"} tone={isDone ? "done" : "open"} />,
                    });
                    if (it.missing_effort) {
                      flags.push({
                        key: "missing-effort",
                        node: <FlagPill label="Missing effort" tone="warn" />,
                      });
                    }

                    const canOpen = !!(it.project_id && it.artifact_id);
                    const openHref = canOpen
                      ? `/projects/${it.project_id}/artifacts/${it.artifact_id}?focus=wbs&row=${encodeURIComponent(
                          safeStr(it.wbs_row_id)
                        )}`
                      : null;

                    return (
                      <tr
                        key={`${safeStr(it.project_id)}:${safeStr(it.artifact_id)}:${safeStr(it.wbs_row_id)}:${idx}`}
                        className="hover:bg-gray-50/60"
                      >
                        <td className="px-6 py-4">
                          <div className="font-semibold text-gray-900">{wp}</div>
                          {openHref ? (
                            <div className="mt-2">
                              <Link
                                href={openHref}
                                className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700 hover:text-gray-900"
                                title="Open in WBS"
                              >
                                Open <ArrowUpRight className="h-3.5 w-3.5" />
                              </Link>
                            </div>
                          ) : null}
                        </td>

                        <td className="px-6 py-4 text-gray-700">
                          {projCode ? <span className="font-semibold">{projCode}</span> : <span className="text-gray-400">—</span>}
                        </td>

                        <td className="px-6 py-4">
                          <div className="font-semibold text-gray-900">{projTitle}</div>
                        </td>

                        <td className="px-6 py-4 text-gray-700">
                          {safeStr(it.owner_label).trim() ? safeStr(it.owner_label).trim() : <span className="text-gray-400">—</span>}
                        </td>

                        <td className="px-6 py-4 text-gray-700">
                          {due ? <span className="font-semibold">{due}</span> : <span className="text-gray-400">No due date</span>}
                        </td>

                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            {flags.map((f) => (
                              <React.Fragment key={f.key}>{f.node}</React.Fragment>
                            ))}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mt-4 text-xs text-gray-500">
          Tip: Click a tile on Pulse/Stats to jump into a filtered list here.
        </div>
      </div>
    </div>
  );
}
