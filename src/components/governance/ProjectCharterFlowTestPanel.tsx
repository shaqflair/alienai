"use client";

import { useMemo, useState } from "react";
import { Beaker, CheckCircle2, AlertTriangle, XCircle, Loader2 } from "lucide-react";

type Scenario = "happy_path" | "reject_step_2" | "sla_breach";

type TestResponse = {
  ok: boolean;
  scenario: Scenario;
  artifact_id?: string;
  project?: {
    id?: string;
    title?: string;
    project_code?: string;
  };
  assertions?: {
    passed: boolean;
    checks: Array<{
      name: string;
      pass: boolean;
      actual?: unknown;
    }>;
  };
  state?: {
    artifact?: {
      id?: string;
      title?: string;
      status?: string;
    };
    chain?: {
      id?: string;
      status?: string;
    };
    steps?: Array<{
      id?: string;
      step_order?: number;
      step_name?: string;
      status?: string;
      sla_status?: string | null;
      is_current?: boolean;
    }>;
    audit?: Array<{
      action?: string;
      comment?: string;
      created_at?: string;
    }>;
  };
  error?: string;
  detail?: unknown;
};

const SCENARIOS: Array<{
  key: Scenario;
  label: string;
  hint: string;
}> = [
  {
    key: "happy_path",
    label: "Run Happy Path",
    hint: "Submit → approve all 3 steps → complete chain",
  },
  {
    key: "reject_step_2",
    label: "Run Rejection Path",
    hint: "Approve step 1 → reject at step 2",
  },
  {
    key: "sla_breach",
    label: "Run SLA Breach",
    hint: "Create chain and mark step 1 as breached",
  },
];

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function pretty(value: unknown) {
  if (value == null) return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function ProjectCharterFlowTestPanel() {
  const [loading, setLoading] = useState<Scenario | null>(null);
  const [result, setResult] = useState<TestResponse | null>(null);
  const [error, setError] = useState<string>("");

  const overallPass = useMemo(() => !!result?.assertions?.passed, [result]);

  async function runScenario(scenario: Scenario) {
    setLoading(scenario);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/dev/test-project-charter-flow", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ scenario }),
      });

      const data = (await res.json().catch(() => null)) as TestResponse | null;

      if (!res.ok || !data?.ok) {
        throw new Error(data?.detail ? `${data?.error}: ${pretty(data.detail)}` : data?.error || "Test failed");
      }

      setResult(data);
    } catch (e: any) {
      setError(e?.message || "Failed to run test flow");
    } finally {
      setLoading(null);
    }
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-[0_10px_40px_rgba(0,0,0,0.25)] backdrop-blur-xl">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300">
              <Beaker className="h-4 w-4" />
            </div>
            <h3 className="text-base font-semibold text-white">Project Charter Flow Test</h3>
          </div>
          <p className="text-sm text-white/60">
            Dev-only governance simulation for approval chain, audit trail, and final artifact state.
          </p>
        </div>

        <div
          className={cx(
            "rounded-full px-3 py-1 text-xs font-medium",
            result
              ? overallPass
                ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                : "border border-amber-400/30 bg-amber-400/10 text-amber-300"
              : "border border-white/10 bg-white/5 text-white/50"
          )}
        >
          {result ? (overallPass ? "Passed" : "Needs review") : "Idle"}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {SCENARIOS.map((item) => {
          const isBusy = loading === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => runScenario(item.key)}
              disabled={!!loading}
              className={cx(
                "rounded-2xl border p-4 text-left transition",
                "border-white/10 bg-white/[0.03] hover:border-cyan-400/30 hover:bg-cyan-400/[0.06]",
                "disabled:cursor-not-allowed disabled:opacity-60"
              )}
            >
              <div className="mb-2 flex items-center gap-2">
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-300" />
                ) : item.key === "happy_path" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                ) : item.key === "reject_step_2" ? (
                  <XCircle className="h-4 w-4 text-rose-300" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-300" />
                )}
                <span className="text-sm font-semibold text-white">{item.label}</span>
              </div>
              <p className="text-xs leading-5 text-white/60">{item.hint}</p>
            </button>
          );
        })}
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">Scenario</div>
              <div className="mt-1 text-sm font-medium text-white">{result.scenario}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">Project</div>
              <div className="mt-1 text-sm font-medium text-white">
                {result.project?.project_code || "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">Artifact</div>
              <div className="mt-1 text-sm font-medium text-white">
                {result.state?.artifact?.status || "—"}
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="text-[11px] uppercase tracking-[0.18em] text-white/40">Chain</div>
              <div className="mt-1 text-sm font-medium text-white">
                {result.state?.chain?.status || "—"}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 text-sm font-semibold text-white">Assertions</div>
            <div className="space-y-2">
              {(result.assertions?.checks ?? []).map((check, idx) => (
                <div
                  key={`${check.name}-${idx}`}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-white">{check.name}</div>
                    <div className="mt-0.5 truncate text-xs text-white/45">{pretty(check.actual)}</div>
                  </div>
                  <div
                    className={cx(
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                      check.pass
                        ? "border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                        : "border border-rose-400/30 bg-rose-400/10 text-rose-300"
                    )}
                  >
                    {check.pass ? "PASS" : "FAIL"}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-sm font-semibold text-white">Approval Steps</div>
              <div className="space-y-2">
                {(result.state?.steps ?? []).map((step) => (
                  <div
                    key={step.id}
                    className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-white">
                        {step.step_order}. {step.step_name}
                      </div>
                      <div className="text-xs text-white/60">{step.status || "—"}</div>
                    </div>
                    {step.sla_status ? (
                      <div className="mt-1 text-xs text-amber-300">SLA: {step.sla_status}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="mb-3 text-sm font-semibold text-white">Audit Trail</div>
              <div className="space-y-2">
                {(result.state?.audit ?? []).map((entry, idx) => (
                  <div
                    key={`${entry.created_at}-${idx}`}
                    className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-white">{entry.action || "—"}</div>
                      <div className="text-[11px] text-white/45">
                        {entry.created_at ? new Date(entry.created_at).toLocaleString() : "—"}
                      </div>
                    </div>
                    <div className="mt-1 text-xs text-white/55">{entry.comment || "—"}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}