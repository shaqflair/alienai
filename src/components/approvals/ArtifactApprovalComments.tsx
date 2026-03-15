"use client";

import * as React from "react";

type ApprovalComment = {
  id: string;
  author_name: string | null;
  comment_type: string;
  body: string;
  created_at: string;
};

function fmtDate(v: string) {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString();
}

function tone(type: string) {
  switch (String(type || "").toLowerCase()) {
    case "approve":
      return "border-green-200 bg-green-50 text-green-800";
    case "request_changes":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "reject":
      return "border-red-200 bg-red-50 text-red-800";
    case "resubmit":
      return "border-sky-200 bg-sky-50 text-sky-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-800";
  }
}

export default function ArtifactApprovalComments(props: {
  projectId: string;
  artifactId: string;
}) {
  const { projectId, artifactId } = props;

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<ApprovalComment[]>([]);

  React.useEffect(() => {
    let alive = true;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/artifacts/${encodeURIComponent(artifactId)}/comments?projectId=${encodeURIComponent(projectId)}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (!res.ok || !json?.ok) {
          throw new Error(json?.error || "Failed to load comments");
        }
        if (!alive) return;
        setRows(Array.isArray(json.comments) ? json.comments : []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || "Failed to load comments");
      } finally {
        if (alive) setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
    };
  }, [projectId, artifactId]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">Approval comments</h3>
      </div>

      {loading ? (
        <div className="text-sm text-slate-500">Loading comments…</div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-slate-500">No approval comments yet.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tone(row.comment_type)}`}>
                  {row.comment_type.replaceAll("_", " ")}
                </span>
                <span className="text-xs text-slate-600">{row.author_name || "Unknown"}</span>
                <span className="text-xs text-slate-400">•</span>
                <span className="text-xs text-slate-500">{fmtDate(row.created_at)}</span>
              </div>
              <div className="whitespace-pre-wrap text-sm text-slate-800">{row.body}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
