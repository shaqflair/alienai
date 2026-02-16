"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ClientDateTime } from "@/components/date/ClientDateTime";
import DiffPanel, { AuditHint, ApprovalHint } from "../DiffPanel";
import type { ArtifactDiff } from "@/lib/artifacts/diff/types";
import { Copy, Link2, Info, GitCompare, X, MessageSquare } from "lucide-react";

type VersionItem = {
  id: string;
  version: number;
  is_current: boolean;
  is_baseline: boolean;
  approval_status: string;
  updated_at: string;
};

function labelFor(v: VersionItem) {
  const parts = [`v${v.version}`];
  if (v.is_current) parts.push("Current");
  if (v.is_baseline) parts.push("Baseline");
  const s = String(v.approval_status ?? "").toLowerCase();
  if (s && s !== "draft") parts.push(s.replaceAll("_", " "));
  return parts.join(" • ");
}

function cmpId(a: string, b: string) {
  return a.localeCompare(b);
}

function shortId(id: string) {
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

function looksUuidish(s: string) {
  const v = String(s || "").trim();
  return v.length >= 32;
}

export default function CompareVersionsClient({
  projectId,
  artifactId,
  versions,
  defaultChangeId,
}: {
  projectId: string;
  artifactId: string;
  versions: VersionItem[];
  defaultChangeId?: string | null;
}) {
  const sp = useSearchParams();
  const router = useRouter();

  const selectBase =
    "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm " +
    "!text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 " +
    "disabled:opacity-60 disabled:bg-gray-50 appearance-none " +
    "[&>option]:bg-white [&>option]:text-gray-900";

  const byId = useMemo(() => {
    const m = new Map<string, VersionItem>();
    for (const v of versions) m.set(v.id, v);
    return m;
  }, [versions]);

  const options = useMemo(() => {
    return [...versions].sort((x, y) => y.version - x.version || cmpId(x.id, y.id));
  }, [versions]);

  const defaultA = useMemo(() => versions.find((x) => x.is_current)?.id || versions[0]?.id || "", [versions]);
  const defaultB = useMemo(() => {
    const baseline = versions.find((x) => x.is_baseline)?.id;
    if (baseline && baseline !== defaultA) return baseline;
    const second = versions.find((x) => x.id !== defaultA)?.id;
    return second || defaultA;
  }, [versions, defaultA]);

  const [a, setA] = useState<string>(defaultA);
  const [b, setB] = useState<string>(defaultB);
  const [copied, setCopied] = useState(false);

  // ✅ Change Request context (auto-wired)
  const [changeId, setChangeId] = useState<string | null>(null);

  // Compare payload
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [diff, setDiff] = useState<ArtifactDiff | null>(null);
  const [auditHints, setAuditHints] = useState<AuditHint[]>([]);
  const [approvalHints, setApprovalHints] = useState<ApprovalHint[]>([]);

  // deep-link support: ?a=<id>&b=<id>
  useEffect(() => {
    const qa = sp.get("a");
    const qb = sp.get("b");
    const nextA = qa && byId.has(qa) ? qa : defaultA;
    const nextB = qb && byId.has(qb) ? qb : defaultB;
    setA(nextA);
    setB(nextB);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, byId]);

  // ✅ Auto-wire changeId:
  // 1) URL param wins
  // 2) else defaultChangeId from artifact.content_json
  useEffect(() => {
    const urlCid = sp.get("changeId");
    if (urlCid && looksUuidish(urlCid)) {
      setChangeId(urlCid);
      return;
    }
    if (defaultChangeId && looksUuidish(defaultChangeId)) {
      setChangeId(defaultChangeId);
      return;
    }
    setChangeId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, defaultChangeId]);

  const vA = a ? byId.get(a) : undefined;
  const vB = b ? byId.get(b) : undefined;

  const hasVersions = options.length > 0;
  const hasSelection = !!a && !!b;
  const sameVersion = hasSelection && a === b;
  const ready = hasSelection && !sameVersion;

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    if (!a || !b) return "";
    const u = new URL(window.location.href);
    u.searchParams.set("a", a);
    u.searchParams.set("b", b);
    // include CR context in share *only if present*
    if (changeId) u.searchParams.set("changeId", changeId);
    else u.searchParams.delete("changeId");
    return u.toString();
  }, [a, b, changeId]);

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

  function syncUrl(nextA: string, nextB: string) {
    const params = new URLSearchParams(window.location.search);
    if (nextA) params.set("a", nextA);
    if (nextB) params.set("b", nextB);
    // preserve changeId if present
    if (changeId) params.set("changeId", changeId);
    else params.delete("changeId");
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  function clearChangeContext() {
    const params = new URLSearchParams(window.location.search);
    params.delete("changeId");
    router.replace(params.toString() ? `?${params.toString()}` : "?", { scroll: false });
    setChangeId(null);
  }

  // Fetch compare payload whenever A/B changes (and A != B)
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoadErr(null);

      if (!ready) {
        setDiff(null);
        setAuditHints([]);
        setApprovalHints([]);
        return;
      }

      setLoading(true);

      try {
        const res = await fetch("/api/artifacts/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            artifactId,
            aId: a,
            bId: b,
            changeId: changeId || null, // ✅ optional context
          }),
        });

        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) {
          const msg =
            json?.error ||
            `Compare endpoint failed (${res.status}). Ensure /api/artifacts/compare returns { ok:true, diff, auditHints, approvalHints }.`;
          throw new Error(msg);
        }

        if (cancelled) return;

        setDiff((json.diff ?? null) as ArtifactDiff | null);
        setAuditHints(Array.isArray(json.auditHints) ? (json.auditHints as AuditHint[]) : []);
        setApprovalHints(Array.isArray(json.approvalHints) ? (json.approvalHints as ApprovalHint[]) : []);
      } catch (e: any) {
        if (cancelled) return;
        setDiff(null);
        setAuditHints([]);
        setApprovalHints([]);
        setLoadErr(String(e?.message || e || "Failed to load comparison."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [ready, a, b, projectId, artifactId, changeId]);

  return (
    <section className="border rounded-2xl bg-white p-6 space-y-4">
      {/* Header + Share */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 bg-gray-50">
            <GitCompare className="h-4 w-4 text-gray-700" />
            <div className="text-sm font-medium text-gray-900">Compare two versions</div>
            <span className="text-xs text-gray-500 hidden md:inline">Deep-link + share supported</span>
          </div>

          {/* ✅ CR context chip (only if changeId exists) */}
          {changeId ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs bg-white border-gray-200 text-gray-800">
                <MessageSquare className="h-3.5 w-3.5 text-gray-600" />
                CR context attached: <span className="font-mono">{shortId(changeId)}</span>
              </span>
              <button
                type="button"
                onClick={clearChangeContext}
                className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs bg-white border-gray-200 text-gray-700 hover:bg-gray-50"
                title="Remove Change Request context"
              >
                <X className="h-3.5 w-3.5" />
                Remove
              </button>
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={copyShare} disabled={!a || !b} className="rounded-xl" title="Copy shareable link">
            {copied ? (
              <>
                <Copy className="h-4 w-4 mr-2" /> Copied
              </>
            ) : (
              <>
                <Link2 className="h-4 w-4 mr-2" /> Share
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Selectors */}
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-2xl border p-4 space-y-2">
          <div className="text-xs text-gray-500">Version A</div>
          <select
            className={selectBase}
            value={a}
            disabled={!hasVersions}
            onChange={(e) => {
              const next = e.target.value;
              setA(next);
              syncUrl(next, b);
            }}
          >
            {!hasVersions ? (
              <option value="">No versions found</option>
            ) : (
              options.map((v) => (
                <option key={v.id} value={v.id}>
                  {labelFor(v)}
                </option>
              ))
            )}
          </select>

          {vA ? (
            <div className="text-xs text-gray-600">
              Updated: <ClientDateTime value={vA.updated_at} />
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border p-4 space-y-2">
          <div className="text-xs text-gray-500">Version B</div>
          <select
            className={selectBase}
            value={b}
            disabled={!hasVersions}
            onChange={(e) => {
              const next = e.target.value;
              setB(next);
              syncUrl(a, next);
            }}
          >
            {!hasVersions ? (
              <option value="">No versions found</option>
            ) : (
              options.map((v) => (
                <option key={v.id} value={v.id}>
                  {labelFor(v)}
                </option>
              ))
            )}
          </select>

          {vB ? (
            <div className="text-xs text-gray-600">
              Updated: <ClientDateTime value={vB.updated_at} />
            </div>
          ) : null}
        </div>
      </div>

      {/* States */}
      {!hasVersions ? (
        <div className="rounded-2xl border bg-gray-50 p-5">
          <div className="text-sm font-medium text-gray-900 mb-1">No versions available</div>
          <div className="text-sm text-gray-600">This artifact doesn’t have multiple versions under the same root yet.</div>
        </div>
      ) : !hasSelection ? (
        <div className="rounded-2xl border bg-gray-50 p-5">
          <div className="text-sm font-medium text-gray-900 mb-1">Ready to compare</div>
          <div className="text-sm text-gray-600">Select two versions above to see what changed.</div>
        </div>
      ) : sameVersion ? (
        <div className="rounded-2xl border bg-gray-50 p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-gray-700 mt-0.5" />
          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-900">No differences to show</div>
            <div className="text-sm text-gray-600">You selected the same version for A and B. Pick a different version to compare.</div>
          </div>
        </div>
      ) : loadErr ? (
        <div className="rounded-2xl border bg-gray-50 p-4 flex items-start gap-3">
          <Info className="h-5 w-5 text-gray-700 mt-0.5" />
          <div className="space-y-1">
            <div className="text-sm font-medium text-gray-900">Couldn’t load comparison</div>
            <div className="text-sm text-gray-600">{loadErr}</div>
          </div>
        </div>
      ) : loading ? (
        <div className="rounded-2xl border bg-gray-50 p-5">
          <div className="text-sm font-medium text-gray-900 mb-1">Loading differences…</div>
          <div className="text-sm text-gray-600">Fetching version data and building the diff.</div>
        </div>
      ) : null}

      {/* Diff panel */}
      {ready && !loading && !loadErr ? (
        <DiffPanel
          diff={diff}
          sameVersion={sameVersion}
          versionA={vA ? { id: vA.id, label: labelFor(vA), updated_at: vA.updated_at } : null}
          versionB={vB ? { id: vB.id, label: labelFor(vB), updated_at: vB.updated_at } : null}
          auditHints={auditHints}
          approvalHints={approvalHints}
        />
      ) : null}
    </section>
  );
}
