"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Suggestion = {
  id: string;

  target_artifact_type: string;
  suggestion_type: string;

  rationale: string | null;
  confidence: number | null;

  created_at: string;
  patch: any | null;

  status?: string | null;
  decided_at?: string | null;
  rejected_at?: string | null;

  trigger_key?: string | null;
  triggered_by_event_id?: string | null;
};

function fmtTimeUk(x: string) {
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return x;
    return d.toLocaleString("en-GB", { timeZone: "Europe/London" });
  } catch {
    return x;
  }
}

function safeLower(x: unknown) {
  return String(x ?? "").toLowerCase();
}

function normalizeStatus(status?: string | null) {
  const s = safeLower(status || "proposed").trim();
  if (s === "" || s === "new" || s === "pending" || s === "generated" || s === "queued") return "proposed";
  return s || "unknown";
}

function statusPill(status?: string | null) {
  const s = normalizeStatus(status);
  if (s === "proposed") return "bg-blue-50 text-blue-800 border-blue-200";
  if (s === "suggested") return "bg-indigo-50 text-indigo-800 border-indigo-200";
  if (s === "applied") return "bg-green-50 text-green-800 border-green-200";
  if (s === "rejected") return "bg-gray-50 text-gray-700 border-gray-200";
  return "bg-gray-50 text-gray-700 border-gray-200";
}

function confidencePill(conf: number | null) {
  if (typeof conf !== "number") return null;
  const pct = Math.max(0, Math.min(100, Math.round(conf * 100)));
  return (
    <span className="ml-2 inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-700">
      conf {pct}%
    </span>
  );
}

function SmallPill({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${className}`}>
      {children}
    </span>
  );
}

function mustId(s: { id?: string | null }) {
  const id = String(s?.id ?? "").trim();
  return id ? id : null;
}

function isMockId(id: string) {
  return id.startsWith("mock-");
}

function daysOpen(createdAt: string) {
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24));
  return Math.max(0, days);
}

function isStakeholderRegisterType(t?: string | null) {
  const s = safeLower(t ?? "").trim();
  return s === "stakeholder_register" || s === "stakeholders" || s === "stakeholder";
}

function isGovernanceSuggestionType(x?: string | null) {
  const s = safeLower(x ?? "").trim();
  if (s === "governance") return true;
  if (s.includes("governance")) return true;
  if (s.includes("sponsor") || s.includes("approver")) return true;
  return false;
}

export default function AiSuggestionsPanel(props: {
  projectId: string;
  artifactId?: string;
  targetArtifactType?: string;
  title?: string;
  limit?: number;

  hideWhenEmpty?: boolean;
  showTestButton?: boolean;
}) {
  const {
    projectId,
    artifactId,
    targetArtifactType,
    title = "AI Suggestions",
    limit = 20,
    hideWhenEmpty = false,
    showTestButton = false,
  } = props;

  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [items, setItems] = useState<Suggestion[]>([]);

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyErr, setApplyErr] = useState<string | null>(null);

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectErr, setRejectErr] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"proposed" | "suggested" | "rejected" | "all">("proposed");
  const [search, setSearch] = useState("");

  // Ensure we only attempt ui_test cleanup once per mount (per artifact)
  const cleanedUiTestOnceRef = useRef(false);

  const queryString = useMemo(() => {
    const pid = String(projectId ?? "").trim();
    const params = new URLSearchParams();

    if (!pid || pid === "undefined") return "";

    params.set("projectId", pid);
    params.set("limit", String(limit));
    params.set("status", statusFilter);

    if (artifactId) params.set("artifactId", String(artifactId));
    if (targetArtifactType) params.set("targetArtifactType", String(targetArtifactType));

    return params.toString();
  }, [projectId, artifactId, targetArtifactType, limit, statusFilter]);

  async function safeJson(res: Response) {
    return await res.json().catch(() => null);
  }

  function emitStakeholdersChanged(reason: string) {
    if (!artifactId) return;
    window.dispatchEvent(
      new CustomEvent("alienai:stakeholders-changed", {
        detail: { projectId, artifactId, reason },
      })
    );
  }

  async function cleanupUiTestOnce(rawSuggestions: any[]) {
    if (cleanedUiTestOnceRef.current) return;

    const hasUiTest = rawSuggestions.some((s) => safeLower(s?.suggestion_type) === "ui_test");
    if (!hasUiTest) return;

    cleanedUiTestOnceRef.current = true;

    fetch("/api/suggestions/ui-test/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, artifactId }),
    }).catch(() => null);
  }

  async function load() {
    const pid = String(projectId ?? "").trim();
    if (!pid || pid === "undefined") {
      setErr("Missing projectId");
      setItems([]);
      return;
    }

    if (!queryString) {
      setErr("Missing query parameters");
      setItems([]);
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      const res = await fetch(`/api/suggestions?${queryString}`, { method: "GET" });
      const json = await safeJson(res);

      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load suggestions");

      const raw = Array.isArray(json.suggestions) ? json.suggestions : [];

      // auto-clean legacy ui_test after first render attempt
      cleanupUiTestOnce(raw);

      // Hide ui_test always (we no longer use DB ui_test anyway)
      const filtered = raw.filter((s: any) => safeLower(s?.suggestion_type) !== "ui_test");

      setItems(filtered);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = safeLower(search).trim();
    if (!q) return items;

    return items.filter((s) => {
      const hay = `${s.target_artifact_type} ${s.suggestion_type} ${s.rationale ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, search]);

  const counts = useMemo(() => ({ total: items.length }), [items]);

  // client-only mock (dev only)
  function generateTestSuggestion() {
    setErr(null);
    setApplyErr(null);
    setRejectErr(null);

    const tat = targetArtifactType ?? "stakeholder_register";

    const mock: Suggestion = {
      id: `mock-${crypto.randomUUID()}`,
      target_artifact_type: tat,
      suggestion_type: "ui_test",
      rationale: "UI test suggestion (client-only). If you can see this, Accept/Reject rendering works.",
      confidence: 0.99,
      created_at: new Date().toISOString(),
      patch: null,
      status: "proposed",
      decided_at: null,
      rejected_at: null,
      trigger_key: null,
      triggered_by_event_id: null,
    };

    setItems((prev) => [mock, ...prev]);
  }

  function isTerminalStatus(s: Suggestion) {
    const st = normalizeStatus(s.status);
    return st === "applied" || st === "rejected";
  }

  async function acceptSuggestion(s: Suggestion) {
    setApplyErr(null);
    setRejectErr(null);

    const pid = String(projectId ?? "").trim();
    const aid = String(artifactId ?? "").trim();

    if (!pid) {
      setApplyErr("Missing projectId");
      return;
    }
    if (!aid) {
      setApplyErr("Open this artifact to apply suggestions (missing artifactId).");
      return;
    }

    const sid = mustId(s);
    if (!sid) {
      setApplyErr("Missing suggestion id");
      return;
    }

    if (isMockId(sid)) {
      setItems((prev) => prev.filter((x) => x.id !== sid));
      return;
    }

    setApplyingId(sid);
    try {
      const res = await fetch("/api/ai/suggestions/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: pid, artifactId: aid, suggestionId: sid }),
      });

      const json = await safeJson(res);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to apply suggestion");

      if (aid && isStakeholderRegisterType(s.target_artifact_type) && isGovernanceSuggestionType(s.suggestion_type)) {
        emitStakeholdersChanged("suggestion_applied_governance");
      }

      router.refresh();
      await load();
    } catch (e: any) {
      setApplyErr(String(e?.message ?? e));
    } finally {
      setApplyingId(null);
    }
  }

  async function rejectSuggestion(s: Suggestion) {
    setRejectErr(null);
    setApplyErr(null);

    const sid = mustId(s);
    if (!sid) {
      setRejectErr("Missing suggestion id");
      return;
    }

    if (isMockId(sid)) {
      setItems((prev) => prev.filter((x) => x.id !== sid));
      return;
    }

    setRejectingId(sid);
    try {
      const res = await fetch(`/api/suggestions/${encodeURIComponent(sid)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, artifactId, reason: null }),
      });

      const json = await safeJson(res);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to reject suggestion");

      router.refresh();
      await load();
    } catch (e: any) {
      setRejectErr(String(e?.message ?? e));
    } finally {
      setRejectingId(null);
    }
  }

  useEffect(() => {
    cleanedUiTestOnceRef.current = false;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryString]);

  const busy = applyingId !== null || rejectingId !== null;

  const headerSubtitle = targetArtifactType ? `For ${targetArtifactType}` : "Across project";
  const applyBadge = artifactId ? "applies to this artifact" : "open an artifact to apply";

  const shouldHide = hideWhenEmpty && !loading && !err && (items?.length ?? 0) === 0;
  if (shouldHide) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm" id="ai-suggestions-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            <SmallPill className="border-gray-200 bg-gray-50 text-gray-700">{counts.total} shown</SmallPill>
            <SmallPill className="border-gray-200 bg-gray-50 text-gray-700">{headerSubtitle}</SmallPill>
            <SmallPill className="border-gray-200 bg-gray-50 text-gray-700">{applyBadge}</SmallPill>
          </div>
          <p className="mt-1 text-xs text-gray-500">Event-driven suggestions. Keep this list action-oriented.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
            <span className="mr-2 text-gray-500">Status</span>
            <select
              className="bg-white text-sm outline-none"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              disabled={loading || busy}
            >
              <option value="proposed">Proposed</option>
              <option value="suggested">Suggested</option>
              <option value="rejected">Rejected</option>
              <option value="all">All</option>
            </select>
          </div>

          <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm">
            <input
              className="w-48 max-w-[60vw] bg-white text-sm outline-none"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={loading || busy}
            />
          </div>

          <button
            onClick={load}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
            disabled={loading || busy}
            type="button"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>

          {showTestButton ? (
            <button
              onClick={generateTestSuggestion}
              className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
              disabled={loading || busy}
              type="button"
              title="Client-only mock (no DB insert)"
            >
              Test AI (dev)
            </button>
          ) : null}
        </div>
      </div>

      {err ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
      ) : null}
      {applyErr ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{applyErr}</div>
      ) : null}
      {rejectErr ? (
        <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{rejectErr}</div>
      ) : null}

      <div className="mt-3 space-y-3">
        {filteredItems.length === 0 && !loading ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
            No suggestions found.
          </div>
        ) : null}

        {filteredItems.map((s) => {
          const sid = mustId(s);
          if (!sid) return null;

          // Hide DB ui_test; allow mock ui_test (client-only)
          const isDbUiTest = safeLower(s.suggestion_type) === "ui_test" && !isMockId(sid);
          if (isDbUiTest) return null;

          const isApplying = applyingId === sid;
          const isRejecting = rejectingId === sid;

          const st = normalizeStatus(s.status);
          const isActionable = !isTerminalStatus(s);

          const canApplyHere = Boolean(String(artifactId ?? "").trim());
          const acceptDisabledReason = !canApplyHere ? "Open an artifact to apply suggestions" : undefined;

          const openDays = daysOpen(s.created_at);
          const showSla = (st === "proposed" || st === "suggested") && typeof openDays === "number" && openDays >= 3;
          const slaClass =
            typeof openDays === "number" && openDays >= 7
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-amber-200 bg-amber-50 text-amber-800";

          return (
            <div key={sid} className="rounded-xl border border-gray-200 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm font-medium text-gray-900">
                  {s.target_artifact_type} · <span className="text-gray-600">{s.suggestion_type}</span>
                  <span
                    className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusPill(
                      s.status
                    )}`}
                  >
                    {st}
                  </span>

                  {showSla ? (
                    <span className={`ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${slaClass}`}>
                      ⏱️ {openDays} days open
                    </span>
                  ) : null}
                </div>

                <div className="text-xs text-gray-500">
                  {fmtTimeUk(s.created_at)}
                  {confidencePill(s.confidence)}
                </div>
              </div>

              {s.rationale ? <p className="mt-2 text-sm text-gray-700">{s.rationale}</p> : null}

              {isActionable ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                    disabled={busy || !canApplyHere}
                    type="button"
                    onClick={() => acceptSuggestion(s)}
                    title={acceptDisabledReason}
                  >
                    {isApplying ? "Applying..." : "Accept"}
                  </button>

                  <button
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
                    disabled={busy}
                    type="button"
                    onClick={() => rejectSuggestion(s)}
                  >
                    {isRejecting ? "Rejecting..." : "Reject"}
                  </button>

                  {!canApplyHere ? (
                    <span className="inline-flex items-center text-xs text-gray-500">
                      Tip: open an artifact page to apply suggestions.
                    </span>
                  ) : null}
                </div>
              ) : null}

              {s.patch ? (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-gray-600">View patch</summary>
                  <pre className="mt-2 overflow-auto rounded-xl bg-gray-50 p-3 text-xs text-gray-800">
                    {JSON.stringify(s.patch, null, 2)}
                  </pre>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
