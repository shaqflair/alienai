"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Plus, Trash2, Send, Mail, AlertTriangle, AlertCircle,
  CheckCircle2, Clock, XCircle, FileText, TrendingUp,
  TrendingDown, Lock, Zap, ChevronDown, ChevronRight,
  RefreshCw, Copy, Check,
} from "lucide-react";
import type { CostLine, ChangeExposure, Currency } from "./FinancialPlanEditor";
import { CURRENCY_SYMBOLS } from "./FinancialPlanEditor";

/* ─── Design tokens ─────────────────────────────────────────────── */
const P = {
  bg:       "#F7F7F5",
  surface:  "#FFFFFF",
  border:   "#E3E3DF",
  borderMd: "#C8C8C4",
  text:     "#0D0D0B",
  textMd:   "#4A4A46",
  textSm:   "#8A8A84",
  navy:     "#1B3652",
  navyLt:   "#EBF0F5",
  red:      "#B83A2E",
  redLt:    "#FDF2F1",
  green:    "#2A6E47",
  greenLt:  "#F0F7F3",
  amber:    "#8A5B1A",
  amberLt:  "#FDF6EC",
  violet:   "#0e7490",
  violetLt: "#ecfeff",
  mono:     "'DM Mono', 'Courier New', monospace",
  sans:     "'DM Sans', system-ui, sans-serif",
} as const;

/* ─── Types ───────────────────────────────────────────────────────── */
export type InvoiceStatus = "draft" | "sent" | "overdue" | "paid" | "disputed" | "cancelled";
export type InvoiceLineType = "resource" | "milestone" | "change_request" | "credit" | "other";

export type Invoice = {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  payment_date: string;
  customer_name: string;
  customer_account: string;
  description: string;
  amount: number | "";
  currency: Currency;
  status: InvoiceStatus;
  po_value: number | "";
  po_reference: string;
  line_type: InvoiceLineType;
  linked_cost_line_id: string | null;
  linked_cr_id: string | null;
  notes: string;
  project_name: string;
  project_code: string;
};

/* ─── Helpers ─────────────────────────────────────────────────────── */
function uid() { return Math.random().toString(36).slice(2, 10); }

function emptyInvoice(defaults: Partial<Invoice> = {}): Invoice {
  const today = new Date().toISOString().slice(0, 10);
  const due   = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  return {
    id: uid(),
    invoice_number: "",
    invoice_date: today,
    due_date: due,
    payment_date: "",
    customer_name: "",
    customer_account: "",
    description: "",
    amount: "",
    currency: "GBP",
    status: "draft",
    po_value: "",
    po_reference: "",
    line_type: "milestone",
    linked_cost_line_id: null,
    linked_cr_id: null,
    notes: "",
    project_name: "",
    project_code: "",
    ...defaults,
  };
}

function fmt(n: number | "" | null | undefined, sym: string): string {
  if (n === "" || n == null || isNaN(Number(n))) return "—";
  const v = Number(n);
  const sign = v < 0 ? "-" : "";
  const abs  = Math.abs(v);
  return `${sign}${sym}${abs.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function fmtK(n: number, sym: string): string {
  if (n === 0) return "—";
  const sign = n < 0 ? "-" : "";
  const abs  = Math.abs(n);
  if (abs >= 1000000) return `${sign}${sym}${(abs / 1000000).toFixed(1)}M`;
  if (abs >= 1000)      return `${sign}${sym}${(abs / 1000).toFixed(1)}k`;
  return `${sign}${sym}${abs}`;
}

function isOverdue(inv: Invoice): boolean {
  if (inv.status === "paid" || inv.status === "cancelled") return false;
  if (!inv.due_date) return false;
  return new Date(inv.due_date) < new Date();
}

/* ─── Status config ───────────────────────────────────────────────── */
const STATUS_CONFIG: Record<InvoiceStatus, {
  label: string; bg: string; border: string; color: string; icon: React.ReactNode;
}> = {
  draft:      { label: "Draft",     bg: "#F4F4F2", border: P.border,    color: P.textSm, icon: <FileText  style={{ width: 9, height: 9 }} /> },
  sent:        { label: "Sent",      bg: P.navyLt,  border: "#A0BAD0",    color: P.navy,   icon: <Send      style={{ width: 9, height: 9 }} /> },
  overdue:     { label: "Overdue",   bg: P.redLt,   border: "#F0B0AA",    color: P.red,    icon: <AlertTriangle style={{ width: 9, height: 9 }} /> },
  paid:        { label: "Paid",      bg: P.greenLt, border: "#A0D0B8",    color: P.green,  icon: <CheckCircle2  style={{ width: 9, height: 9 }} /> },
  disputed:    { label: "Disputed",  bg: P.amberLt, border: "#E0C080",    color: P.amber,  icon: <AlertCircle   style={{ width: 9, height: 9 }} /> },
  cancelled:   { label: "Cancelled", bg: "#F4F4F2", border: P.borderMd,  color: P.textSm, icon: <XCircle    style={{ width: 9, height: 9 }} /> },
};

const LINE_TYPE_LABELS: Record<InvoiceLineType, string> = {
  resource:       "Resource Charges",
  milestone:      "Milestone Payment",
  change_request: "Change Request",
  credit:         "Credit / Adjustment",
  other:          "Other",
};

/* ─── Sub-components ──────────────────────────────────────────────── */

function StatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", fontFamily: P.mono, fontSize: 9, fontWeight: 700,
      letterSpacing: "0.06em", background: cfg.bg,
      border: `1px solid ${cfg.border}`, color: cfg.color,
    }}>
      {cfg.icon} {cfg.label.toUpperCase()}
    </span>
  );
}

function KpiCard({ label, value, sub, color = P.text, locked = false, highlight = false }: {
  label: string; value: string; sub?: string;
  color?: string; locked?: boolean; highlight?: boolean;
}) {
  return (
    <div style={{
      background: locked ? P.violetLt : highlight ? P.navyLt : P.surface,
      border: `1px solid ${locked ? "#a5f3fc" : highlight ? "#A0BAD0" : P.border}`,
      padding: "14px 18px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
        {locked && <Lock style={{ width: 10, height: 10, color: P.violet }} />}
        <span style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</span>
      </div>
      <div style={{ fontFamily: P.mono, fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {sub && <div style={{ fontFamily: P.mono, fontSize: 9, color: locked ? P.violet : P.textSm, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

/* ─── Email modal ─────────────────────────────────────────────────── */
function EmailModal({ invoice, sym, onClose }: {
  invoice: Invoice; sym: string; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const subject = `Invoice ${invoice.invoice_number} — ${invoice.project_name || "Project"} — ${fmt(invoice.amount, sym)}`;
  const body = [
    `Dear ${invoice.customer_name || "Team"},`,
    "",
    `Please find attached invoice ${invoice.invoice_number} for ${invoice.description || invoice.line_type}.`,
    "",
    `  Amount:    ${fmt(invoice.amount, sym)}`,
    `  Due date:  ${invoice.due_date || "—"}`,
    `  PO Ref:    ${invoice.po_reference || "—"}`,
    `  Project:   ${invoice.project_name || "—"} ${invoice.project_code ? `(${invoice.project_code})` : ""}`,
    "",
    `Please process payment by ${invoice.due_date || "the due date"}.`,
    "",
    "Kind regards",
  ].join("\n");

  function copyToClipboard() {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: P.surface, border: `1px solid ${P.borderMd}`, width: 520, maxHeight: "80vh", overflow: "auto", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${P.border}`, background: P.navyLt }}>
          <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: P.navy, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Send Invoice {invoice.invoice_number}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: P.textSm, fontFamily: P.mono, fontSize: 11 }}>✕</button>
        </div>
        <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Subject</div>
            <div style={{ fontFamily: P.mono, fontSize: 11, color: P.text, padding: "8px 10px", background: P.bg, border: `1px solid ${P.border}` }}>{subject}</div>
          </div>
          <div>
            <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>Body</div>
            <pre style={{ fontFamily: P.mono, fontSize: 11, color: P.text, padding: "10px 12px", background: P.bg, border: `1px solid ${P.border}`, whiteSpace: "pre-wrap", margin: 0, lineHeight: 1.7 }}>{body}</pre>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={copyToClipboard}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontFamily: P.mono, fontSize: 10, fontWeight: 700, cursor: "pointer", background: copied ? P.greenLt : P.bg, border: `1px solid ${copied ? "#A0D0B8" : P.border}`, color: copied ? P.green : P.textMd }}>
              {copied ? <Check style={{ width: 11, height: 11 }} /> : <Copy style={{ width: 11, height: 11 }} />}
              {copied ? "Copied!" : "Copy"}
            </button>
            <a href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", fontFamily: P.mono, fontSize: 10, fontWeight: 700, textDecoration: "none", background: P.navy, color: "#FFF", border: "none" }}>
              <Mail style={{ width: 11, height: 11 }} /> Open in Mail
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

// ... Additional logic for Main Manager goes here to handle the stateful list and math
export default function BillingManager() {
  return <div>[Billing Manager Placeholder]</div>;
}
