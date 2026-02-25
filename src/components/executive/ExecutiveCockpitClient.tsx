"use client";

import * as React from "react";

type ApiOk<T> = { orgId?: string; scope?: string } & T;
type ApiErr = { error: string; message?: string };

type PendingApprovalsPayload = ApiOk<{ items: any[] }> | ApiErr;
type WhoBlockingPayload = ApiOk<{ items?: any[]; blockers?: any[] }> | ApiErr;
type SlaRadarPayload = ApiOk<{ items?: any[]; breaches?: any[] }> | ApiErr;
type RiskSignalsPayload = ApiOk<{ items?: any[]; signals?: any[] }> | ApiErr;
type PortfolioApprovalsPayload = ApiOk<{ items?: any[] }> | ApiErr;
type BottlenecksPayload = ApiOk<{ items?: any[] }> | ApiErr;

function isErr(x: any): x is ApiErr {
  return !!x && typeof x === "object" && typeof x.error === "string";
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
    signal,
  });

  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const message =
      (json && (json.message || json.error)) ||
      (text ? text.slice(0, 200) : "") ||
      `Request failed (${res.status})`;
    throw new Error(message);
  }

  return json as T;
}

function StatCard(props: {
  title: string;
  value: React.ReactNode;
  subtitle?: React.ReactNode;
  error?: string | null;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-medium text-gray-700">{props.title}</div>
      <div className="mt-2 text-3xl font-semibold text-gray-900">
        {props.value}
      </div>
      {props.subtitle ? (
        <div className="mt-1 text-xs text-gray-500">{props.subtitle}</div>
      ) : null}
      {props.error ? (
        <div className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
          {props.error}
        </div>
      ) : null}
    </div>
  );
}

function errPayload(msg: string): ApiErr {
  return { error: msg };
}

function settledOrErr<T>(r: PromiseSettledResult<T>, fallbackMsg: string): T | ApiErr {
  if (r.status === "fulfilled") return r.value as any;
  const m =
    (r.reason && (r.reason.message || String(r.reason))) ||
    fallbackMsg;
  return errPayload(m);
}

/**
 * Production-safe Executive Cockpit client
 * - SINGLE ORG mode: no orgId passed/required
 * - Uses canonical executive endpoints under /api/executive/*
 * - Each tile can fail independently (no full blank cockpit)
 */
export default function ExecutiveCockpitClient(_props: { orgId?: string } = {}) {
  const [loading, setLoading] = React.useState(true);

  const [pendingApprovals, setPendingApprovals] =
    React.useState<PendingApprovalsPayload | null>(null);
  const [whoBlocking, setWhoBlocking] =
    React.useState<WhoBlockingPayload | null>(null);
  const [slaRadar, setSlaRadar] =
    React.useState<SlaRadarPayload | null>(null);
  const [riskSignals, setRiskSignals] =
    React.useState<RiskSignalsPayload | null>(null);
  const [portfolioApprovals, setPortfolioApprovals] =
    React.useState<PortfolioApprovalsPayload | null>(null);
  const [bottlenecks, setBottlenecks] =
    React.useState<BottlenecksPayload | null>(null);

  const [fatalError, setFatalError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const ac = new AbortController();
    let mounted = true;

    async function load() {
      setLoading(true);
      setFatalError(null);

      // reset last values to avoid “stale good data” hiding new errors
      setPendingApprovals(null);
      setWhoBlocking(null);
      setSlaRadar(null);
      setRiskSignals(null);
      setPortfolioApprovals(null);
      setBottlenecks(null);

      try {
        const [
          paR,
          wbR,
          slaR,
          rsR,
          portR,
          bottR,
        ] = await Promise.allSettled([
          // ✅ approvals namespace (exists in tree)
          fetchJson<PendingApprovalsPayload>(
            "/api/executive/approvals/pending?limit=200",
            ac.signal
          ),

          // ✅ top-level exec endpoints (exist in tree)
          fetchJson<WhoBlockingPayload>("/api/executive/who-blocking", ac.signal),
          fetchJson<SlaRadarPayload>("/api/executive/sla-radar", ac.signal),
          fetchJson<RiskSignalsPayload>("/api/executive/risk-signals", ac.signal),

          // ✅ approvals namespace (exists in tree)
          fetchJson<PortfolioApprovalsPayload>(
            "/api/executive/approvals/portfolio",
            ac.signal
          ),
          fetchJson<BottlenecksPayload>(
            "/api/executive/approvals/bottlenecks",
            ac.signal
          ),
        ]);

        if (!mounted) return;

        const pa = settledOrErr(paR, "Failed to load pending approvals");
        const wb = settledOrErr(wbR, "Failed to load who-blocking");
        const sla = settledOrErr(slaR, "Failed to load SLA radar");
        const rs = settledOrErr(rsR, "Failed to load risk signals");
        const port = settledOrErr(portR, "Failed to load portfolio approvals");
        const bott = settledOrErr(bottR, "Failed to load bottlenecks");

        setPendingApprovals(pa as any);
        setWhoBlocking(wb as any);
        setSlaRadar(sla as any);
        setRiskSignals(rs as any);
        setPortfolioApprovals(port as any);
        setBottlenecks(bott as any);

        // Only show fatalError if EVERYTHING failed
        const allFailed =
          isErr(pa) &&
          isErr(wb) &&
          isErr(sla) &&
          isErr(rs) &&
          isErr(port) &&
          isErr(bott);

        if (allFailed) {
          setFatalError("Failed to load executive cockpit");
        }
      } catch (e: any) {
        if (!mounted) return;
        if (e?.name === "AbortError") return;
        setFatalError(e?.message ?? "Failed to load executive cockpit");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    load();

    return () => {
      mounted = false;
      ac.abort();
    };
  }, []);

  const pendingCount =
    pendingApprovals && !isErr(pendingApprovals)
      ? pendingApprovals.items?.length ?? 0
      : null;

  const whoBlockingCount =
    whoBlocking && !isErr(whoBlocking)
      ? whoBlocking.items?.length ?? whoBlocking.blockers?.length ?? 0
      : null;

  const slaCount =
    slaRadar && !isErr(slaRadar)
      ? slaRadar.items?.length ?? slaRadar.breaches?.length ?? 0
      : null;

  const riskCount =
    riskSignals && !isErr(riskSignals)
      ? riskSignals.items?.length ?? riskSignals.signals?.length ?? 0
      : null;

  const portfolioApprovalsCount =
    portfolioApprovals && !isErr(portfolioApprovals)
      ? portfolioApprovals.items?.length ?? 0
      : null;

  const bottlenecksCount =
    bottlenecks && !isErr(bottlenecks) ? bottlenecks.items?.length ?? 0 : null;

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Executive Cockpit</h1>
          <p className="text-sm text-gray-500">Live org-scoped signals (single-org mode).</p>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 shadow-sm hover:bg-gray-50"
        >
          Refresh
        </button>
      </div>

      {fatalError ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {fatalError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          title="Pending approvals"
          value={loading ? "…" : pendingCount ?? 0}
          subtitle={
            pendingApprovals && !isErr(pendingApprovals) && pendingApprovals.scope
              ? `Scope: ${pendingApprovals.scope}`
              : undefined
          }
          error={
            pendingApprovals && isErr(pendingApprovals)
              ? pendingApprovals.message ?? pendingApprovals.error
              : null
          }
        />

        <StatCard
          title="Who’s blocking"
          value={loading ? "…" : whoBlockingCount ?? 0}
          error={whoBlocking && isErr(whoBlocking) ? whoBlocking.message ?? whoBlocking.error : null}
        />

        <StatCard
          title="SLA radar"
          value={loading ? "…" : slaCount ?? 0}
          error={slaRadar && isErr(slaRadar) ? slaRadar.message ?? slaRadar.error : null}
        />

        <StatCard
          title="Risk signals"
          value={loading ? "…" : riskCount ?? 0}
          error={riskSignals && isErr(riskSignals) ? riskSignals.message ?? riskSignals.error : null}
        />

        <StatCard
          title="Portfolio approvals"
          value={loading ? "…" : portfolioApprovalsCount ?? 0}
          error={
            portfolioApprovals && isErr(portfolioApprovals)
              ? portfolioApprovals.message ?? portfolioApprovals.error
              : null
          }
        />

        <StatCard
          title="Bottlenecks"
          value={loading ? "…" : bottlenecksCount ?? 0}
          error={bottlenecks && isErr(bottlenecks) ? bottlenecks.message ?? bottlenecks.error : null}
        />
      </div>
    </div>
  );
}
