// src/components/artifacts/diff/ArtifactDiffExperience.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ClientDateTime } from "@/components/date/ClientDateTime";
import ArtifactDiffTable from "@/components/artifacts/diff/ArtifactDiffTable";
import type { ArtifactDiff } from "@/lib/artifacts/diff/types";
import {
  Download,
  Printer,
  Info,
  ShieldCheck,
  History,
  ChevronDown,
  Search,
  X,
  ArrowDown,
  GitCompare,
  Link2,
} from "lucide-react";

type AuditHint = {
  artifact_id: string;
  happened_at: string;
  actor_id: string | null;
  summary: string | null;
  table_name: string | null;
  action: string | null;
};

type ApprovalHint = {
  artifact_id: string;
  happened_at: string;
  actor_id: string | null;
  summary: string | null;
};

function shortId(id: string) {
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function downloadJson(filename: string, data: any) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function normalizeApprovalLabel(label: string | null | undefined) {
  const s = String(label ?? "").toLowerCase();
  if (!s) return null;
  if (s.includes("approved")) return { text: "Approved", cls: "bg-gray-100 border-gray-200 text-gray-900" };
  if (s.includes("rejected")) return { text: "Rejected", cls: "bg-gray-100 border-gray-200 text-gray-900" };
  if (s.includes("submitted")) return { text: "Submitted", cls: "bg-gray-100 border-gray-200 text-gray-900" };
  if (s.includes("changes")) return { text: "Changes requested", cls: "bg-gray-100 border-gray-200 text-gray-900" };
  return { text: label, cls: "bg-gray-50 border-gray-200 text-gray-700" };
}

function estimateChangeCount(diff: any): number | null {
  // Best-effort (schema-agnostic):
  // - If diff exposes counts, use them.
  // - Else, count occurrences of typical change markers in JSON.
  if (!diff) return null;

  const direct =
    Number((diff as any).change_count) ||
    Number((diff as any).changes_count) ||
    Number((diff as any).total_changes) ||
    Number((diff as any).totalChanges);

  if (Number.isFinite(direct) && direct > 0) return direct;

  try {
    const s = JSON.stringify(diff);
    const markers = [
      '"added"',
      '"removed"',
      '"deleted"',
      '"inserted"',
      '"updated"',
      '"modified"',
      '"changed"',
      '"before"',
      '"after"',
      '"from"',
      '"to"',
      '"diffType"',
      '"op"',
    ];
    let n = 0;
    for (const m of markers) {
      const re = new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const hits = s.match(re);
      if (hits) n += hits.length;
    }
    // This is a heuristic; clamp to something sensible so it doesn't look ridiculous.
    return Math.max(1, Math.min(999, Math.round(n / 3)));
  } catch {
    return null;
  }
}

export default function ArtifactDiffExperience({
  diff,
  sameVersion,
  versionA,
  versionB,
  auditHints,
  approvalHints,
}: {
  diff: ArtifactDiff | null;
  sameVersion: boolean;
  versionA: { id: string; label: string; updated_at?: string | null } | null;
  versionB: { id: string; label: string; updated_at?: string | null } | null;
  auditHints: AuditHint[];
  approvalHints: ApprovalHint[];
}) {
  const [query, setQuery] = useState("");
  const [collapseAll, setCollapseAll] = useState(false);
  const [copied, setCopied] = useState(false);

  // Auto-expand when there IS a real compare (A != B)
  useEffect(() => {
    if (!sameVersion) setCollapseAll(false);
  }, [sameVersion]);

  // Diff details anchor
  const diffDetailsRef = useRef<HTMLDetailsElement | null>(null);

  function jumpToFirstChange() {
    // Minimal + reliable: scroll to diff table container.
    // (True “first changed row” requires knowing ArtifactDiffTable structure.)
    diffDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const filteredDiff = useMemo(() => {
    if (!diff) return null;
    const q = query.trim().toLowerCase();
    if (!q) return diff;

    const hay = JSON.stringify(diff).toLowerCase();
    if (!hay.includes(q)) return { ...(diff as any), __no_match_hint: true } as any;
    return diff;
  }, [diff, query]);

  const auditByArtifact = useMemo(() => {
    const m = new Map<string, AuditHint[]>();
    for (const a of auditHints || []) {
      const k = String(a.artifact_id);
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    // Ensure newest first
    for (const [k, arr] of m.entries()) {
      arr.sort((x, y) => String(y.happened_at).localeCompare(String(x.happened_at)));
      m.set(k, arr);
    }
    return m;
  }, [auditHints]);

  const approvalsByArtifact = useMemo(() => {
    const m = new Map<string, ApprovalHint[]>();
    for (const a of approvalHints || []) {
      const k = String(a.artifact_id);
      const arr = m.get(k) ?? [];
      arr.push(a);
      m.set(k, arr);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((x, y) => String(y.happened_at).localeCompare(String(x.happened_at)));
      m.set(k, arr);
    }
    return m;
  }, [approvalHints]);

  const aAudit = versionA?.id ? auditByArtifact.get(versionA.id) ?? [] : [];
  const bAudit = versionB?.id ? auditByArtifact.get(versionB.id) ?? [] : [];

  const aAppr = versionA?.id ? approvalsByArtifact.get(versionA.id) ?? [] : [];
  const bAppr = versionB?.id ? approvalsByArtifact.get(versionB.id) ?? [] : [];

  const canExport = !!diff && !sameVersion;

  // Share link (deep-link: ?a=&b=) – no need for extra props, derived from current URL
  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (!versionA?.id || !versionB?.id) return "";
    const u = new URL(window.location.href);
    u.searchParams.set("a", versionA.id);
    u.searchParams.set("b", versionB.id);
    return u.toString();
  }, [versionA?.id, versionB?.id]);

  async function copyShare() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      const el = document.createElement("textarea");
      el.value = shareUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }
  }

  // Status badges (inferred from approval event summaries if present)
  const aStatus = useMemo(() => {
    const s = aAppr.find((x) => x.summary)?.summary ?? null;
    return normalizeApprovalLabel(s);
  }, [aAppr]);

  const bStatus = useMemo(() => {
    const s = bAppr.find((x) => x.summary)?.summary ?? null;
    return normalizeApprovalLabel(s);
  }, [bAppr]);

  const changeCount = useMemo(() => (sameVersion ? 0 : diff ? estimateChangeCount(diff) : 0), [diff, sameVersion]);

  const showDiff = !sameVersion && !!diff;

  return (
    <section className="border rounded-2xl bg-white p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 bg-gray-50">
              <GitCompare className="h-4 w-4 text-gray-700" />
              <div className="font-medium text-gray-900">Comparison</div>
              {typeof changeCount === "number" && changeCount > 0 ? (
                <span className="ml-1 inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-white border-gray-200 text-gray-700">
                  ~{changeCount} changes
                </span>
              ) : null}
            </div>

            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-white border-gray-200 text-gray-700">
              A: {versionA ? versionA.label : "—"}
              {aStatus ? (
                <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 ${aStatus.cls}`}>
                  {aStatus.text}
                </span>
              ) : null}
              <span className="opacity-50 mx-2">•</span>
              B: {versionB ? versionB.label : "—"}
              {bStatus ? (
                <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 ${bStatus.cls}`}>
                  {bStatus.text}
                </span>
              ) : null}
            </span>
          </div>

          <div className="text-xs text-gray-500 flex flex-wrap items-center gap-2">
            {versionA?.updated_at ? (
              <span>
                A updated: <ClientDateTime value={versionA.updated_at} />
              </span>
            ) : null}
            {versionB?.updated_at ? (
              <>
                <span className="opacity-40">•</span>
                <span>
                  B updated: <ClientDateTime value={versionB.updated_at} />
                </span>
              </>
            ) : null}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search within diff…"
              className="pl-9 pr-9 py-2 text-sm rounded-xl border border-gray-200 bg-white w-[260px] max-w-[80vw]"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-50"
                aria-label="Clear search"
                title="Clear"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            ) : null}
          </div>

          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => setCollapseAll((v) => !v)}
            title={collapseAll ? "Expand panels" : "Collapse panels"}
          >
            <ChevronDown className={`h-4 w-4 mr-2 transition-transform ${collapseAll ? "rotate-180" : ""}`} />
            {collapseAll ? "Expand" : "Collapse"}
          </Button>

          <Button
            variant="outline"
            className="rounded-xl"
            onClick={copyShare}
            disabled={!versionA?.id || !versionB?.id}
            title="Copy shareable link"
          >
            <Link2 className="h-4 w-4 mr-2" />
            {copied ? "Copied" : "Share"}
          </Button>

          <Button
            variant="outline"
            className="rounded-xl"
            disabled={!showDiff}
            onClick={jumpToFirstChange}
            title="Jump to diff details"
          >
            <ArrowDown className="h-4 w-4 mr-2" />
            First change
          </Button>

          <Button
            variant="outline"
            className="rounded-xl"
            disabled={!canExport}
            onClick={() =>
              downloadJson(
                `artifact-diff-${shortId(versionA?.id || "")}-vs-${shortId(versionB?.id || "")}.json`,
                diff
              )
            }
            title="Download diff JSON"
          >
            <Download className="h-4 w-4 mr-2" /> Export JSON
          </Button>

          <Button variant="outline" className="rounded-xl" disabled={!canExport} onClick={() => window.print()} title="Print / Save as PDF">
            <Printer className="h-4 w-4 mr-2" /> Print/PDF
          </Button>
        </div>
      </div>

      {/* Empty states */}
      {sameVersion ? (
        <div className="rounded-2xl border bg-gray-50 p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-gray-700 mt-0.5" />
          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-900">No differences to show</div>
            <div className="text-sm text-gray-600">You selected the same version for A and B. Pick a different version to compare.</div>
          </div>
        </div>
      ) : !diff ? (
        <div className="rounded-2xl border bg-gray-50 p-5">
          <div className="text-sm font-medium text-gray-900 mb-1">Differences</div>
          <div className="text-sm text-gray-600">No differences to display yet.</div>
          <div className="mt-2 text-xs text-gray-500">Select two different versions to compare changes.</div>
        </div>
      ) : null}

      {/* Context panels */}
      {!sameVersion ? (
        <div className="grid gap-3 md:grid-cols-2">
          <details className="rounded-2xl border p-4 bg-white" open={!collapseAll}>
            <summary className="cursor-pointer select-none flex items-center gap-2 text-sm font-medium text-gray-900">
              <History className="h-4 w-4 text-gray-700" />
              Change history
            </summary>

            <div className="mt-3 space-y-3 text-sm text-gray-700">
              {[{ label: "A", data: aAudit }, { label: "B", data: bAudit }].map((v) => (
                <div key={v.label} className="rounded-xl border bg-gray-50 p-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Version {v.label}</div>
                  {v.data.length ? (
                    <ul className="space-y-2">
                      {v.data.slice(0, 5).map((x, i) => (
                        <li key={`${v.label}-${x.happened_at}-${i}`} className="text-xs">
                          <div className="font-medium text-gray-900">{x.summary || "Update"}</div>
                          <div className="text-gray-600 flex flex-wrap gap-2">
                            <span>
                              <ClientDateTime value={x.happened_at} />
                            </span>
                            <span className="opacity-40">•</span>
                            <span className="font-mono">{x.actor_id ? shortId(x.actor_id) : "System/SQL"}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-gray-500">No history found.</div>
                  )}
                </div>
              ))}
            </div>
          </details>

          <details className="rounded-2xl border p-4 bg-white" open={!collapseAll}>
            <summary className="cursor-pointer select-none flex items-center gap-2 text-sm font-medium text-gray-900">
              <ShieldCheck className="h-4 w-4 text-gray-700" />
              Approval annotations
            </summary>

            <div className="mt-3 space-y-3 text-sm text-gray-700">
              {[{ label: "A", data: aAppr }, { label: "B", data: bAppr }].map((v) => (
                <div key={v.label} className="rounded-xl border bg-gray-50 p-3">
                  <div className="text-[10px] font-bold text-gray-400 uppercase mb-2">Version {v.label}</div>
                  {v.data.length ? (
                    <ul className="space-y-2">
                      {v.data.slice(0, 5).map((x, i) => (
                        <li key={`${v.label}-${x.happened_at}-${i}`} className="text-xs">
                          <div className="font-medium text-gray-900">{x.summary || "Approval activity"}</div>
                          <div className="text-gray-600 flex flex-wrap gap-2">
                            <span>
                              <ClientDateTime value={x.happened_at} />
                            </span>
                            <span className="opacity-40">•</span>
                            <span className="font-mono">{x.actor_id ? shortId(x.actor_id) : "System/SQL"}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-gray-500">No approval events found.</div>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      ) : null}

      {/* Diff details */}
      {!sameVersion && diff ? (
        <details ref={diffDetailsRef} className="rounded-2xl border p-4 bg-white" open={!collapseAll}>
          <summary className="cursor-pointer select-none flex items-center justify-between gap-3 text-sm font-medium text-gray-900">
            <span>Diff details</span>
            <span className="text-xs text-gray-500 font-normal">{query ? "Filtered view" : "Full view"}</span>
          </summary>

          <div className="mt-4">
            {(filteredDiff as any)?.__no_match_hint ? (
              <div className="mb-3 rounded-xl border bg-gray-50 p-3 text-sm text-gray-700 flex items-start gap-2">
                <Info className="h-4 w-4 mt-0.5 text-gray-700" />
                <div>
                  No matches found for <span className="font-mono">{query}</span>. Showing full diff.
                </div>
              </div>
            ) : null}

            {/* Your existing renderer */}
            <ArtifactDiffTable diff={filteredDiff as any} />
          </div>
        </details>
      ) : null}

      {/* Advanced tips (cleaned) */}
      <details className="rounded-2xl border bg-white p-4" open={false}>
        <summary className="cursor-pointer select-none flex items-center gap-2 text-sm font-medium text-gray-900">
          <Info className="h-4 w-4 text-gray-700" />
          Advanced tips
        </summary>

        <div className="mt-3 text-sm text-gray-600 space-y-3">
          <p>
            You can optionally include <strong>Change Request approver comments</strong> in this comparison.
          </p>

          <ul className="list-disc pl-5 space-y-1">
            <li>
              Add a <span className="font-mono">changeId</span> to the URL (e.g.{" "}
              <span className="font-mono">?changeId=&lt;uuid&gt;</span>)
            </li>
            <li>
              Or store <span className="font-mono">changeId</span> in the artifact metadata
            </li>
          </ul>

          <div className="text-xs text-gray-500">This is only needed when reviewing approval discussions.</div>
        </div>
      </details>
    </section>
  );
}
