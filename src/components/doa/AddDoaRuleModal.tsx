// src/components/doa/AddDoaRuleModal.tsx
"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import MemberPicker from "./MemberPicker";

type Member = {
  userId: string;
  name: string;
  email?: string;
  role?: string;
};

type DoaRuleLike = {
  id?: string;
  min_amount?: number;
  max_amount?: number | null;
  currency?: string;
  approver_user_id?: string;
  approver_name?: string | null;
  approver_email?: string | null;
  approver_role?: string | null;
};

function safeNum(x: any): number | null {
  if (x === "" || x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

export default function AddDoaRuleModal({
  projectId,
  open,
  onClose,
  onSaved,
  editRule,
}: {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  editRule?: DoaRuleLike | null; // ✅ if set, modal is "Edit"
}) {
  const isEdit = !!editRule?.id;

  const [minAmount, setMinAmount] = useState<string>("");
  const [maxAmount, setMaxAmount] = useState<string>(""); // empty = infinity
  const [currency, setCurrency] = useState<string>("GBP");
  const [approver, setApprover] = useState<Member | null>(null);

  const [err, setErr] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!open) return;

    setErr("");

    if (editRule?.id) {
      setMinAmount(String(editRule.min_amount ?? 0));
      setMaxAmount(editRule.max_amount == null ? "" : String(editRule.max_amount));
      setCurrency(String(editRule.currency ?? "GBP"));

      setApprover({
        userId: String(editRule.approver_user_id ?? ""),
        name: String(editRule.approver_name ?? editRule.approver_email ?? "Approver"),
        email: editRule.approver_email ?? "",
        role: editRule.approver_role ?? "",
      });
    } else {
      setMinAmount("");
      setMaxAmount("");
      setCurrency("GBP");
      setApprover(null);
    }
  }, [open, editRule]);

  const validation = useMemo(() => {
    const min = safeNum(minAmount);
    const max = safeNum(maxAmount);
    if (min == null) return "Enter a valid minimum amount";
    if (min < 0) return "Minimum must be ≥ 0";
    if (maxAmount !== "" && max == null) return "Enter a valid maximum amount (or leave blank for ∞)";
    if (max != null && max < min) return "Maximum must be ≥ minimum";
    if (!approver?.userId) return "Select an approver";
    return "";
  }, [minAmount, maxAmount, approver]);

  async function submit() {
    setErr("");
    if (validation) return setErr(validation);

    const min = safeNum(minAmount)!;
    const max = maxAmount === "" ? null : safeNum(maxAmount);

    startTransition(async () => {
      try {
        const res = await fetch("/api/doa/rules", {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(isEdit ? { id: editRule?.id } : {}),
            projectId,
            minAmount: min,
            maxAmount: max,
            currency,
            approverUserId: approver?.userId,
            approverName: approver?.name,
            approverEmail: approver?.email,
            approverRole: approver?.role,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to save rule");

        onSaved();
      } catch (e: any) {
        setErr(String(e?.message || e || "Error"));
      }
    });
  }

  if (!open) return null;

  return (
    <div style={overlay} role="dialog" aria-modal="true">
      <div style={modal}>
        <div style={header}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "rgba(255,255,255,0.92)" }}>
              {isEdit ? "Edit DOA rule" : "Add DOA rule"}
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: "rgba(255,255,255,0.70)" }}>
              Bands must not overlap.
            </div>
          </div>
          <button type="button" onClick={onClose} style={iconBtn} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {err ? (
            <div
              style={{
                padding: 10,
                borderRadius: 12,
                border: "1px solid rgba(255,120,120,0.25)",
                background: "rgba(255,120,120,0.08)",
                color: "rgba(255,200,200,0.95)",
              }}
            >
              {err}
            </div>
          ) : null}

          <div style={grid2}>
            <Field label="Currency">
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={input}>
                <option value="GBP">GBP</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
              </select>
            </Field>

            <Field label="Approver">
              <MemberPicker projectId={projectId} value={approver} onChange={setApprover} />
            </Field>
          </div>

          <div style={grid2}>
            <Field label="Min amount">
              <input value={minAmount} onChange={(e) => setMinAmount(e.target.value)} inputMode="decimal" style={input} />
            </Field>

            <Field label="Max amount (blank = ∞)">
              <input value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} inputMode="decimal" style={input} />
            </Field>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, paddingTop: 6 }}>
            <button type="button" onClick={onClose} style={btn("ghost")} disabled={isPending}>
              Cancel
            </button>
            <button type="button" onClick={submit} style={btn("primary")} disabled={isPending}>
              {isPending ? "Saving…" : isEdit ? "Save changes" : "Create rule"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.75)" }}>{label}</span>
      {children}
    </label>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 80,
  background: "rgba(0,0,0,0.62)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modal: React.CSSProperties = {
  width: "min(860px, 96vw)",
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(10,10,15,0.98)",
  boxShadow: "0 18px 48px rgba(0,0,0,0.65)",
  overflow: "hidden",
};

const header: React.CSSProperties = {
  padding: 14,
  borderBottom: "1px solid rgba(255,255,255,0.08)",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 10,
};

const iconBtn: React.CSSProperties = {
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "rgba(255,255,255,0.92)",
  width: 38,
  height: 38,
  cursor: "pointer",
};

const grid2: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(18,18,26,0.6)",
  color: "rgba(255,255,255,0.92)",
  outline: "none",
};

function btn(kind: "primary" | "ghost") {
  const base: React.CSSProperties = {
    borderRadius: 12,
    padding: "10px 12px",
    border: "1px solid rgba(255,255,255,0.12)",
    cursor: "pointer",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 800,
    background: "transparent",
  };
  if (kind === "primary") {
    return { ...base, background: "rgba(125, 90, 255, 0.20)", border: "1px solid rgba(125, 90, 255, 0.35)" };
  }
  return { ...base, background: "rgba(255,255,255,0.04)" };
}
