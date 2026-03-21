"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Zap, Lock, AlertCircle, Check, ChevronDown, Shield } from "lucide-react";

const P = {
  navy:      "#1B3652",
  navyLt:    "#EBF0F5",
  green:     "#2A6E47",
  greenLt:   "#F0F7F3",
  amber:     "#8A5B1A",
  amberLt:   "#FDF6EC",
  red:       "#B83A2E",
  redLt:     "#FDF2F1",
  violet:    "#0e7490",
  violetLt:  "#ecfeff",
  text:      "#0D0D0B",
  textMd:    "#4A4A46",
  textSm:    "#8A8A84",
  border:    "#E3E3DF",
  surface:   "#FFFFFF",
  mono:      "'DM Mono', 'Courier New', monospace",
  sans:      "'DM Sans', system-ui, sans-serif",
} as const;

type SyncStatus = "idle" | "loading" | "syncing" | "synced" | "error";

type SyncPreview = {
  months_affected:   number;
  missing_rates:     Array<{ id: string; role_title: string; person_name: string | null }>;
  summary:           string;
  role_count:        number;
  rate_coverage:     string;
  overridden_months: string[];
};

type Props = {
  projectId:         string;
  artifactId:        string;
  isAdmin:           boolean;
  currency:          string;
  onSynced?:         () => void;
  lastSyncedAt?:     string | null;
  overriddenMonths:  string[];
  onOverrideChange:  (months: string[]) => void;
};

export default function ResourcePlanSyncBar({
  projectId,
  artifactId,
  isAdmin,
  currency,
  onSynced,
  lastSyncedAt,
  overriddenMonths,
  onOverrideChange,
}: Props) {
  const [status,      setStatus]     = useState<SyncStatus>("idle");
  const [preview,     setPreview]    = useState<SyncPreview | null>(null);
  const [expanded,    setExpanded]   = useState(false);
  const [error,       setError]      = useState<string | null>(null);
  const sym = { GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$" }[currency] ?? "£";

  const loadPreview = useCallback(async () => {
    if (!projectId || !artifactId) return;
    setStatus("loading");
    setError(null);
    try {
      const res  = await fetch(`/api/artifacts/financial-plan/resource-plan-sync?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Load failed");
      setPreview({
        months_affected:   data.forecast.months_affected,
        missing_rates:     data.forecast.missing_rates ?? [],
        summary:           data.forecast.summary,
        role_count:        data.role_count,
        rate_coverage:     data.rate_coverage,
        overridden_months: data.overridden_months ?? [],
      });
      setStatus("idle");
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  }, [projectId, artifactId]);

  useEffect(() => { loadPreview(); }, [loadPreview]);

  async function handleSync() {
    if (!isAdmin) return;
    setStatus("syncing");
    setError(null);
    try {
      const res  = await fetch(
        `/api/artifacts/financial-plan/resource-plan-sync?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`,
        {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ overridden_months: overriddenMonths }),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Sync failed");
      setStatus("synced");
      setTimeout(() => setStatus("idle"), 4000);
      onSynced?.();
      loadPreview();
    } catch (e: any) {
      setError(e.message);
      setStatus("error");
    }
  }

  const hasMissingRates = (preview?.missing_rates.length ?? 0) > 0;
  const isBusy = status === "loading" || status === "syncing";

  const barBg     = status === "synced" ? P.greenLt : status === "error" ? P.redLt : hasMissingRates ? P.amberLt : P.navyLt;
  const barBorder = status === "synced" ? "#A0D0B8"  : status === "error" ? "#F0B0AA"  : hasMissingRates ? "#E0C080"  : "#A0BAD0";

  return (
    <div style={{ border: `1px solid ${barBorder}`, background: barBg, fontFamily: P.sans, marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Users style={{ width: 14, height: 14, flexShrink: 0, color: status === "synced" ? P.green : P.navy }} />
          <div>
            <div style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: status === "synced" ? P.green : P.navy, letterSpacing: "0.04em" }}>
              {status === "synced"   ? "Resource plan synced to financial forecast"
                : status === "loading" ? "Loading resource plan…"
                : status === "syncing" ? "Syncing resource plan to forecast…"
                : status === "error"   ? `Sync error: ${error}`
                : preview
                 ? `Resource plan → financial forecast · ${preview.role_count} roles · ${preview.rate_coverage} rates found`
                 : "Resource plan drives financial forecast"}
            </div>
            <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 2 }}>
              {preview?.summary ?? ""}
              {lastSyncedAt && (
                <span style={{ marginLeft: 8, opacity: 0.6 }}>
                  Last sync: {new Date(lastSyncedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {!isAdmin && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: P.mono, fontSize: 9, color: P.textSm }}>
              <Lock style={{ width: 10, height: 10 }} />
              Admin-only override
            </div>
          )}

          {preview && (preview.months_affected > 0 || hasMissingRates) && (
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: P.mono, fontSize: 10, color: P.navy, cursor: "pointer", background: "none", border: "none", fontWeight: 500 }}
            >
              Details
              <ChevronDown style={{ width: 12, height: 12, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
            </button>
          )}

          {isAdmin && status !== "synced" && (
            <button
              type="button"
              onClick={handleSync}
              disabled={isBusy}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", background: isBusy ? P.textSm : P.navy, color: "#FFF", fontFamily: P.mono, fontSize: 10, fontWeight: 700, border: "none", cursor: isBusy ? "not-allowed" : "pointer", letterSpacing: "0.04em", opacity: isBusy ? 0.6 : 1 }}
            >
              <Zap style={{ width: 11, height: 11 }} />
              {status === "syncing" ? "SYNCING…" : "SYNC TO FORECAST"}
            </button>
          )}

          {status === "synced" && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: P.mono, fontSize: 10, color: P.green, fontWeight: 600 }}>
              <Check style={{ width: 12, height: 12 }} /> Synced
            </span>
          )}
        </div>
      </div>

      {expanded && preview && (
        <div style={{ borderTop: `1px solid ${P.border}`, background: P.surface }}>
          {hasMissingRates && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 16px", background: P.amberLt, borderBottom: `1px solid #E0C080` }}>
              <AlertCircle style={{ width: 13, height: 13, color: P.amber, flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontFamily: P.mono, fontSize: 9, color: P.amber }}>
                <strong>{preview.missing_rates.length} role{preview.missing_rates.length !== 1 ? "s" : ""} missing rate card entries</strong> — cost cannot be calculated:
                <ul style={{ marginTop: 4, paddingLeft: 16, listStyle: "disc" }}>
                  {preview.missing_rates.map(r => (
                    <li key={r.id}>{r.role_title}{r.person_name ? ` (${r.person_name})` : ""}</li>
                  ))}
                </ul>
                <div style={{ marginTop: 4 }}>→ Add rates in <strong>Settings → Rate Card</strong> to include these in the forecast.</div>
              </div>
            </div>
          )}

          {isAdmin && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 16px", background: "#F8F6FE", borderBottom: `1px solid #E0D8F0` }}>
              <Shield style={{ width: 13, height: 13, color: "#6B48C8", flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontFamily: P.mono, fontSize: 9, color: "#4A2E9A" }}>
                <strong>Admin override</strong> — lock specific months to prevent overwrite.
                <div style={{ marginTop: 4 }}>
                  {overriddenMonths.map(m => (
                    <span key={m} style={{ marginRight: 4, marginBottom: 4, display: "inline-block", padding: "1px 6px", background: "#EDE8FC", border: "1px solid #C0B0E0", fontSize: 9, fontFamily: P.mono }}>
                      {m}
                      <button
                        type="button"
                        onClick={() => onOverrideChange(overriddenMonths.filter(x => x !== m))}
                        style={{ marginLeft: 4, background: "none", border: "none", color: "#6B48C8", cursor: "pointer", fontSize: 10, lineHeight: 1 }}
                      >×</button>
                    </span>
                  ))}
                </div>
                <AddOverrideMonthInput
                  onAdd={m => {
                    if (!overriddenMonths.includes(m)) onOverrideChange([...overriddenMonths, m]);
                  }}
                />
              </div>
            </div>
          )}

          <div style={{ padding: "8px 16px", fontFamily: P.mono, fontSize: 9, color: P.textSm }}>
            <strong style={{ color: P.text }}>{preview.months_affected}</strong> months will have forecast updated · <strong style={{ color: P.text }}>{preview.rate_coverage}</strong> roles have rates.
          </div>
        </div>
      )}
    </div>
  );
}

function AddOverrideMonthInput({ onAdd }: { onAdd: (m: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
      <input
        type="month"
        value={val}
        onChange={e => setVal(e.target.value)}
        style={{ border: "1px solid #C0B0E0", background: "#FFF", fontFamily: "'DM Mono',monospace", fontSize: 10, padding: "3px 6px", color: "#0D0D0B", outline: "none" }}
      />
      <button
        type="button"
        onClick={() => { if (val) { onAdd(val); setVal(""); } }}
        disabled={!val}
        style={{ padding: "3px 10px", background: "#6B48C8", color: "#FFF", border: "none", fontFamily: "'DM Mono',monospace", fontSize: 9, fontWeight: 700, cursor: val ? "pointer" : "not-allowed", opacity: val ? 1 : 0.4 }}
      >
        Lock month
      </button>
    </div>
  );
}
