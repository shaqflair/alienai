"use client";

import { useCallback, useEffect, useState } from "react";
import { Users, Zap, AlertCircle, RefreshCw } from "lucide-react";

const P = {
  bg:        "#F7F7F5",
  surface:   "#FFFFFF",
  border:    "#E3E3DF",
  borderMd:  "#C8C8C4",
  text:      "#0D0D0B",
  textMd:    "#4A4A46",
  textSm:    "#8A8A84",
  navy:      "#1B3652",
  navyLt:    "#EBF0F5",
  green:     "#2A6E47",
  greenLt:   "#F0F7F3",
  amber:     "#8A5B1A",
  amberLt:   "#FDF6EC",
  violet:    "#0e7490",
  violetLt:  "#ecfeff",
  mono:      "'DM Mono', 'Courier New', monospace",
  sans:      "'DM Sans', system-ui, sans-serif",
} as const;

type PersonSummary = {
  person_id:   string;
  name:        string;
  job_title:   string;
  role_title:  string;
  day_rate:    number | null;
  rate_source: "personal" | "role" | null;
  week_count:  number;
  total_days:  number;
};

type HeatmapData = {
  people:         PersonSummary[];
  role_count:     number;
  rate_coverage:  string;
  forecast: {
    monthly_totals:  Record<string, { days: number; cost: number; has_missing_rates: boolean }>;
    summary:         string;
    months_affected: number;
    total_cost:      number;
  };
};

function Avatar({ name }: { name: string }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div style={{
      width: 32, height: 32, borderRadius: "50%",
      background: "#1B3652", color: "#fff",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 11, fontWeight: 700, flexShrink: 0,
      fontFamily: P.mono,
    }}>
      {initials}
    </div>
  );
}

function MonthBar({ totals, sym }: {
  totals: Record<string, { days: number; cost: number }>;
  sym: string;
}) {
  const months = Object.entries(totals)
    .filter(([, t]) => t.cost > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 12);

  if (!months.length) return null;

  const maxCost = Math.max(...months.map(([, t]) => t.cost));

  return (
    <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 28 }}>
      {months.map(([mk, t]) => {
        const [, mo] = mk.split("-");
        const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        const pct = maxCost > 0 ? (t.cost / maxCost) * 100 : 0;
        return (
          <div key={mk} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <div
              title={`${monthNames[Number(mo) - 1]}: ${sym}${t.cost.toLocaleString()}`}
              style={{
                width: 16,
                height: Math.max(4, Math.round(pct * 0.22)),
                background: "#1B3652",
                borderRadius: 2,
                opacity: 0.7,
              }}
            />
            <div style={{ fontFamily: P.mono, fontSize: 7, color: P.textSm }}>
              {monthNames[Number(mo) - 1].slice(0, 1)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

type Props = {
  projectId:  string;
  artifactId: string;
  currency:   string;
};

export default function HeatmapResourcesPanel({ projectId, artifactId, currency }: Props) {
  const [data,     setData]     = useState<HeatmapData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error,   setError]     = useState<string | null>(null);

  const sym = ({ GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$" } as any)[currency] ?? "£";

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(
        `/api/artifacts/financial-plan/resource-plan-sync?projectId=${encodeURIComponent(projectId)}&artifactId=${encodeURIComponent(artifactId)}`,
        { cache: "no-store" }
      );
      const text = await res.text();
let json: any;
try {
  json = JSON.parse(text);
} catch {
  throw new Error(`API returned non-JSON response (${res.status}). Check the route is deployed.`);
}
if (!res.ok || !json.ok) throw new Error(json.error ?? `HTTP ${res.status}`);      setData({
        people:        json.people ?? [],
        role_count:    json.role_count ?? 0,
        rate_coverage: json.rate_coverage ?? "0/0",
        forecast:      json.forecast ?? { monthly_totals: {}, summary: "", months_affected: 0, total_cost: 0 },
      });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, artifactId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "20px 16px", fontFamily: P.mono, fontSize: 11, color: P.textSm }}>
        <div style={{ width: 14, height: 14, border: `2px solid ${P.border}`, borderTopColor: P.navy, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        Loading resource plan from heatmap…
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", background: "#FDF2F1", border: `1px solid #F0B0AA`, fontFamily: P.mono, fontSize: 11, color: "#B83A2E" }}>
        <AlertCircle style={{ width: 13, height: 13, flexShrink: 0 }} />
        {error}
        <button type="button" onClick={load} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "#B83A2E", fontFamily: P.mono, fontSize: 10, textDecoration: "underline" }}>
          Retry
        </button>
      </div>
    );
  }

  if (!data || data.people.length === 0) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center", fontFamily: P.sans, fontSize: 13, color: P.textSm, border: `1px dashed ${P.border}` }}>
        <Users style={{ width: 24, height: 24, color: P.border, margin: "0 auto 8px" }} />
        <div style={{ fontWeight: 600, color: P.textMd, marginBottom: 4 }}>No allocations found</div>
        <div>Allocate people to this project on the capacity heatmap — they will appear here automatically.</div>
      </div>
    );
  }

  const totalDays   = data.people.reduce((s, p) => s + p.total_days, 0);
  const totalCost   = data.forecast.total_cost ?? 0;
  const missingRate = data.people.filter(p => p.day_rate == null);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0, border: `1px solid ${P.borderMd}`, fontFamily: P.sans }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", background: P.navyLt, borderBottom: `1px solid ${P.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Users style={{ width: 13, height: 13, color: P.navy }} />
          <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: P.navy, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            From Capacity Heatmap · {data.people.length} {data.people.length === 1 ? "person" : "people"}
          </span>
          <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>
            {data.rate_coverage} rates · {totalDays.toFixed(1)} days · {sym}{totalCost.toLocaleString()}
          </span>
        </div>
        <button
          type="button"
          onClick={load}
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "none", cursor: "pointer", fontFamily: P.mono, fontSize: 9, color: P.navy, opacity: 0.7 }}
          title="Refresh from heatmap"
        >
          <RefreshCw style={{ width: 11, height: 11 }} />
          Refresh
        </button>
      </div>

      {missingRate.length > 0 && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 16px", background: P.amberLt, borderBottom: `1px solid #E0C080` }}>
          <AlertCircle style={{ width: 12, height: 12, color: P.amber, flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontFamily: P.mono, fontSize: 9, color: P.amber }}>
            <strong>{missingRate.map(p => p.name).join(", ")}</strong>
            {missingRate.length === 1 ? " has" : " have"} no rate card entry — add their job title to the rate card to include them in the forecast.
          </div>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 80px 100px 140px", gap: 0, padding: "6px 16px", background: "#F4F4F2", borderBottom: `1px solid ${P.borderMd}` }}>
        {["Person", "Job Title", "Rate / Day", "Weeks", "Total Days", "Monthly Spread"].map((h, i) => (
          <div key={i} style={{ fontFamily: P.mono, fontSize: 8, fontWeight: 600, color: P.textSm, letterSpacing: "0.08em", textTransform: "uppercase" }}>{h}</div>
        ))}
      </div>

      {data.people.map((person, idx) => {
        const hasRate   = person.day_rate != null;
        const rowBg     = idx % 2 === 0 ? P.surface : "#FAFAF8";
        const forecast  = data.forecast.monthly_totals;

        const personFraction = totalDays > 0 ? person.total_days / totalDays : 0;
        const personTotals: Record<string, { days: number; cost: number }> = {};
        for (const [mk, t] of Object.entries(forecast)) {
          personTotals[mk] = {
            days: Math.round(t.days * personFraction * 10) / 10,
            cost: Math.round(t.cost * personFraction),
          };
        }

        return (
          <div
            key={person.person_id}
            style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 80px 100px 140px", gap: 0, padding: "10px 16px", background: rowBg, borderBottom: `1px solid ${P.border}`, alignItems: "center" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Avatar name={person.name} />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: P.text }}>{person.name}</div>
                {person.role_title && person.role_title !== person.job_title && (
                  <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, marginTop: 1 }}>{person.role_title}</div>
                )}
              </div>
            </div>
            <div style={{ fontFamily: P.mono, fontSize: 10, color: P.textMd }}>{person.job_title || "—"}</div>
            <div>
              {hasRate ? (
                <>
                  <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.navy }}>{sym}{person.day_rate!.toLocaleString()}</div>
                  <div style={{ fontFamily: P.mono, fontSize: 8, color: P.green, marginTop: 1 }}>
                    {person.rate_source === "personal" ? "personal" : "role rate"}
                  </div>
                </>
              ) : (
                <div style={{ fontFamily: P.mono, fontSize: 9, color: P.amber, fontWeight: 600 }}>No rate</div>
              )}
            </div>
            <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 600, color: P.text }}>
              {person.week_count}
              <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>weeks</div>
            </div>
            <div>
              <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.navy }}>{person.total_days.toFixed(1)}</div>
              {hasRate && (
                <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm, marginTop: 1 }}>
                  {sym}{(person.total_days * person.day_rate!).toLocaleString("en-GB", { maximumFractionDigits: 0 })} total
                </div>
              )}
            </div>
            <div><MonthBar totals={personTotals} sym={sym} /></div>
          </div>
        );
      })}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 80px 100px 140px", gap: 0, padding: "8px 16px", background: "#F0F0ED", borderTop: `1px solid ${P.borderMd}` }}>
        <div style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.textMd, letterSpacing: "0.06em", textTransform: "uppercase", display: "flex", alignItems: "center" }}>
          Total · {data.people.length} people
        </div>
        <div /><div /><div />
        <div>
          <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.text }}>{totalDays.toFixed(1)}</div>
          <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>days</div>
        </div>
        <div>
          {totalCost > 0 && (
            <div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.navy }}>
              {sym}{totalCost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
            </div>
          )}
          <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>{data.forecast.months_affected} months</div>
        </div>
      </div>
    </div>
  );
}
