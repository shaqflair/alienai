// src/components/doa/DoaRulesClient.tsx
"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import AddDoaRuleModal from "./AddDoaRuleModal";

type DoaRule = {
  id: string;
  project_id: string;
  min_amount: number;
  max_amount: number | null;
  currency: string;
  approver_user_id: string;
  approver_name: string | null;
  approver_email: string | null;
  approver_role: string | null;
};

function money(n: any, currency = "GBP") {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return currency === "GBP" ? "£0" : "0";
  if (currency === "GBP") return `£${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `${currency} ${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function band(rule: DoaRule) {
  const cur = rule.currency || "GBP";
  const min = money(rule.min_amount, cur);
  const max = rule.max_amount == null ? "∞" : money(rule.max_amount, cur);
  return `${min} → ${max}`;
}

export default function DoaRulesClient({ projectId }: { projectId: string }) {
  const [rules, setRules] = useState<DoaRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [open, setOpen] = useState(false);
  const [editRule, setEditRule] = useState<DoaRule | null>(null);
  const [isPending, startTransition] = useTransition();

  async function load() {
    setLoading(true);
    setErr("");
    try {
      const url = new URL("/api/doa/rules", window.location.origin);
      url.searchParams.set("projectId", projectId);
      const res = await fetch(url.toString(), { method: "GET" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load DOA rules");
      setRules(Array.isArray(json?.rules) ? json.rules : []);
    } catch (e: any) {
      setErr(String(e?.message || e || "Error"));
      setRules([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const sorted = useMemo(() => {
    const arr = [...rules];
    arr.sort((a, b) => Number(a.min_amount ?? 0) - Number(b.min_amount ?? 0));
    return arr;
  }, [rules]);

  async function removeRule(id: string) {
    const ok = window.confirm("Remove this DOA rule? (This cannot be undone from the UI)");
    if (!ok) return;

    startTransition(async () => {
      try {
        const url = new URL("/api/doa/rules", window.location.origin);
        url.searchParams.set("id", id);
        url.searchParams.set("projectId", projectId);

        const res = await fetch(url.toString(), { method: "DELETE" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to remove rule");

        await load();
      } catch (e: any) {
        alert(String(e?.message || e || "Error"));
      }
    });
  }

  return (
    <section
      style={{
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.10)",
        background: "rgba(16,16,24,0.65)",
        boxShadow: "0 12px 30px rgba(0,0,0,0.45)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: 14,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ color: "rgba(255,255,255,0.92)", fontWeight: 700 }}>Rules</div>
          <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 13 }}>
            Amount band → approver (bands must not overlap).
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button type="button" onClick={() => startTransition(() => load())} disabled={loading || isPending} style={btn("ghost")}>
            ↻ Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setEditRule(null);
              setOpen(true);
            }}
            style={btn("primary")}
          >
            + Add rule
          </button>
        </div>
      </div>

      {err ? <div style={{ padding: 14, color: "rgba(255,160,160,0.95)" }}>{err}</div> : null}

      {loading ? (
        <div style={{ padding: 14, color: "rgba(255,255,255,0.78)" }}>Loading…</div>
      ) : sorted.length === 0 ? (
        <div style={{ padding: 14, color: "rgba(255,255,255,0.78)" }}>
          No DOA rules yet. Click <b>Add rule</b>.
        </div>
      ) : (
        <div style={{ padding: 14 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.05fr 1.35fr 0.7fr 0.9fr",
              gap: 10,
              padding: "10px 10px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.03)",
              color: "rgba(255,255,255,0.75)",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.2,
            }}
          >
            <div>Amount band</div>
            <div>Approver</div>
            <div>Role</div>
            <div>Actions</div>
          </div>

          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {sorted.map((r) => (
              <div
                key={r.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.05fr 1.35fr 0.7fr 0.9fr",
                  gap: 10,
                  padding: "10px 10px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.10)",
                  background: "rgba(18,18,26,0.55)",
                }}
              >
                <div style={{ color: "rgba(255,255,255,0.92)", fontWeight: 700 }}>{band(r)}</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ color: "rgba(255,255,255,0.90)", fontWeight: 650 }}>
                    {r.approver_name || r.approver_email || "Unknown user"}
                  </div>
                  {r.approver_email ? (
                    <div style={{ color: "rgba(255,255,255,0.68)", fontSize: 12 }}>{r.approver_email}</div>
                  ) : null}
                </div>

                <div style={{ color: "rgba(255,255,255,0.78)" }}>{r.approver_role || "—"}</div>

                <div style={{ display: "flex", gap: 8, justifyContent: "flex-start" }}>
                  <button
                    type="button"
                    style={miniBtn("ghost")}
                    onClick={() => {
                      setEditRule(r);
                      setOpen(true);
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" style={miniBtn("danger")} onClick={() => removeRule(r.id)} disabled={isPending}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddDoaRuleModal
        projectId={projectId}
        open={open}
        editRule={editRule}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          setEditRule(null);
          load();
        }}
      />
    </section>
  );
}

function btn(kind: "primary" | "ghost") {
  const base: React.CSSProperties = {
    borderRadius: 12,
    padding: "10px 12px",
    border: "1px solid rgba(255,255,255,0.12)",
    cursor: "pointer",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 700,
    background: "transparent",
  };
  if (kind === "primary") {
    return { ...base, background: "rgba(125, 90, 255, 0.20)", border: "1px solid rgba(125, 90, 255, 0.35)" };
  }
  return { ...base, background: "rgba(255,255,255,0.04)" };
}

function miniBtn(kind: "ghost" | "danger") {
  const base: React.CSSProperties = {
    borderRadius: 10,
    padding: "8px 10px",
    border: "1px solid rgba(255,255,255,0.12)",
    cursor: "pointer",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 800,
    background: "transparent",
    fontSize: 12,
  };
  if (kind === "danger") {
    return { ...base, border: "1px solid rgba(255,120,120,0.25)", background: "rgba(255,120,120,0.10)" };
  }
  return { ...base, background: "rgba(255,255,255,0.04)" };
}
