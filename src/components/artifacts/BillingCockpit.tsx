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

/* ─── Design tokens (mirrors FinancialPlanEditor) ─────────────────── */
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
export type InvoiceStatus =
  | "draft" | "sent" | "overdue" | "paid" | "disputed" | "cancelled";

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
  amount: number | "";            // negative = credit
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
  const due   = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
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
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
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
  draft:      { label: "Draft",      bg: "#F4F4F2", border: P.border,    color: P.textSm, icon: <FileText  style={{ width: 9, height: 9 }} /> },
  sent:       { label: "Sent",       bg: P.navyLt,  border: "#A0BAD0",    color: P.navy,   icon: <Send      style={{ width: 9, height: 9 }} /> },
  overdue:    { label: "Overdue",    bg: P.redLt,   border: "#F0B0AA",    color: P.red,    icon: <AlertTriangle style={{ width: 9, height: 9 }} /> },
  paid:       { label: "Paid",       bg: P.greenLt, border: "#A0D0B8",    color: P.green,  icon: <CheckCircle2  style={{ width: 9, height: 9 }} /> },
  disputed:   { label: "Disputed",   bg: P.amberLt, border: "#E0C080",    color: P.amber,  icon: <AlertCircle   style={{ width: 9, height: 9 }} /> },
  cancelled:  { label: "Cancelled", bg: "#F4F4F2", border: P.borderMd,  color: P.textSm, icon: <XCircle   style={{ width: 9, height: 9 }} /> },
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

/* ─── AI Insight Panel ────────────────────────────────────────────── */
function AiInsightPanel({ invoices, sym, totalForecast, totalBudget }: {
  invoices: Invoice[]; sym: string; totalForecast: number; totalBudget: number;
}) {
  const [open,    setOpen]    = useState(false);
  const [loading, setLoading] = useState(false);
  const [insight, setInsight] = useState<string | null>(null);
  const [error,    setError]   = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const totalInvoiced = invoices.filter(i => i.status !== "cancelled").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalPaid     = invoices.filter(i => i.status === "paid").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalOverdue  = invoices.filter(i => isOverdue(i) || i.status === "overdue").reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const totalDisputed = invoices.filter(i => i.status === "disputed").reduce((s, i) => s + (Number(i.amount) || 0), 0);

  async function fetchInsight() {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError(null);
    setInsight(null);
    try {
      const res = await fetch("/api/ai/billing-insights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalInvoiced, totalPaid, totalOverdue, totalDisputed,
          totalForecast, totalBudget,
          invoiceCount: invoices.length,
          overdueCount: invoices.filter(i => isOverdue(i) || i.status === "overdue").length,
          billingCoverage: totalForecast > 0 ? Math.round((totalInvoiced / totalForecast) * 100) : 0,
          currency: sym,
          invoices: invoices.map(i => ({
            invoice_number: i.invoice_number,
            status: i.status,
            amount: i.amount,
            due_date: i.due_date,
            line_type: i.line_type,
            description: i.description,
          })),
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInsight(data.insight ?? data.message ?? "No insight returned.");
    } catch (e: any) {
      if (e.name !== "AbortError") setError(e.message ?? "Failed to load insight");
    } finally {
      setLoading(false);
    }
  }

  function handleOpen() {
    setOpen(v => !v);
    if (!open && !insight && !loading) fetchInsight();
  }

  return (
    <div style={{ border: `1px solid #E0C080`, background: P.amberLt, overflow: "hidden" }}>
      <button type="button" onClick={handleOpen}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "10px 16px", background: "none", border: "none", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Zap style={{ width: 13, height: 13, color: P.amber }} />
          <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: P.amber, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            AI Billing Insight
          </span>
          {!open && !insight && (
            <span style={{ fontFamily: P.mono, fontSize: 9, color: P.amber, opacity: 0.7 }}>Click to analyse</span>
          )}
          {insight && !open && (
            <span style={{ fontFamily: P.mono, fontSize: 9, color: P.amber, opacity: 0.7 }}>Expand to read</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {open && !loading && (
            <button type="button" onClick={e => { e.stopPropagation(); fetchInsight(); }}
              style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: P.mono, fontSize: 9, color: P.amber, background: "none", border: "none", cursor: "pointer", opacity: 0.7 }}>
              <RefreshCw style={{ width: 10, height: 10 }} /> Refresh
            </button>
          )}
          {open ? <ChevronDown style={{ width: 13, height: 13, color: P.amber }} /> : <ChevronRight style={{ width: 13, height: 13, color: P.amber }} />}
        </div>
      </button>

      {open && (
        <div style={{ padding: "0 16px 14px", borderTop: `1px solid #E0C080` }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0", fontFamily: P.mono, fontSize: 11, color: P.amber }}>
              <div style={{ width: 12, height: 12, border: `2px solid #E0C080`, borderTopColor: P.amber, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              Analysing billing position with GPT-4…
              <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
          )}
          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 0", fontFamily: P.mono, fontSize: 11, color: P.red }}>
              <AlertCircle style={{ width: 12, height: 12 }} /> {error}
            </div>
          )}
          {insight && (
            <div style={{ fontFamily: P.sans, fontSize: 13, color: P.textMd, lineHeight: 1.7, paddingTop: 10, whiteSpace: "pre-wrap" }}>
              {insight}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Resource Burn vs Billable panel ────────────────────────────── */
function BurnVsBillablePanel({
  invoices, sym,
  totalCostToDate, plannedCost, plannedCharge,
  approvedDaysTotal, avgDayRate,
}: {
  invoices: Invoice[]; sym: string;
  totalCostToDate: number; plannedCost: number; plannedCharge: number;
  approvedDaysTotal: number; avgDayRate: number;
}) {
  const totalInvoiced    = invoices.filter(i => i.status !== "cancelled" && (Number(i.amount) || 0) > 0).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const approvedDaysCost = Math.round(approvedDaysTotal * avgDayRate);
  const runningMargin    = plannedCharge - plannedCost;
  const marginPct        = plannedCharge > 0 ? Math.round((runningMargin / plannedCharge) * 100) : null;

  const rows = [
    {
      label: "Cost to Date vs Invoiced",
      left: { label: "Cost incurred", value: fmtK(totalCostToDate, sym), color: P.navy },
      right: { label: "Amount invoiced", value: fmtK(totalInvoiced, sym), color: P.green },
      delta: totalInvoiced - totalCostToDate,
      deltaLabel: ["under-billed", "over-billed"],
    },
    {
      label: "Planned Cost vs Charge-out",
      left: { label: "Planned cost", value: fmtK(plannedCost, sym), color: P.navy },
      right: { label: "Charge-out total", value: fmtK(plannedCharge, sym), color: "#059669" },
      delta: plannedCharge - plannedCost,
      deltaLabel: ["cost > charge", "margin"],
    },
    {
      label: "Approved Days × Rate vs Invoiced",
      left: { label: `${approvedDaysTotal.toFixed(1)} days × rate`, value: fmtK(approvedDaysCost, sym), color: P.violet },
      right: { label: "Amount invoiced", value: fmtK(totalInvoiced, sym), color: P.green },
      delta: totalInvoiced - approvedDaysCost,
      deltaLabel: ["under-billed", "over-billed"],
    },
    {
      label: "Running Margin (Charge − Cost)",
      left: { label: "Charge-out", value: fmtK(plannedCharge, sym), color: "#059669" },
      right: { label: "Internal cost", value: fmtK(plannedCost, sym), color: P.navy },
      delta: runningMargin,
      deltaLabel: ["negative margin", `${marginPct ?? 0}% margin`],
    },
  ];

  return (
    <div style={{ border: `1px solid ${P.borderMd}`, background: P.surface }}>
      <div style={{ padding: "8px 12px", background: P.navyLt, borderBottom: `1px solid #A0BAD0`, fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.navy, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Resource Burn vs Billable
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map((row, i) => {
          const positive = row.delta >= 0;
          return (
            <div key={i} style={{ padding: "10px 12px", borderBottom: i < rows.length - 1 ? `1px solid ${P.border}` : "none" }}>
              <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{row.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: P.mono, fontSize: 13, fontWeight: 700, color: row.left.color }}>{row.left.value}</div>
                  <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>{row.left.label}</div>
                </div>
                <span style={{ color: P.textSm, fontSize: 14 }}>→</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: P.mono, fontSize: 13, fontWeight: 700, color: row.right.color }}>{row.right.value}</div>
                  <div style={{ fontFamily: P.mono, fontSize: 8, color: P.textSm }}>{row.right.label}</div>
                </div>
                {row.delta !== 0 && (
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: positive ? P.green : P.red }}>
                      {positive ? "+" : ""}{fmtK(row.delta, sym)}
                    </div>
                    <div style={{ fontFamily: P.mono, fontSize: 8, color: positive ? P.green : P.red }}>
                      {positive ? row.deltaLabel[1] : row.deltaLabel[0]}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Milestones ready to bill ────────────────────────────────────── */
function MilestonesPanel({ costLines, invoices, sym, onAddInvoice }: {
  costLines: CostLine[]; invoices: Invoice[]; sym: string;
  onAddInvoice: (defaults: Partial<Invoice>) => void;
}) {
  // Lines that have forecast > 0 and haven't been fully invoiced yet
  const alreadyBilled = new Set(invoices.filter(i => i.linked_cost_line_id).map(i => i.linked_cost_line_id));
  const ready = costLines.filter(l => {
    const fct = Number(l.forecast) || 0;
    return fct > 0 && !alreadyBilled.has(l.id);
  });

  return (
    <div style={{ border: `1px solid ${P.borderMd}`, background: P.surface }}>
      <div style={{ padding: "8px 12px", background: P.greenLt, borderBottom: `1px solid #A0D0B8`, fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.green, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Milestones Ready to Bill
        <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.7 }}>{ready.length} item{ready.length !== 1 ? "s" : ""}</span>
      </div>
      {ready.length === 0 ? (
        <div style={{ padding: "20px 12px", textAlign: "center", fontFamily: P.sans, fontSize: 12, color: P.textSm }}>
          All cost lines have been invoiced.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {ready.map(l => (
            <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${P.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: P.sans, fontSize: 11, fontWeight: 600, color: P.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {l.description || l.category}
                </div>
                <div style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>{l.category}</div>
              </div>
              <div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: P.green, flexShrink: 0 }}>
                {fmt(l.forecast, sym)}
              </div>
              <button type="button"
                onClick={() => onAddInvoice({ linked_cost_line_id: l.id, description: l.description || l.category, amount: Number(l.forecast) || "", line_type: "milestone" })}
                style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, background: P.navy, color: "#FFF", border: "none", cursor: "pointer", flexShrink: 0 }}>
                <Plus style={{ width: 9, height: 9 }} /> Bill
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── CRs Awaiting Approval ───────────────────────────────────────── */
function CRsPanel({ changeExposure, invoices, sym, onAddInvoice }: {
  changeExposure: ChangeExposure[]; invoices: Invoice[]; sym: string;
  onAddInvoice: (defaults: Partial<Invoice>) => void;
}) {
  const billedCRs = new Set(invoices.filter(i => i.linked_cr_id).map(i => i.linked_cr_id));
  const pending   = changeExposure.filter(c => c.status === "pending" && !billedCRs.has(c.id));
  const approved  = changeExposure.filter(c => c.status === "approved" && !billedCRs.has(c.id));

  return (
    <div style={{ border: `1px solid ${P.borderMd}`, background: P.surface }}>
      <div style={{ padding: "8px 12px", background: P.amberLt, borderBottom: `1px solid #E0C080`, fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.amber, letterSpacing: "0.08em", textTransform: "uppercase" }}>
        Change Requests
        <span style={{ marginLeft: 8, fontWeight: 400, opacity: 0.7 }}>{pending.length} pending · {approved.length} approved</span>
      </div>
      {pending.length === 0 && approved.length === 0 ? (
        <div style={{ padding: "20px 12px", textAlign: "center", fontFamily: P.sans, fontSize: 12, color: P.textSm }}>
          No outstanding change requests.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {[...approved, ...pending].map(cr => (
            <div key={cr.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${P.border}` }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: P.sans, fontSize: 11, fontWeight: 600, color: P.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cr.change_ref} {cr.title}
                </div>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontFamily: P.mono, fontSize: 8, fontWeight: 700, color: cr.status === "approved" ? P.green : P.amber, marginTop: 2 }}>
                  {cr.status.toUpperCase()}
                </span>
              </div>
              <div style={{ fontFamily: P.mono, fontSize: 12, fontWeight: 700, color: cr.status === "approved" ? P.green : P.amber, flexShrink: 0 }}>
                {fmt(cr.cost_impact, sym)}
              </div>
              {cr.status === "approved" && (
                <button type="button"
                  onClick={() => onAddInvoice({ linked_cr_id: cr.id, description: `${cr.change_ref} ${cr.title}`, amount: Number(cr.cost_impact) || "", line_type: "change_request" })}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, background: P.green, color: "#FFF", border: "none", cursor: "pointer", flexShrink: 0 }}>
                  <Plus style={{ width: 9, height: 9 }} /> Bill
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Invoice row ─────────────────────────────────────────────────── */
function InvoiceRow({
  invoice, sym, costLines, changeExposure, readOnly,
  onChange, onDelete, onEmail,
}: {
  invoice: Invoice; sym: string; costLines: CostLine[];
  changeExposure: ChangeExposure[]; readOnly: boolean;
  onChange: (patch: Partial<Invoice>) => void;
  onDelete: () => void;
  onEmail: () => void;
}) {
  const isCredit  = (Number(invoice.amount) || 0) < 0;
  const isOvd      = isOverdue(invoice);
  const effectiveStatus: InvoiceStatus = isOvd && invoice.status === "sent" ? "overdue" : invoice.status;

  const rowBg = isCredit
    ? "#FFF8F7"
    : effectiveStatus === "paid" ? "#F8FDF9"
    : effectiveStatus === "overdue" ? "#FDF8F7"
    : P.surface;

  const inp: React.CSSProperties = {
    border: "none", background: "transparent", fontFamily: P.mono,
    fontSize: 11, color: P.text, outline: "none", width: "100%", padding: "4px 6px",
  };

  return (
    <tr style={{ background: rowBg, borderBottom: `1px solid ${P.border}` }}>

      {/* Invoice # */}
      <td style={{ padding: "4px 4px", minWidth: 100, borderBottom: `1px solid ${P.border}` }}>
        <input value={invoice.invoice_number} onChange={e => onChange({ invoice_number: e.target.value })}
          readOnly={readOnly} placeholder="INV-001" style={{ ...inp, fontWeight: 700 }} />
        <input type="date" value={invoice.invoice_date} onChange={e => onChange({ invoice_date: e.target.value })}
          readOnly={readOnly} style={{ ...inp, fontSize: 9, color: P.textSm, padding: "0 6px" }} />
      </td>

      {/* Customer */}
      <td style={{ padding: "4px 4px", minWidth: 140, borderBottom: `1px solid ${P.border}` }}>
        <input value={invoice.customer_name} onChange={e => onChange({ customer_name: e.target.value })}
          readOnly={readOnly} placeholder="Customer name" style={{ ...inp, fontWeight: 500 }} />
        <input value={invoice.customer_account} onChange={e => onChange({ customer_account: e.target.value })}
          readOnly={readOnly} placeholder="Account #" style={{ ...inp, fontSize: 9, color: P.textSm, padding: "0 6px" }} />
      </td>

      {/* Description + type */}
      <td style={{ padding: "4px 4px", minWidth: 160, borderBottom: `1px solid ${P.border}` }}>
        <input value={invoice.description} onChange={e => onChange({ description: e.target.value })}
          readOnly={readOnly} placeholder="Description…" style={inp} />
        <select value={invoice.line_type} onChange={e => onChange({ line_type: e.target.value as InvoiceLineType })}
          disabled={readOnly} style={{ ...inp, fontSize: 9, color: P.textSm, padding: "0 4px", cursor: readOnly ? "default" : "pointer" }}>
          {(Object.keys(LINE_TYPE_LABELS) as InvoiceLineType[]).map(t =>
            <option key={t} value={t}>{LINE_TYPE_LABELS[t]}</option>
          )}
        </select>
      </td>

      {/* Amount */}
      <td style={{ padding: "4px 8px", minWidth: 100, textAlign: "right", borderBottom: `1px solid ${P.border}` }}>
        <div style={{ display: "flex", alignItems: "center", gap: 3, justifyContent: "flex-end" }}>
          {isCredit && <span style={{ fontFamily: P.mono, fontSize: 9, color: P.red, fontWeight: 700 }}>CR</span>}
          <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm }}>{sym}</span>
          <input type="number" value={invoice.amount} onChange={e => onChange({ amount: e.target.value === "" ? "" : Number(e.target.value) })}
            readOnly={readOnly} step={100} style={{ ...inp, width: 80, textAlign: "right", fontWeight: 700, fontSize: 12, color: isCredit ? P.red : Number(invoice.amount) > 0 ? P.text : P.textSm }} />
        </div>
        {isCredit && <div style={{ fontFamily: P.mono, fontSize: 8, color: P.red, textAlign: "right" }}>Credit</div>}
      </td>

      {/* Status */}
      <td style={{ padding: "4px 8px", minWidth: 110, borderBottom: `1px solid ${P.border}` }}>
        {readOnly ? (
          <StatusBadge status={effectiveStatus} />
        ) : (
          <select value={invoice.status} onChange={e => onChange({ status: e.target.value as InvoiceStatus })}
            style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, padding: "3px 6px", border: `1px solid ${STATUS_CONFIG[effectiveStatus].border}`, background: STATUS_CONFIG[effectiveStatus].bg, color: STATUS_CONFIG[effectiveStatus].color, cursor: "pointer", outline: "none" }}>
            {(Object.keys(STATUS_CONFIG) as InvoiceStatus[]).map(s =>
              <option key={s} value={s}>{STATUS_CONFIG[s].label}</option>
            )}
          </select>
        )}
        {invoice.status === "paid" && invoice.payment_date && (
          <div style={{ fontFamily: P.mono, fontSize: 8, color: P.green, marginTop: 2 }}>Paid {invoice.payment_date}</div>
        )}
        {invoice.status === "paid" && !readOnly && (
          <input type="date" value={invoice.payment_date} onChange={e => onChange({ payment_date: e.target.value })}
            style={{ ...inp, fontSize: 8, color: P.textSm, padding: "1px 4px", marginTop: 2 }} placeholder="Payment date" />
        )}
      </td>

      {/* Due date */}
      <td style={{ padding: "4px 8px", minWidth: 100, borderBottom: `1px solid ${P.border}` }}>
        <input type="date" value={invoice.due_date} onChange={e => onChange({ due_date: e.target.value })}
          readOnly={readOnly} style={{ ...inp, color: isOvd ? P.red : P.text, fontWeight: isOvd ? 700 : 400 }} />
        {isOvd && <div style={{ fontFamily: P.mono, fontSize: 8, color: P.red }}>OVERDUE</div>}
      </td>

      {/* PO */}
      <td style={{ padding: "4px 4px", minWidth: 110, borderBottom: `1px solid ${P.border}` }}>
        <input value={invoice.po_reference} onChange={e => onChange({ po_reference: e.target.value })}
          readOnly={readOnly} placeholder="PO Ref" style={inp} />
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm, padding: "0 6px" }}>{sym}</span>
          <input type="number" value={invoice.po_value} onChange={e => onChange({ po_value: e.target.value === "" ? "" : Number(e.target.value) })}
            readOnly={readOnly} placeholder="Value" style={{ ...inp, fontSize: 9, color: P.textSm }} />
        </div>
      </td>

      {/* Actions */}
      {!readOnly && (
        <td style={{ padding: "4px 8px", textAlign: "right", borderBottom: `1px solid ${P.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6 }}>
            <button onClick={onEmail} title="Email Invoice"
              style={{ padding: 6, background: P.navyLt, border: `1px solid #A0BAD0`, color: P.navy, cursor: "pointer" }}>
              <Mail style={{ width: 13, height: 13 }} />
            </button>
            <button onClick={onDelete} title="Delete"
              style={{ padding: 6, background: P.redLt, border: `1px solid #F0B0AA`, color: P.red, cursor: "pointer" }}>
              <Trash2 style={{ width: 13, height: 13 }} />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}

/* ─── Main Component ──────────────────────────────────────────────── */
export default function BillingCockpit({
  invoices: initialInvoices = [],
  costLines = [],
  changeExposure = [],
  currency = "GBP",
  totalForecast = 0,
  totalBudget = 0,
  totalCostToDate = 0,
  plannedCost = 0,
  plannedCharge = 0,
  approvedDaysTotal = 0,
  avgDayRate = 0,
  projectName = "",
  projectCode = "",
  readOnly = false,
  onChange,
}: {
  invoices?: Invoice[];
  costLines?: CostLine[];
  changeExposure?: ChangeExposure[];
  currency?: Currency;
  totalForecast?: number;
  totalBudget?: number;
  totalCostToDate?: number;
  plannedCost?: number;
  plannedCharge?: number;
  approvedDaysTotal?: number;
  avgDayRate?: number;
  projectName?: string;
  projectCode?: string;
  readOnly?: boolean;
  onChange?: (invoices: Invoice[]) => void;
}) {
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [emailingInvoice, setEmailingInvoice] = useState<Invoice | null>(null);
  const sym = CURRENCY_SYMBOLS[currency] || currency;

  // Sync internal state if prop changes
  useEffect(() => {
    setInvoices(initialInvoices);
  }, [initialInvoices]);

  const updateInvoices = useCallback((next: Invoice[]) => {
    setInvoices(next);
    onChange?.(next);
  }, [onChange]);

  function addInvoice(defaults: Partial<Invoice> = {}) {
    if (readOnly) return;
    const ni = emptyInvoice({
      currency,
      project_name: projectName,
      project_code: projectCode,
      ...defaults,
    });
    updateInvoices([ni, ...invoices]);
  }

  function patchInvoice(id: string, patch: Partial<Invoice>) {
    if (readOnly) return;
    updateInvoices(invoices.map(i => i.id === id ? { ...i, ...patch } : i));
  }

  function deleteInvoice(id: string) {
    if (readOnly) return;
    if (confirm("Delete this invoice?")) {
      updateInvoices(invoices.filter(i => i.id !== id));
    }
  }

  // Stats
  const totals = useMemo(() => {
    const active = invoices.filter(i => i.status !== "cancelled");
    const totalInvoiced = active.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const totalPaid     = active.filter(i => i.status === "paid").reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const totalOverdue  = active.filter(i => isOverdue(i) || i.status === "overdue").reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const outstanding   = totalInvoiced - totalPaid;
    const coverage      = totalForecast > 0 ? (totalInvoiced / totalForecast) * 100 : 0;

    return { totalInvoiced, totalPaid, totalOverdue, outstanding, coverage };
  }, [invoices, totalForecast]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, padding: "2px 0" }}>

      {/* Top Section: KPIs & Insight */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}>
        <KpiCard label="Total Invoiced" value={fmt(totals.totalInvoiced, sym)} sub={`${totals.coverage.toFixed(1)}% of forecast`} highlight />
        <KpiCard label="Cash Received" value={fmt(totals.totalPaid, sym)} color={P.green} />
        <KpiCard label="Outstanding (AR)" value={fmt(totals.outstanding, sym)} color={totals.outstanding > 0 ? P.navy : P.textSm} />
        <KpiCard label="Total Overdue" value={fmt(totals.totalOverdue, sym)} color={totals.totalOverdue > 0 ? P.red : P.textSm} />
      </div>

      <AiInsightPanel invoices={invoices} sym={sym} totalForecast={totalForecast} totalBudget={totalBudget} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>

        {/* Left Column: Invoice List */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: P.text, letterSpacing: "0.08em", textTransform: "uppercase" }}>
              Invoice Registry ({invoices.length})
            </div>
            {!readOnly && (
              <button onClick={() => addInvoice()}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontFamily: P.mono, fontSize: 10, fontWeight: 700, cursor: "pointer", background: P.navy, color: "#FFF", border: "none" }}>
                <Plus style={{ width: 12, height: 12 }} /> New Invoice
              </button>
            )}
          </div>

          <div style={{ border: `1px solid ${P.borderMd}`, background: P.surface, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ background: P.bg, borderBottom: `1px solid ${P.borderMd}` }}>
                  {["INV# / Date", "Customer", "Description", "Amount", "Status", "Due Date", "PO Ref", ""].map((h, i) => (
                    <th key={i} style={{ padding: "10px 8px", fontFamily: P.mono, fontSize: 9, fontWeight: 700, color: P.textSm, textTransform: "uppercase" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ padding: "40px", textAlign: "center", fontFamily: P.sans, fontSize: 13, color: P.textSm }}>
                      No invoices found. Use "New Invoice" or the billing panels on the right to get started.
                    </td>
                  </tr>
                ) : (
                  invoices.map(inv => (
                    <InvoiceRow
                      key={inv.id}
                      invoice={inv}
                      sym={sym}
                      costLines={costLines}
                      changeExposure={changeExposure}
                      readOnly={readOnly}
                      onChange={patch => patchInvoice(inv.id, patch)}
                      onDelete={() => deleteInvoice(inv.id)}
                      onEmail={() => setEmailingInvoice(inv)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Column: Contextual Billing Panels */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <BurnVsBillablePanel
            invoices={invoices}
            sym={sym}
            totalCostToDate={totalCostToDate}
            plannedCost={plannedCost}
            plannedCharge={plannedCharge}
            approvedDaysTotal={approvedDaysTotal}
            avgDayRate={avgDayRate}
          />
          <MilestonesPanel
            costLines={costLines}
            invoices={invoices}
            sym={sym}
            onAddInvoice={addInvoice}
          />
          <CRsPanel
            changeExposure={changeExposure}
            invoices={invoices}
            sym={sym}
            onAddInvoice={addInvoice}
          />
        </div>
      </div>

      {emailingInvoice && (
        <EmailModal
          invoice={emailingInvoice}
          sym={sym}
          onClose={() => setEmailingInvoice(null)}
        />
      )}
    </div>
  );
}
