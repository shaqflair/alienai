"use client";

import { useState, useMemo, useCallback } from "react";
import {
  RAIDItem,
  RAIDType,
  RAIDStatus,
  RiskProbability,
  RiskImpact,
  RAIDSignal,
  calcRiskScore,
  computeRAIDSignals,
} from "@/lib/raid-intelligence";
import RAIDIntelligencePanel, { SignalBadge } from "./RAIDIntelligencePanel";

// ─── Utility ─────────────────────────────────────────────────────────────────

function daysTil(d: string) {
  return Math.floor((new Date(d).getTime() - Date.now()) / 86400000);
}

// ─── Status badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<RAIDStatus, string> = {
  open: "bg-blue-100 text-blue-700 border-blue-200",
  in_progress: "bg-violet-100 text-violet-700 border-violet-200",
  mitigated: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-500 border-slate-200",
  accepted: "bg-slate-100 text-slate-600 border-slate-200",
  blocked: "bg-red-100 text-red-700 border-red-200",
  resolved: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

function StatusBadge({ status }: { status: RAIDStatus }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLES[status]}`}>
      {status.replace("_", " ")}
    </span>
  );
}

// ─── Risk score heat ──────────────────────────────────────────────────────────

function RiskHeat({ score }: { score: number }) {
  const style =
    score >= 12
      ? "bg-red-600 text-white"
      : score >= 9
      ? "bg-red-400 text-white"
      : score >= 6
      ? "bg-amber-400 text-slate-900"
      : score >= 3
      ? "bg-yellow-200 text-slate-700"
      : "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-bold ${style}`}>
      {score}
    </span>
  );
}

// ─── Tab types ────────────────────────────────────────────────────────────────

const TABS: { key: RAIDType | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "risk", label: "Risks" },
  { key: "assumption", label: "Assumptions" },
  { key: "issue", label: "Issues" },
  { key: "dependency", label: "Dependencies" },
];

// ─── Empty form template ──────────────────────────────────────────────────────

function blankItem(type: RAIDType, existingItems: RAIDItem[]): Partial<RAIDItem> {
  const prefix = type.charAt(0).toUpperCase();
  const count = existingItems.filter((i) => i.type === type).length + 1;
  return {
    type,
    ref: `${prefix}-${String(count).padStart(3, "0")}`,
    title: "",
    description: "",
    category: "General",
    status: "open",
    impact: "medium",
    probability: type === "risk" ? "medium" : undefined,
    owner: null,
    dateRaised: new Date().toISOString().slice(0, 10),
    dueDate: null,
    lastUpdated: new Date().toISOString().slice(0, 10),
  };
}

// ─── Item row ─────────────────────────────────────────────────────────────────

function RAIDRow({
  item,
  signals,
  onEdit,
  onDelete,
}: {
  item: RAIDItem;
  signals: RAIDSignal[];
  onEdit: (item: RAIDItem) => void;
  onDelete: (id: string) => void;
}) {
  const rowSignals = signals.filter((s) => s.affectedIds.includes(item.id));
  const isClosed = ["closed", "resolved", "mitigated"].includes(item.status);

  return (
    <tr className={`border-b border-slate-100 hover:bg-slate-50 transition-colors ${isClosed ? "opacity-60" : ""}`}>
      <td className="px-3 py-2.5">
        <span className="text-xs font-mono text-slate-500">{item.ref}</span>
      </td>
      <td className="px-3 py-2.5 max-w-xs">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-slate-800 font-medium truncate">{item.title}</span>
          {rowSignals.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {rowSignals.map((s, i) => (
                <SignalBadge key={i} signal={s} />
              ))}
            </div>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">{item.category}</span>
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={item.status} />
      </td>
      {item.type === "risk" && (
        <td className="px-3 py-2.5 text-center">
          {item.probability && item.riskScore !== undefined ? (
            <RiskHeat score={item.riskScore} />
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
      )}
      {item.type !== "risk" && (
        <td className="px-3 py-2.5">
          <span className={`text-xs font-medium ${
            item.impact === "critical" ? "text-red-600" :
            item.impact === "high" ? "text-orange-600" :
            item.impact === "medium" ? "text-amber-600" : "text-slate-400"
          }`}>
            {item.impact}
          </span>
        </td>
      )}
      <td className="px-3 py-2.5">
        <span className="text-xs text-slate-600">{item.owner || <span className="text-red-400 font-medium">Unowned</span>}</span>
      </td>
      <td className="px-3 py-2.5">
        {item.dueDate ? (
          <span className={`text-xs ${daysTil(item.dueDate) < 0 ? "text-red-600 font-semibold" : daysTil(item.dueDate) <= 7 ? "text-amber-600" : "text-slate-500"}`}>
            {item.dueDate}
            {daysTil(item.dueDate) < 0 && " ⚠"}
          </span>
        ) : (
          <span className="text-xs text-slate-300">—</span>
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex gap-1">
          <button
            onClick={() => onEdit(item)}
            className="text-xs text-violet-600 hover:text-violet-800 px-2 py-1 rounded hover:bg-violet-50 transition-colors"
          >
            Edit
          </button>
          <button
            onClick={() => onDelete(item.id)}
            className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors"
          >
            ×
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Add/Edit drawer ──────────────────────────────────────────────────────────

const PROBABILITY_OPTIONS: RiskProbability[] = ["low", "medium", "high", "critical"];
const IMPACT_OPTIONS: RiskImpact[] = ["low", "medium", "high", "critical"];
const STATUS_OPTIONS: RAIDStatus[] = ["open", "in_progress", "mitigated", "accepted", "blocked", "resolved", "closed"];
const CATEGORIES = ["Technical", "Commercial", "Resource", "Regulatory", "Operational", "Dependency", "Schedule", "Stakeholder", "General"];

interface DrawerProps {
  item: Partial<RAIDItem>;
  onSave: (item: RAIDItem) => void;
  onClose: () => void;
}

function RAIDItemDrawer({ item: initial, onSave, onClose }: DrawerProps) {
  const [form, setForm] = useState<Partial<RAIDItem>>(initial);

  const set = (field: keyof RAIDItem, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSave = () => {
    if (!form.title?.trim()) return;
    const riskScore =
      form.type === "risk" && form.probability
        ? calcRiskScore(form.probability, form.impact ?? "medium")
        : undefined;
    onSave({
      id: form.id ?? crypto.randomUUID(),
      ...form,
      riskScore,
      lastUpdated: new Date().toISOString().slice(0, 10),
    } as RAIDItem);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full bg-white shadow-2xl overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
          <h3 className="text-sm font-semibold text-slate-800">
            {form.id ? "Edit" : "Add"} {form.type?.charAt(0).toUpperCase()}{form.type?.slice(1)}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>

        <div className="flex-1 px-5 py-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Ref</label>
              <input value={form.ref || ""} onChange={(e) => set("ref", e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
              <select value={form.category || ""} onChange={(e) => set("category", e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400">
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Title <span className="text-red-400">*</span></label>
            <input value={form.title || ""} onChange={(e) => set("title", e.target.value)}
              placeholder="Brief description"
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
            <textarea rows={3} value={form.description || ""} onChange={(e) => set("description", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Status</label>
              <select value={form.status || "open"} onChange={(e) => set("status", e.target.value as RAIDStatus)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400">
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Impact</label>
              <select value={form.impact || "medium"} onChange={(e) => set("impact", e.target.value as RiskImpact)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400">
                {IMPACT_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          </div>

          {form.type === "risk" && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Probability</label>
              <select value={form.probability || "medium"} onChange={(e) => set("probability", e.target.value as RiskProbability)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400">
                {PROBABILITY_OPTIONS.map((o) => <option key={o}>{o}</option>)}
              </select>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Owner</label>
              <input value={form.owner || ""} onChange={(e) => set("owner", e.target.value || null)}
                placeholder="Name or role"
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Due Date</label>
              <input type="date" value={form.dueDate || ""} onChange={(e) => set("dueDate", e.target.value || null)}
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Mitigation Plan</label>
            <textarea rows={2} value={form.mitigationPlan || ""} onChange={(e) => set("mitigationPlan", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea rows={2} value={form.notes || ""} onChange={(e) => set("notes", e.target.value)}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-violet-400 resize-none" />
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
          <button onClick={handleSave}
            disabled={!form.title?.trim()}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            Save Item
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

interface RAIDEditorProps {
  initialItems?: RAIDItem[];
  projectName?: string;
  projectContext?: string;
  onSave?: (items: RAIDItem[]) => void;
}

export default function RAIDEditor({
  initialItems = [],
  projectName,
  projectContext,
  onSave,
}: RAIDEditorProps) {
  const [items, setItems] = useState<RAIDItem[]>(initialItems);
  const [activeTab, setActiveTab] = useState<RAIDType | "all">("all");
  const [drawerItem, setDrawerItem] = useState<Partial<RAIDItem> | null>(null);
  const [sortField, setSortField] = useState<keyof RAIDItem>("riskScore");
  const [sortAsc, setSortAsc] = useState(false);
  const [showPanel, setShowPanel] = useState(true);

  const signals = useMemo(() => computeRAIDSignals(items), [items]);

  const filtered = useMemo(() => {
    const base = activeTab === "all" ? items : items.filter((i) => i.type === activeTab);
    return [...base].sort((a, b) => {
      const va = (a as any)[sortField] ?? "";
      const vb = (b as any)[sortField] ?? "";
      return sortAsc ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
    });
  }, [items, activeTab, sortField, sortAsc]);

  const handleSort = (field: keyof RAIDItem) => {
    if (field === sortField) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  const handleSaveItem = useCallback((item: RAIDItem) => {
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      const next = idx >= 0 ? prev.map((i, n) => (n === idx ? item : i)) : [...prev, item];
      onSave?.(next);
      return next;
    });
    setDrawerItem(null);
  }, [onSave]);

  const handleDelete = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.filter((i) => i.id !== id);
      onSave?.(next);
      return next;
    });
  }, [onSave]);

  const counts = useMemo(() => ({
    all: items.length,
    risk: items.filter((i) => i.type === "risk").length,
    assumption: items.filter((i) => i.type === "assumption").length,
    issue: items.filter((i) => i.type === "issue").length,
    dependency: items.filter((i) => i.type === "dependency").length,
  }), [items]);

  const criticalSignals = signals.filter((s) => s.severity === "critical");

  return (
    <div className="flex flex-col gap-4">
      {/* Signal bar */}
      {criticalSignals.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200">
          <span className="text-red-600 font-semibold text-sm">⚠ {criticalSignals.length} Critical Signal{criticalSignals.length > 1 ? "s" : ""}</span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {criticalSignals.map((s, i) => <SignalBadge key={i} signal={s} />)}
          </div>
        </div>
      )}

      {/* Intelligence panel toggle */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowPanel((v) => !v)}
          className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
        >
          {showPanel ? "▲ Hide" : "▼ Show"} RAID Intelligence
        </button>
        <button
          onClick={() => setDrawerItem(blankItem(activeTab === "all" ? "risk" : activeTab, items))}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 transition-colors"
        >
          + Add Item
        </button>
      </div>

      {showPanel && (
        <RAIDIntelligencePanel
          items={items}
          signals={signals}
          projectName={projectName}
          projectContext={projectContext}
        />
      )}

      {/* Tabs */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-4 py-3 text-xs font-medium transition-colors border-b-2 -mb-px ${
                activeTab === t.key
                  ? "border-violet-600 text-violet-700 bg-white"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${activeTab === t.key ? "bg-violet-100 text-violet-600" : "bg-slate-200 text-slate-500"}`}>
                {counts[t.key]}
              </span>
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {[
                  { key: "ref", label: "Ref" },
                  { key: "title", label: "Title / Signals" },
                  { key: "category", label: "Category" },
                  { key: "status", label: "Status" },
                  { key: "riskScore", label: activeTab === "all" ? "Score / Impact" : activeTab === "risk" ? "Score" : "Impact" },
                  { key: "owner", label: "Owner" },
                  { key: "dueDate", label: "Due" },
                  { key: "actions", label: "" },
                ].map((col) => (
                  <th
                    key={col.key}
                    onClick={() => col.key !== "actions" && handleSort(col.key as keyof RAIDItem)}
                    className={`px-3 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide ${col.key !== "actions" ? "cursor-pointer hover:text-slate-700 select-none" : ""}`}
                  >
                    {col.label}
                    {col.key === sortField && (
                      <span className="ml-1 text-violet-500">{sortAsc ? "↑" : "↓"}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-400">
                    No {activeTab === "all" ? "" : activeTab} items yet.{" "}
                    <button
                      onClick={() => setDrawerItem(blankItem(activeTab === "all" ? "risk" : activeTab, items))}
                      className="text-violet-600 hover:underline"
                    >
                      Add one
                    </button>
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <RAIDRow
                    key={item.id}
                    item={item}
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
        <RAIDItemDrawer
          item={drawerItem}
          onSave={handleSaveItem}
          onClose={() => setDrawerItem(null)}
        />
      )}
    </div>
  );
}
