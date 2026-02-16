// src/components/artifacts/ArtifactTimeline.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type AnyRow = any;

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function formatUkDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeStr(iso);
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

function formatUkDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeStr(iso);
  return new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(d);
}

function uniqStrings(xs: any[]) {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of xs ?? []) {
    const s = safeStr(v).trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function looksLikeEmail(s: string) {
  const x = safeStr(s).trim();
  if (!x) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}

function actorDisplay(row: AnyRow) {
  const email = safeStr(row?.actor_email).trim();
  if (looksLikeEmail(email)) return email;

  const actorId = safeStr(row?.actor_id).trim();
  if (looksLikeEmail(actorId)) return actorId;

  // fallback (we won't show random UUIDs if email isn't present)
  return email || actorId || "—";
}

function minuteBucketUTC(iso: string) {
  const d = new Date(iso);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${y}${m}${day}${hh}${mm}`;
}

function deriveTag(items: AnyRow[]) {
  const labels = uniqStrings(items.map((x) => x?.action_label));
  const joined = labels.join(" ").toLowerCase();

  if (joined.includes("approve")) return "Approved";
  if (joined.includes("reject")) return "Rejected";
  if (joined.includes("submit")) return "Submitted";
  if (joined.includes("change") && joined.includes("request")) return "Changes requested";
  if (joined.includes("lock")) return "Locked";
  if (joined.includes("unlock")) return "Unlocked";

  const cols = uniqStrings(
    items.flatMap((x) => (Array.isArray(x?.changed_columns) ? x.changed_columns : []))
  ).map((s) => s.toLowerCase());

  if (cols.includes("approval_status")) return "Approval";
  if (cols.includes("last_saved_at")) return "Saved";
  return "Updated";
}

function pickTitle(items: AnyRow[]) {
  const head = items?.[0];
  const action = safeStr(head?.action).toLowerCase();

  const cols = uniqStrings(
    items.flatMap((x) => (Array.isArray(x?.changed_columns) ? x.changed_columns : []))
  ).map((s) => s.toLowerCase());

  const tag = deriveTag(items);

  if (cols.includes("approval_status") || tag === "Approval") return "Approval updated";
  if (action === "insert") return "Artifact created";
  if (action === "delete") return "Artifact deleted";
  if (cols.includes("last_saved_at") || tag === "Saved") return "Saved";
  return "Updated";
}

type SessionGroup = {
  key: string;
  happenedIso: string;
  actor: string;
  tag: string;

  title: string;
  subtitle: string;

  sections: string[];
  changedCols: string[];
  jsonPaths: string[];

  items: AnyRow[];
};

type DayGroup = {
  dayKey: string;
  sessions: SessionGroup[];
  totalEvents: number;
};

type TimelineModel = {
  totalEvents: number;
  totalSessions: number;
  totalDays: number;
  newestIso: string;
  newestActor: string;
  days: DayGroup[];
};

export default function ArtifactTimeline(props: {
  rows?: AnyRow[];
  artifactId?: string;
  limit?: number;
  titleMap?: Record<string, string>;
}) {
  const { artifactId, limit = 60 } = props;

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rows, setRows] = useState<AnyRow[]>(Array.isArray(props.rows) ? props.rows : []);

  // ✅ ONE collapse toggle for the whole card
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (Array.isArray(props.rows) && props.rows.length > 0) return;
    if (!artifactId) return;

    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const res = await fetch(
          `/api/artifacts/${artifactId}/timeline?limit=${encodeURIComponent(String(limit))}`,
          { method: "GET", headers: { "content-type": "application/json" }, cache: "no-store" }
        );

        const ct = res.headers.get("content-type") || "";
        const body = ct.includes("application/json") ? await res.json() : await res.text();

        if (!res.ok || (body && (body as any).ok === false)) {
          const msg = (body as any)?.error || `Timeline fetch failed (${res.status})`;
          throw new Error(msg);
        }

        const list = Array.isArray((body as any)?.rows) ? (body as any).rows : [];
        if (!cancelled) setRows(list);
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || "Failed to load timeline");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [artifactId, limit, props.rows]);

  const model = useMemo((): TimelineModel => {
    const all = Array.isArray(rows) ? rows : [];

    if (all.length === 0) {
      return {
        totalEvents: 0,
        totalSessions: 0,
        totalDays: 0,
        newestIso: "",
        newestActor: "",
        days: [],
      };
    }

    // 1) session grouping (save_key/request_id/minute bucket)
    const sessionsMap = new Map<string, AnyRow[]>();
    for (const r of all) {
      const saveKey = safeStr(r?.save_key).trim();
      const reqId = safeStr(r?.request_id).trim();
      const created = safeStr(r?.created_at);

      const key = saveKey ? `save:${saveKey}` : reqId ? `req:${reqId}` : `min:${minuteBucketUTC(created)}`;
      const arr = sessionsMap.get(key) ?? [];
      arr.push(r);
      sessionsMap.set(key, arr);
    }

    const sessions: SessionGroup[] = Array.from(sessionsMap.entries())
      .map(([key, itemsRaw]) => {
        const items = (itemsRaw ?? []).slice().sort((a, b) =>
          String(a?.created_at) < String(b?.created_at) ? 1 : -1
        );
        const head = items[0] ?? null;

        const happenedIso = safeStr(head?.created_at);
        const actor = actorDisplay(head);
        const tag = deriveTag(items);

        const sections = uniqStrings(items.map((x) => x?.section));
        const changedCols = uniqStrings(
          items.flatMap((x) => (Array.isArray(x?.changed_columns) ? x.changed_columns : []))
        ).slice(0, 12);
        const jsonPaths = uniqStrings(
          items.flatMap((x) => (Array.isArray(x?.content_json_paths) ? x.content_json_paths : []))
        ).slice(0, 10);

        const title = pickTitle(items);

        const subtitleParts: string[] = [];
        if (tag && tag !== title) subtitleParts.push(tag);
        if (changedCols.length) subtitleParts.push(`${changedCols.length} field(s)`);
        const subtitle = subtitleParts.length ? subtitleParts.join(" • ") : items.length === 1 ? "Updated" : `${items.length} changes`;

        return {
          key,
          happenedIso,
          actor,
          tag,
          title,
          subtitle,
          sections,
          changedCols,
          jsonPaths,
          items,
        };
      })
      .sort((a, b) => (safeStr(a.happenedIso) < safeStr(b.happenedIso) ? 1 : -1));

    const newest = sessions[0];
    const newestIso = newest?.happenedIso ?? "";
    const newestActor = newest?.actor ?? "";

    // 2) day grouping inside the ONE card
    const byDay = new Map<string, SessionGroup[]>();
    for (const s of sessions) {
      const dk = s.happenedIso ? formatUkDate(s.happenedIso) : "—";
      const arr = byDay.get(dk) ?? [];
      arr.push(s);
      byDay.set(dk, arr);
    }

    const dayKeys = Array.from(byDay.keys()).sort((a, b) => {
      const aTop = byDay.get(a)?.[0]?.happenedIso ?? "0";
      const bTop = byDay.get(b)?.[0]?.happenedIso ?? "0";
      return String(aTop) < String(bTop) ? 1 : -1;
    });

    const days: DayGroup[] = dayKeys.map((dk) => {
      const sessionsForDay = (byDay.get(dk) ?? []).slice().sort((a, b) =>
        String(a.happenedIso) < String(b.happenedIso) ? 1 : -1
      );
      const totalEvents = sessionsForDay.reduce((sum, s) => sum + (s.items?.length ?? 0), 0);
      return { dayKey: dk, sessions: sessionsForDay, totalEvents };
    });

    return {
      totalEvents: all.length,
      totalSessions: sessions.length,
      totalDays: days.length,
      newestIso,
      newestActor,
      days,
    };
  }, [rows]);

  const headerRight = loading ? "Loading…" : model.totalEvents ? `${model.totalEvents} events` : "No events";

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">Timeline</div>
        <div className="text-xs text-gray-500">{headerRight}</div>
      </div>

      {err ? (
        <div className="border rounded-2xl p-4 bg-white">
          <div className="text-sm font-medium text-gray-900">Couldn’t load timeline</div>
          <div className="text-xs text-gray-600 mt-1">{err}</div>
        </div>
      ) : null}

      {!err ? (
        <div className="border rounded-2xl bg-white overflow-hidden">
          {/* ✅ ONE single card header */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left hover:bg-gray-50"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div
                className="h-8 w-8 rounded-xl border border-gray-200 flex items-center justify-center text-gray-700"
                aria-hidden
              >
                <span className="text-lg leading-none">{open ? "▾" : "▸"}</span>
              </div>

              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">Activity</div>
                <div className="text-xs text-gray-600">
                  {model.totalEvents ? (
                    <>
                      {model.totalEvents} events • {model.totalSessions} grouped • {model.totalDays} day(s)
                      {model.newestIso ? (
                        <>
                          {" "}
                          • latest {formatUkDateTime(model.newestIso)}
                        </>
                      ) : null}
                      {model.newestActor ? (
                        <>
                          {" "}
                          • <span className="font-mono">{model.newestActor}</span>
                        </>
                      ) : null}
                    </>
                  ) : (
                    "No audit activity yet."
                  )}
                </div>
              </div>
            </div>

            <div className="text-xs text-gray-500 whitespace-nowrap">{open ? "Collapse" : "Expand"}</div>
          </button>

          {/* ✅ ONE single collapsible body */}
          {open ? (
            <div className="px-4 py-3 border-t space-y-4">
              {loading && model.totalEvents === 0 ? (
                <div className="border rounded-2xl p-4 bg-white">
                  <div className="h-4 w-40 bg-gray-100 rounded" />
                  <div className="mt-3 space-y-2">
                    <div className="h-3 w-full bg-gray-100 rounded" />
                    <div className="h-3 w-5/6 bg-gray-100 rounded" />
                    <div className="h-3 w-2/3 bg-gray-100 rounded" />
                  </div>
                </div>
              ) : null}

              {model.days.map((d) => (
                <div key={d.dayKey} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-medium text-gray-700">{d.dayKey}</div>
                    <div className="text-[11px] text-gray-500">{d.totalEvents} event(s)</div>
                  </div>

                  <div className="grid gap-2">
                    {d.sessions.map((s) => (
                      <div key={s.key} className="rounded-xl border border-gray-200 bg-white px-4 py-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900">{s.title}</div>
                            <div className="text-xs text-gray-600 mt-0.5">{s.subtitle}</div>
                          </div>

                          <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                            <div className="text-xs text-gray-500 whitespace-nowrap">
                              {s.happenedIso ? formatUkDateTime(s.happenedIso) : ""}
                            </div>
                            <div className="text-[11px] text-gray-400 whitespace-nowrap">{s.tag}</div>
                          </div>
                        </div>

                        <div className="mt-2 text-xs text-gray-500">
                          By: <span className="font-mono">{s.actor || "—"}</span>
                        </div>

                        {s.sections?.length ? (
                          <div className="mt-1 text-xs text-gray-600">
                            Sections: <span className="font-mono">{s.sections.slice(0, 4).join(", ")}</span>
                          </div>
                        ) : null}

                        {s.changedCols?.length ? (
                          <div className="mt-1 text-xs text-gray-600">
                            Columns: <span className="font-mono">{s.changedCols.join(", ")}</span>
                          </div>
                        ) : null}

                        {s.jsonPaths?.length ? (
                          <div className="mt-1 text-xs text-gray-600">
                            JSON paths: <span className="font-mono">{s.jsonPaths.join(", ")}</span>
                          </div>
                        ) : null}

                        <div className="mt-2 text-[11px] text-gray-400">{s.items.length} event(s) grouped</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
