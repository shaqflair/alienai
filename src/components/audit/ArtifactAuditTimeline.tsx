"use client";
import React, { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Clock3, FileText, Paperclip, User } from "lucide-react";

type AuditItem = {
  id: number;
  created_at: string;
  section?: string | null;
  action_label?: string | null;
  summary?: string | null;
  changed_columns?: string[] | null;
  content_json_paths?: string[] | null;
  before?: any;
  after?: any;
};

type AuditEvent = {
  group_key: string;
  created_at: string;
  actor_email?: string | null;
  actor_id?: string | null;
  title: string;
  section: string;
  summaries: string[];
  item_count: number;
  items: AuditItem[];
};

function ukDateTime(iso: string) {
  const d = new Date(iso);
  // UK format: DD MMM YYYY, HH:mm
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function iconForSection(section: string) {
  switch (section) {
    case "attachments":
      return <Paperclip className="h-4 w-4" />;
    case "project":
      return <FileText className="h-4 w-4" />;
    default:
      return <Clock3 className="h-4 w-4" />;
  }
}

function humanizePath(p: string) {
  // Turn /project/project_name into "Project → Project name"
  const parts = p.split("/").filter(Boolean);
  if (parts.length === 0) return "Document";
  const [root, ...rest] = parts;
  const prettyRoot = root.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const prettyRest = rest
    .join(" → ")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return prettyRest ? `${prettyRoot} → ${prettyRest}` : prettyRoot;
}

export function ArtifactAuditTimeline({ artifactId }: { artifactId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/artifacts/audit?artifact_id=${encodeURIComponent(artifactId)}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        const j = await res.json();
        if (!alive) return;
        if (j?.ok) setEvents(j.events || []);
        else setEvents([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [artifactId]);

  const empty = !loading && events.length === 0;

  return (
    <div className="w-full">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Audit timeline</h3>
        {loading ? <span className="text-xs text-gray-500">Loading…</span> : null}
      </div>

      {empty ? (
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No audit history yet.
        </div>
      ) : null}

      <div className="space-y-3">
        {events.map((e) => {
          const isOpen = !!open[e.group_key];
          const topSummary = e.summaries?.[0] || `${e.item_count} changes`;
          const actor = e.actor_email || "Unknown user";

          return (
            <div key={e.group_key} className="rounded-xl border border-gray-200 bg-white shadow-sm">
              <button
                type="button"
                className="w-full p-4 text-left"
                onClick={() => setOpen((s) => ({ ...s, [e.group_key]: !s[e.group_key] }))}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-gray-50">
                      {iconForSection(e.section)}
                    </div>

                    <div>
                      <div className="flex items-center gap-2">
                        <div className="text-sm font-semibold text-gray-900">{e.title}</div>
                        <span className="rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">
                          {e.section}
                        </span>
                      </div>

                      <div className="mt-1 text-sm text-gray-700">{topSummary}</div>

                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3.5 w-3.5" />
                          {actor}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock3 className="h-3.5 w-3.5" />
                          {ukDateTime(e.created_at)}
                        </span>
                        <span className="rounded-md border border-gray-200 bg-white px-2 py-0.5">
                          {e.item_count} {e.item_count === 1 ? "entry" : "entries"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-1 text-gray-500">
                    {isOpen ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                  </div>
                </div>
              </button>

              {isOpen ? (
                <div className="border-t border-gray-200 p-4">
                  <div className="space-y-3">
                    {e.items.map((it) => {
                      const paths = (it.content_json_paths || []).slice(0, 12);
                      return (
                        <div key={it.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-gray-900">
                              {it.action_label || "Update"}
                              {it.summary ? <span className="ml-2 text-sm text-gray-700">— {it.summary}</span> : null}
                            </div>
                            <div className="text-xs text-gray-500">{ukDateTime(it.created_at)}</div>
                          </div>

                          {paths.length ? (
                            <div className="mt-2 space-y-1">
                              {paths.map((p, idx) => (
                                <div key={`${it.id}-${idx}`} className="text-xs text-gray-700">
                                  • {humanizePath(p)}
                                </div>
                              ))}
                              {(it.content_json_paths?.length || 0) > paths.length ? (
                                <div className="text-xs text-gray-500">
                                  + {(it.content_json_paths!.length - paths.length).toString()} more
                                </div>
                              ) : null}
                            </div>
                          ) : (
                            <div className="mt-2 text-xs text-gray-600">No JSON path details recorded.</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
