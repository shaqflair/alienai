"use client";

// src/components/artifacts/DecisionEditor.tsx
import { useState, useMemo, useCallback } from "react";
import {
  Decision,
  DecisionStatus,
  DecisionImpact,
  DecisionCategory,
  DecisionOption,
  DecisionSignal,
  computeDecisionSignals,
  rationaleQualityScore,
  daysTil,
} from "@/lib/decision-intelligence";
import DecisionIntelligencePanel, {
  SignalBadge,
  RationaleScoreBar,
} from "./DecisionIntelligencePanel";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<DecisionStatus, string> = {
  open:        "bg-blue-100 text-blue-700 border-blue-200",
  pending:     "bg-violet-100 text-violet-700 border-violet-200",
  approved:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  implemented: "bg-slate-100 text-slate-600 border-slate-200",
  deferred:    "bg-amber-100 text-amber-700 border-amber-200",
  rejected:    "bg-red-100 text-red-500 border-red-200",
  superseded:  "bg-slate-100 text-slate-400 border-slate-200",
};

const IMPACT_STYLES: Record<DecisionImpact, string> = {
  low:      "text-slate-400",
  medium:   "text-amber-600",
  high:     "text-orange-600 font-semibold",
  critical: "text-red-600 font-bold",
};

function StatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: DecisionStatus[] = [
  "open", "pending", "approved", "implemented", "deferred", "rejected", "superseded"
];
const IMPACT_OPTIONS: DecisionImpact[] = ["low", "medium", "high", "critical"];
const CATEGORY_OPTIONS: DecisionCategory[] = [
  "Technical", "Commercial", "Resource", "Schedule", "Scope",
  "Governance", "Financial", "Regulatory", "Stakeholder", "Other",
];

function blankDecision(existing: Decision[]): Partial<Decision> {
  const count = existing.length + 1;
  const today = new Date().toISOString().slice(0, 10);
  return {
    ref: `D-${String(count).padStart(3, "0")}`,
    title: "",
    context: "",
    rationale: "",
    decision: "",
    category: "Technical",
    status: "open",
    impact: "medium",
    impactDescription: "",
    owner: null,
    approver: null,
    optionsConsidered: [],
    dateRaised: today,
    neededByDate: null,
    approvedDate: null,
    implementationDate: null,
    reviewDate: null,
    reversible: false,
    linkedRisks: [],
    linkedChangeRequests: [],
    linkedMilestones: [],
    tags: [],
    lastUpdated: today,
    notes: "",
  };
}

// ─── Add/Edit drawer ──────────────────────────────────────────────────────────

interface DrawerProps {
  item: Partial<Decision>;
  onSave: (d: Decision) => void;
  onClose: () => void;
}

function DecisionDrawer({ item: initial, onSave, onClose }: DrawerProps) {
  const [form, setForm] = useState<Partial<Decision>>(initial);
  const [newOptionTitle, setNewOptionTitle] = useState("");

  const set = (field: keyof Decision, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const addOption = () => {
    if (!newOptionTitle.trim()) return;
    const option: DecisionOption = {
      id: crypto.randomUUID(),
      title: newOptionTitle.trim(),
      pros: "",
      cons: "",
      selected: false,
    };
    set("optionsConsidered", [...(form.optionsConsidered ?? []), option]);
    setNewOptionTitle("");
  };

  const updateOption = (id: string, field: keyof DecisionOption, value: any) => {
    set("optionsConsidered", (form.optionsConsidered ?? []).map((o) =>
      o.id === id ? { ...o, [field]: value } : o
    ));
  };

  const removeOption = (id: string) => {
    set("optionsConsidered", (form.optionsConsidered ?? []).filter((o) => o.id !== id));
  };

  const rScore = rationaleQualityScore(form as Decision);

  const handleSave = () => {
    if (!form.title?.trim()) return;
    onSave({
      id: form.id ?? crypto.randomUUID(),
      ...form,
      lastUpdated: new Date().toISOString().slice(0, 10),
    } as Decision);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-xl h-full bg-white shadow-2xl overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50 sticky top-0 z-10">
          <h3 className="text-sm font-semibold text-slate-800">
            {form.id ? "Edit" : "Add"} Decision
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-4">
          {/* Ref + Category */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ref</label>
              <input value={form.ref || ""} onChange={(e) => set("ref", e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
              <select value={form.category || "Technical"} onChange={(e) => set("category", e.target.value as DecisionCategory)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400">
                {CATEGORY_OPTIONS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title <span className="text-red-400">*</span></label>
            <input value={form.title || ""} onChange={(e) => set("title", e.target.value)}
              placeholder="Brief decision title"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>

          {/* Context */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Context</label>
            <textarea rows={2} value={form.context || ""} onChange={(e) => set("context", e.target.value)}
              placeholder="Why is this decision needed?"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
          </div>

          {/* The decision */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Decision Statement</label>
            <textarea rows={2} value={form.decision || ""} onChange={(e) => set("decision", e.target.value)}
              placeholder="We have decided to..."
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
          </div>

          {/* Rationale + quality indicator */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-slate-600">Rationale</label>
              <RationaleScoreBar score={rScore} />
            </div>
            <textarea rows={3} value={form.rationale || ""} onChange={(e) => set("rationale", e.target.value)}
              placeholder="Why was this decision made? What evidence supports it?"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
          </div>

          {/* Status + Impact */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select value={form.status || "open"} onChange={(e) => set("status", e.target.value as DecisionStatus)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400">
                {STATUS_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Impact</label>
              <select value={form.impact || "medium"} onChange={(e) => set("impact", e.target.value as DecisionImpact)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400">
                {IMPACT_OPTIONS.map((i) => <option key={i}>{i}</option>)}
              </select>
            </div>
          </div>

          {/* Impact description */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Impact Description</label>
            <input value={form.impactDescription || ""} onChange={(e) => set("impactDescription", e.target.value)}
              placeholder="What is affected by this decision?"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
          </div>

          {/* Owner + Approver */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Owner</label>
              <input value={form.owner || ""} onChange={(e) => set("owner", e.target.value || null)}
                placeholder="Decision owner"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Approver</label>
              <input value={form.approver || ""} onChange={(e) => set("approver", e.target.value || null)}
                placeholder="If different from owner"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Needed By</label>
              <input type="date" value={form.neededByDate || ""} onChange={(e) => set("neededByDate", e.target.value || null)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Approved Date</label>
              <input type="date" value={form.approvedDate || ""} onChange={(e) => set("approvedDate", e.target.value || null)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Implementation Date</label>
              <input type="date" value={form.implementationDate || ""} onChange={(e) => set("implementationDate", e.target.value || null)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Review Date</label>
              <input type="date" value={form.reviewDate || ""} onChange={(e) => set("reviewDate", e.target.value || null)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
            </div>
          </div>

          {/* Reversible */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.reversible || false} onChange={(e) => set("reversible", e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-400" />
            <span className="text-sm text-slate-700">Decision is reversible</span>
          </label>

          {/* Options considered */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-2">Options Considered</label>
            <div className="space-y-2 mb-2">
              {(form.optionsConsidered ?? []).map((opt) => (
                <div key={opt.id} className="rounded-lg border border-slate-200 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      value={opt.title}
                      onChange={(e) => updateOption(opt.id, "title", e.target.value)}
                      placeholder="Option title"
                      className="flex-1 text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    />
                    <label className="flex items-center gap-1 text-xs text-slate-600">
                      <input type="checkbox" checked={opt.selected}
                        onChange={(e) => updateOption(opt.id, "selected", e.target.checked)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-teal-600" />
                      Selected
                    </label>
                    <button onClick={() => removeOption(opt.id)} className="text-slate-400 hover:text-red-500 text-sm">×</button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <textarea rows={1} value={opt.pros} onChange={(e) => updateOption(opt.id, "pros", e.target.value)}
                      placeholder="Pros" className="text-xs border border-slate-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400" />
                    <textarea rows={1} value={opt.cons} onChange={(e) => updateOption(opt.id, "cons", e.target.value)}
                      placeholder="Cons" className="text-xs border border-slate-200 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-teal-400" />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newOptionTitle} onChange={(e) => setNewOptionTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addOption()}
                placeholder="Add option title…"
                className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400" />
              <button onClick={addOption}
                className="text-xs px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition-colors">
                + Add
              </button>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea rows={2} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400 resize-none" />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
          <button onClick={handleSave}
            disabled={!form.title?.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Save Decision
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Decision row ─────────────────────────────────────────────────────────────

function DecisionRow({
  decision,
  signals,
  onEdit,
  onDelete,
}: {
  decision: Decision;
  signals: DecisionSignal[];
  onEdit: (d: Decision) => void;
  onDelete: (id: string) => void;
}) {
  const rowSignals = signals.filter((s) => s.affectedIds.includes(decision.id));
  const isClosed = ["implemented", "rejected", "superseded"].includes(decision.status);
  const rScore = rationaleQualityScore(decision);
  const overdue = decision.neededByDate ? daysTil(decision.neededByDate) : null;

  return (
    <tr className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isClosed ? "opacity-60" : ""}`}>
      <td className="px-3 py-2.5">
        <span className="text-xs font-mono text-slate-500">{decision.ref}</span>
      </td>
      <td className="px-3 py-2.5 max-w-xs">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-slate-800 font-medium truncate">{decision.title}</span>
          {rowSignals.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {rowSignals.map((s, i) => <SignalBadge key={i} signal={s} />)}
            </div>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{decision.category}</span>
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={decision.status} />
      </td>
      <td className="px-3 py-2.5">
        <span className={`text-xs ${IMPACT_STYLES[decision.impact]}`}>
          {decision.impact}
        </span>
      </td>
      <td className="px-3 py-2.5">
        <RationaleScoreBar score={rScore} />
      </td>
      <td className="px-3 py-2.5">
        <span className={`text-xs ${decision.owner ? "text-slate-600" : "text-red-400 font-medium"}`}>
          {decision.owner || "Unowned"}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {decision.neededByDate ? (
          <span className={`text-xs ${overdue !== null && overdue < 0 ? "text-red-600 font-semibold" : overdue !== null && overdue <= 7 ? "text-amber-600" : "text-slate-500"}`}>
            {decision.neededByDate}
            {overdue !== null && overdue < 0 && " ⚠"}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          <button onClick={() => onEdit(decision)}
            className="text-xs text-teal-600 hover:text-teal-800 px-2 py-1 rounded hover:bg-teal-50 transition-colors">
            Edit
          </button>
          <button onClick={() => onDelete(decision.id)}
            className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors">
            ×
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

interface DecisionEditorProps {
  initialDecisions?: Decision[];
  projectName?: string;
  projectContext?: string;
  onSave?: (decisions: Decision[]) => void;
}

export default function DecisionEditor({
  initialDecisions = [],
  projectName,
  projectContext,
  onSave,
}: DecisionEditorProps) {
  const [decisions, setDecisions] = useState<Decision[]>(initialDecisions);
  const [drawerItem, setDrawerItem] = useState<Partial<Decision> | null>(null);
  const [sortField, setSortField] = useState<keyof Decision>("dateRaised");
  const [sortAsc, setSortAsc] = useState(false);
  const [filterStatus, setFilterStatus] = useState<DecisionStatus | "all">("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [showPanel, setShowPanel] = useState(true);

  const signals = useMemo(() => computeDecisionSignals(decisions), [decisions]);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(decisions.map((d) => d.category)))],
    [decisions]
  );

  const filtered = useMemo(() => {
    let base = decisions;
    if (filterStatus !== "all") base = base.filter((d) => d.status === filterStatus);
    if (filterCategory !== "all") base = base.filter((d) => d.category === filterCategory);
    return [...base].sort((a, b) => {
      const va = (a as any)[sortField] ?? "";
      const vb = (b as any)[sortField] ?? "";
      return sortAsc ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
    });
  }, [decisions, filterStatus, filterCategory, sortField, sortAsc]);

  const handleSort = (field: keyof Decision) => {
    if (field === sortField) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const handleSave = useCallback((d: Decision) => {
    setDecisions((prev) => {
      const idx = prev.findIndex((x) => x.id === d.id);
      const next = idx >= 0 ? prev.map((x, i) => (i === idx ? d : x)) : [...prev, d];
      onSave?.(next);
      return next;
    });
    setDrawerItem(null);
  }, [onSave]);

  const handleDelete = useCallback((id: string) => {
    setDecisions((prev) => {
      const next = prev.filter((d) => d.id !== id);
      onSave?.(next);
      return next;
    });
  }, [onSave]);

  const criticalSignals = signals.filter((s) => s.severity === "critical");
  const open = decisions.filter((d) => !["implemented", "rejected", "superseded"].includes(d.status));

  const counts = {
    open: open.length,
    approved: decisions.filter((d) => d.status === "approved").length,
    implemented: decisions.filter((d) => d.status === "implemented").length,
    pending: decisions.filter((d) => d.status === "pending").length,
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Critical signal bar */}
      {criticalSignals.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200">
          <span className="text-red-600 font-semibold text-sm">
            ⚠ {criticalSignals.length} Critical Signal{criticalSignals.length > 1 ? "s" : ""}
          </span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {criticalSignals.map((s, i) => <SignalBadge key={i} signal={s} />)}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Open", value: counts.open, color: "text-blue-600" },
          { label: "Pending", value: counts.pending, color: "text-violet-600" },
          { label: "Approved", value: counts.approved, color: "text-emerald-600" },
          { label: "Implemented", value: counts.implemented, color: "text-slate-500" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-xs text-slate-500 mb-0.5">{s.label}</p>
            <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPanel((v) => !v)}
            className="text-xs text-teal-600 hover:text-teal-800 font-medium"
          >
            {showPanel ? "▲ Hide" : "▼ Show"} Decision Intelligence
          </button>
          <span className="text-slate-300">|</span>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-400">
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-400">
            {categories.map((c) => <option key={c} value={c}>{c === "all" ? "All categories" : c}</option>)}
          </select>
        </div>
        <button
          onClick={() => setDrawerItem(blankDecision(decisions))}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
        >
          + Add Decision
        </button>
      </div>

      {/* Intelligence panel */}
      {showPanel && (
        <DecisionIntelligencePanel
          decisions={decisions}
          signals={signals}
          projectName={projectName}
          projectContext={projectContext}
        />
      )}

      {/* Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                {[
                  { key: "ref", label: "Ref" },
                  { key: "title", label: "Title / Signals" },
                  { key: "category", label: "Category" },
                  { key: "status", label: "Status" },
                  { key: "impact", label: "Impact" },
                  { key: "rationale", label: "Rationale" },
                  { key: "owner", label: "Owner" },
                  { key: "neededByDate", label: "Needed By" },
                  { key: "actions", label: "" },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={() => col.key !== "actions" && handleSort(col.key as keyof Decision)}
                    className={`px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap ${col.key !== "actions" ? "cursor-pointer hover:text-slate-700 select-none" : ""}`}
                  >
                    {col.label}
                    {col.key === sortField && <span className="ml-1 text-teal-500">{sortAsc ? "↑" : "↓"}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-400">
                    No decisions yet.{" "}
                    <button onClick={() => setDrawerItem(blankDecision(decisions))} className="text-teal-600 hover:underline">
                      Add one
                    </button>
                  </td>
                </tr>
              ) : (
                filtered.map((d) => (
                  <DecisionRow
                    key={d.id}
                    decision={d}
                    signals={signals}
                    onEdit={setDrawerItem}
                    onDelete={handleDelete}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Drawer */}
      {drawerItem && (
        <DecisionDrawer
          item={drawerItem}
          onSave={handleSave}
          onClose={() => setDrawerItem(null)}
        />
      )}
    </div>
  );
}
