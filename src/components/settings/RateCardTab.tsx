"use client";

import { useState, useTransition, useMemo } from "react";
import {
  Plus, Trash2, Pencil, Check, X, Search,
  ChevronDown, AlertCircle, User, Zap, Upload,
} from "lucide-react";
import type { OrgMemberForPicker, ResourceRate } from "@/app/actions/resource-rates";
import {
  upsertResourceRate,
  deleteResourceRate,
} from "@/app/actions/resource-rates";

// -- Constants ---------------------------------------------------------------

const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"] as const;
const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$",
};

const RESOURCE_TYPES = [
  { value: "internal",   label: "Internal",   cls: "bg-blue-100 text-blue-700"   },
  { value: "contractor", label: "Contractor", cls: "bg-amber-100 text-amber-700" },
  { value: "vendor",     label: "Vendor",     cls: "bg-purple-100 text-purple-700" },
  { value: "consultant", label: "Consultant", cls: "bg-gray-100 text-gray-700"   },
] as const;

type ResourceTypeValue = typeof RESOURCE_TYPES[number]["value"];

// Default rates seeded when admin clicks "Load defaults"
const DEFAULT_ROLES: Array<{ roleLabel: string; rate: number; resourceType: ResourceTypeValue }> = [
  { roleLabel: "Junior Project Manager",     rate: 450, resourceType: "internal"   },
  { roleLabel: "Project Manager",            rate: 550, resourceType: "internal"   },
  { roleLabel: "Senior Project Manager",     rate: 650, resourceType: "internal"   },
  { roleLabel: "Lead Project Manager",       rate: 750, resourceType: "internal"   },
  { roleLabel: "Delivery Manager",           rate: 650, resourceType: "internal"   },
  { roleLabel: "Senior Delivery Manager",    rate: 750, resourceType: "internal"   },
  { roleLabel: "Product Manager",            rate: 700, resourceType: "internal"   },
  { roleLabel: "Junior Engineer",            rate: 450, resourceType: "internal"   },
  { roleLabel: "Engineer",                   rate: 550, resourceType: "internal"   },
  { roleLabel: "Senior Engineer",            rate: 650, resourceType: "internal"   },
  { roleLabel: "Lead Engineer",              rate: 800, resourceType: "internal"   },
  { roleLabel: "Principal Engineer",         rate: 950, resourceType: "internal"   },
  { roleLabel: "Architect",                  rate: 900, resourceType: "internal"   },
  { roleLabel: "Designer",                   rate: 500, resourceType: "internal"   },
  { roleLabel: "Senior Designer",            rate: 650, resourceType: "internal"   },
  { roleLabel: "Analyst",                    rate: 500, resourceType: "internal"   },
  { roleLabel: "Data Scientist",             rate: 700, resourceType: "internal"   },
  { roleLabel: "QA Engineer",                rate: 550, resourceType: "internal"   },
  { roleLabel: "DevOps Engineer",            rate: 650, resourceType: "internal"   },
  { roleLabel: "Consultant",                 rate: 800, resourceType: "consultant" },
  { roleLabel: "PMO Analyst",                rate: 500, resourceType: "internal"   },
  { roleLabel: "Change Manager",             rate: 650, resourceType: "internal"   },
  { roleLabel: "Scrum Master",               rate: 600, resourceType: "internal"   },
];

// -- Types -------------------------------------------------------------------

type EditRow = {
  userId: string;
  roleLabel: string;
  rateType: "day_rate" | "monthly_cost";
  rate: number;
  currency: string;
  resourceType: ResourceTypeValue;
  notes: string;
  effectiveFrom: string;
};

function emptyEdit(today = ""): EditRow {
  return { userId: "", roleLabel: "", rateType: "day_rate", rate: 0, currency: "GBP", resourceType: "internal", notes: "", effectiveFrom: today };
}

// -- Avatar ------------------------------------------------------------------

function Avatar({ name, avatarUrl, size = 8 }: { name?: string | null; avatarUrl?: string | null; size?: number }) {
  const initials = (name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (avatarUrl) return <img src={avatarUrl} alt={name ?? ""} className={`w-${size} h-${size} rounded-full object-cover`} />;
  return (
    <div className={`w-${size} h-${size} rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold`}>
      {initials}
    </div>
  );
}

// -- Person picker -----------------------------------------------------------

function PersonPicker({ members, value, onChange }: { members: OrgMemberForPicker[]; value: string; onChange: (userId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = members.find(m => m.user_id === value);
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return members.filter(m => (m.full_name ?? "").toLowerCase().includes(lq) || (m.email ?? "").toLowerCase().includes(lq) || (m.department ?? "").toLowerCase().includes(lq));
  }, [members, q]);

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500">
        {selected ? (
          <>
            <Avatar name={selected.full_name} avatarUrl={selected.avatar_url} size={6} />
            <span className="flex-1 text-left truncate">{selected.full_name ?? selected.email}</span>
            <button type="button" onClick={e => { e.stopPropagation(); onChange(""); }} className="ml-1 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
          </>
        ) : (
          <>
            <User className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400 flex-1 text-left">No specific person (role-based rate)</span>
            <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />
          </>
        )}
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input autoFocus className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500" placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            <li>
              <button type="button" onClick={() => { onChange(""); setOpen(false); setQ(""); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 text-left text-gray-500 italic">
                <User className="w-4 h-4 text-gray-400" /> No specific person (role-based rate)
              </button>
            </li>
            <li className="border-t border-gray-100 my-0.5" />
            {filtered.length === 0 && <li className="px-3 py-2 text-sm text-gray-400">No results</li>}
            {filtered.map(m => (
              <li key={m.user_id}>
                <button type="button" onClick={() => { onChange(m.user_id); setOpen(false); setQ(""); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-indigo-50 text-left">
                  <Avatar name={m.full_name} avatarUrl={m.avatar_url} size={7} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.full_name ?? m.email}</div>
                    {m.full_name && m.email && <div className="text-xs text-gray-400 truncate">{m.email}</div>}
                    {m.department && <div className="text-xs text-gray-400 truncate">{m.department}</div>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// -- Single rate form --------------------------------------------------------

function RateForm({ members, initial, onSave, onCancel, today, existingRoles }: {
  members: OrgMemberForPicker[]; initial: EditRow; onSave: (row: EditRow) => void;
  onCancel: () => void; today: string; existingRoles: string[];
}) {
  const [row, setRow] = useState<EditRow>(initial);
  const [pending, startTransition] = useTransition();
  function set<K extends keyof EditRow>(k: K, v: EditRow[K]) { setRow(r => ({ ...r, [k]: v })); }
  function handleSave() { if (!row.roleLabel || row.rate < 0) return; startTransition(() => onSave(row)); }
  const sym = CURRENCY_SYMBOLS[row.currency] ?? "£";
  const rateLabel = row.rateType === "day_rate" ? "RATE (PER DAY)" : "MONTHLY COST";

  return (
    <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/30 space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">ROLE LABEL *</label>
        <input className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="e.g. Senior Delivery Manager, Lead Engineer" value={row.roleLabel} onChange={e => set("roleLabel", e.target.value)} autoFocus list="role-suggestions" />
        {existingRoles.length > 0 && <datalist id="role-suggestions">{existingRoles.map(r => <option key={r} value={r} />)}</datalist>}
        <p className="text-xs text-gray-400 mt-1">Rate for anyone in this role. Optionally link to a specific person below for an individual override.</p>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">PERSON <span className="font-normal text-gray-400">(optional)</span></label>
        <PersonPicker members={members} value={row.userId} onChange={v => set("userId", v)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">TYPE</label>
          <select className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" value={row.resourceType} onChange={e => set("resourceType", e.target.value as ResourceTypeValue)}>
            {RESOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">EFFECTIVE FROM</label>
          <input type="date" className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={row.effectiveFrom} onChange={e => set("effectiveFrom", e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">RATE METHOD</label>
          <div className="flex gap-2">
            {(["day_rate", "monthly_cost"] as const).map(rt => (
              <button key={rt} type="button" onClick={() => set("rateType", rt)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${row.rateType === rt ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium" : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"}`}>
                {rt === "day_rate" ? "Day rate" : "Monthly"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">{rateLabel} *</label>
          <div className="flex gap-2">
            <select className="text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white" value={row.currency} onChange={e => set("currency", e.target.value)}>
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{sym}</span>
              <input type="number" min={0} step={0.01} className="w-full text-sm border border-gray-300 rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={row.rate} onChange={e => set("rate", parseFloat(e.target.value) || 0)} />
            </div>
          </div>
        </div>
      </div>
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">NOTES</label>
        <input className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="e.g. includes agency uplift, outside IR35..." value={row.notes} onChange={e => set("notes", e.target.value)} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" disabled={pending || !row.roleLabel} onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 font-medium">
          <Check className="w-4 h-4" />{pending ? "Saving..." : "Save rate"}
        </button>
        <button type="button" onClick={onCancel} className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50">
          <X className="w-4 h-4" />Cancel
        </button>
      </div>
    </div>
  );
}

// -- Bulk add panel ----------------------------------------------------------

function BulkAddPanel({ organisationId, today, existingRoles, onDone, onCancel }: {
  organisationId: string; today: string; existingRoles: string[]; onDone: () => void; onCancel: () => void;
}) {
  const existingSet = new Set(existingRoles.map(r => r.toLowerCase()));
  const [rows, setRows] = useState(() =>
    DEFAULT_ROLES.map(r => ({
      ...r, selected: !existingSet.has(r.roleLabel.toLowerCase()),
      currency: "GBP", rateType: "day_rate" as const, effectiveFrom: today, notes: "",
    }))
  );
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currency, setCurrency] = useState("GBP");

  const selected = rows.filter(r => r.selected);

  async function handleSave() {
    setSaving(true);
    let done = 0;
    for (const row of selected) {
      await upsertResourceRate({
        organisationId, userId: null, roleLabel: row.roleLabel,
        rateType: row.rateType, rate: row.rate, currency,
        resourceType: row.resourceType, notes: null, effectiveFrom: today,
      });
      done++;
      setProgress(Math.round((done / selected.length) * 100));
    }
    setSaving(false);
    onDone();
  }

  return (
    <div className="border border-indigo-200 rounded-xl overflow-hidden">
      <div className="bg-indigo-50 border-b border-indigo-200 px-4 py-3 flex items-center justify-between">
        <div>
          <div className="font-semibold text-indigo-900 text-sm">Load default role rates</div>
          <div className="text-xs text-indigo-600 mt-0.5">Select roles to add. Adjust rates then save all at once.</div>
        </div>
        <div className="flex items-center gap-3">
          <select value={currency} onChange={e => setCurrency(e.target.value)}
            className="text-sm border border-indigo-300 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button type="button" onClick={() => setRows(r => r.map(x => ({ ...x, selected: true })))}
            className="text-xs text-indigo-600 hover:underline">Select all</button>
          <button type="button" onClick={() => setRows(r => r.map(x => ({ ...x, selected: false })))}
            className="text-xs text-indigo-600 hover:underline">None</button>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="px-4 py-2 w-8" />
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Role</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Type</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-gray-500 uppercase w-32">Day rate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((row, i) => (
              <tr key={row.roleLabel} className={row.selected ? "bg-white" : "bg-gray-50 opacity-50"}>
                <td className="px-4 py-2">
                  <input type="checkbox" checked={row.selected}
                    onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, selected: e.target.checked } : r))}
                    className="rounded border-gray-300 text-indigo-600" />
                </td>
                <td className="px-4 py-2 font-medium text-gray-900">
                  {row.roleLabel}
                  {existingSet.has(row.roleLabel.toLowerCase()) && (
                    <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">exists</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <select value={row.resourceType}
                    onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, resourceType: e.target.value as ResourceTypeValue } : r))}
                    className="text-xs border border-gray-200 rounded px-2 py-1 bg-white">
                    {RESOURCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-sm">{CURRENCY_SYMBOLS[currency]}</span>
                    <input type="number" value={row.rate} min={0}
                      onChange={e => setRows(prev => prev.map((r, j) => j === i ? { ...r, rate: Number(e.target.value) } : r))}
                      className="w-24 text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-gray-200 px-4 py-3 flex items-center justify-between gap-4 bg-gray-50">
        <div className="text-sm text-gray-600">
          {selected.length} role{selected.length !== 1 ? "s" : ""} selected
        </div>
        {saving && (
          <div className="flex-1 mx-4">
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs text-gray-400 mt-1 text-center">{progress}%</div>
          </div>
        )}
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} disabled={saving}
            className="px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button type="button" onClick={handleSave} disabled={saving || selected.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
            <Check className="w-4 h-4" />
            {saving ? `Saving... ${progress}%` : `Save ${selected.length} rate${selected.length !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// -- Main component ----------------------------------------------------------

export interface RateCardTabProps {
  organisationId: string;
  rates: ResourceRate[];
  members: OrgMemberForPicker[];
}

export default function RateCardTab({ organisationId, rates: initialRates, members }: RateCardTabProps) {
  const today = new Date().toISOString().slice(0, 10);

  const [rates, setRates]         = useState<ResourceRate[]>(initialRates);
  const [showForm, setShowForm]   = useState(false);
  const [showBulk, setShowBulk]   = useState(false);
  const [editId, setEditId]       = useState<string | null>(null);
  const [editRow, setEditRow]     = useState<EditRow | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [, startTransition]       = useTransition();
  const [search, setSearch]       = useState("");

  const existingRoles = useMemo(() => [...new Set(rates.map(r => r.role_label))].sort(), [rates]);

  const filtered = useMemo(() => {
    const lq = search.toLowerCase();
    return rates.filter(r =>
      (r.full_name ?? "").toLowerCase().includes(lq) ||
      (r.role_label ?? "").toLowerCase().includes(lq) ||
      (r.department ?? "").toLowerCase().includes(lq)
    );
  }, [rates, search]);

  function handleAdd(row: EditRow) {
    setError(null);
    startTransition(async () => {
      const res = await upsertResourceRate({
        organisationId, userId: row.userId || null, roleLabel: row.roleLabel,
        rateType: row.rateType, rate: row.rate, currency: row.currency,
        resourceType: row.resourceType, notes: row.notes || null, effectiveFrom: row.effectiveFrom,
      });
      if (res.error) { setError(res.error); return; }
      window.location.reload();
    });
  }

  function handleEdit(row: EditRow) {
    setError(null);
    startTransition(async () => {
      const res = await upsertResourceRate({
        id: editId ?? undefined, organisationId, userId: row.userId || null,
        roleLabel: row.roleLabel, rateType: row.rateType, rate: row.rate,
        currency: row.currency, resourceType: row.resourceType,
        notes: row.notes || null, effectiveFrom: row.effectiveFrom,
      });
      if (res.error) { setError(res.error); return; }
      window.location.reload();
    });
  }

  function handleDelete(id: string) {
    if (!confirm("Delete this rate?")) return;
    startTransition(async () => {
      const res = await deleteResourceRate({ id, organisationId });
      if (res.error) { setError(res.error); return; }
      setRates(r => r.filter(x => x.id !== id));
    });
  }

  function startEdit(r: ResourceRate) {
    setEditId(r.id);
    setEditRow({ userId: r.user_id ?? "", roleLabel: r.role_label, rateType: r.rate_type, rate: r.rate, currency: r.currency, resourceType: r.resource_type as ResourceTypeValue, notes: r.notes ?? "", effectiveFrom: r.effective_from });
    setShowForm(false);
    setShowBulk(false);
  }
  function cancelEdit() { setEditId(null); setEditRow(null); }

  const rtMap = Object.fromEntries(RESOURCE_TYPES.map(t => [t.value, t]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Resource Rate Card</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Set day rates or monthly costs by role. These rates are used automatically in resource justification cost calculations across all projects.
        </p>
        <div className="mt-2 flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 w-fit">
          <Zap className="w-3 h-3" />
          Rates feed directly into project resource justification panels
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
        </div>
      )}

      {/* Action buttons */}
      {!showForm && !showBulk && (
        <div className="flex gap-2 flex-wrap">
          <button type="button" onClick={() => { setShowForm(true); cancelEdit(); setShowBulk(false); }}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">
            <Plus className="w-4 h-4" />Add rate
          </button>
          <button type="button" onClick={() => { setShowBulk(true); setShowForm(false); cancelEdit(); }}
            className="flex items-center gap-2 px-4 py-2 text-sm border border-indigo-300 text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 font-medium">
            <Upload className="w-4 h-4" />Load default roles
          </button>
        </div>
      )}

      {/* Single add form */}
      {showForm && (
        <RateForm members={members} initial={emptyEdit(today)}
          onSave={row => { handleAdd(row); setShowForm(false); }}
          onCancel={() => setShowForm(false)} today={today} existingRoles={existingRoles} />
      )}

      {/* Bulk add */}
      {showBulk && (
        <BulkAddPanel organisationId={organisationId} today={today} existingRoles={existingRoles}
          onDone={() => { setShowBulk(false); window.location.reload(); }}
          onCancel={() => setShowBulk(false)} />
      )}

      {/* Search + table */}
      {rates.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Search by name, role, department..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">ROLE</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">PERSON</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">TYPE</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">RATE</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">FROM</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">NOTES</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(r => (
                  <>
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium text-gray-900">{r.role_label}</td>
                      <td className="px-4 py-3">
                        {r.user_id ? (
                          <div className="flex items-center gap-2">
                            <Avatar name={r.full_name} avatarUrl={r.avatar_url} size={6} />
                            <span className="text-gray-700 truncate">{r.full_name ?? r.email}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-400 italic">Any person in role</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${rtMap[r.resource_type]?.cls ?? "bg-gray-100 text-gray-700"}`}>
                          {rtMap[r.resource_type]?.label ?? r.resource_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {CURRENCY_SYMBOLS[r.currency] ?? r.currency}{r.rate.toLocaleString()}
                        <span className="text-xs text-gray-400 font-normal ml-1">{r.rate_type === "day_rate" ? "/day" : "/mo"}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.effective_from}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[140px] truncate text-xs">{r.notes ?? "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button type="button" onClick={() => startEdit(r)} className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"><Pencil className="w-3.5 h-3.5" /></button>
                          <button type="button" onClick={() => handleDelete(r.id)} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                    {editId === r.id && editRow && (
                      <tr key={`${r.id}-edit`}>
                        <td colSpan={7} className="px-4 py-3 bg-gray-50">
                          <RateForm members={members} initial={editRow}
                            onSave={row => { handleEdit(row); cancelEdit(); }}
                            onCancel={cancelEdit} today={today} existingRoles={existingRoles} />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400">
            {rates.length} rate{rates.length !== 1 ? "s" : ""} configured · Showing latest effective rate per role
          </p>
        </div>
      )}

      {rates.length === 0 && !showForm && !showBulk && (
        <div className="text-center py-12 text-gray-400 border border-dashed border-gray-200 rounded-xl">
          <p className="text-sm font-medium text-gray-600">No rates configured yet</p>
          <p className="text-xs mt-1 mb-4">Add rates individually or load all standard roles at once.</p>
          <div className="flex gap-2 justify-center">
            <button type="button" onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600">
              <Plus className="w-4 h-4" />Add rate
            </button>
            <button type="button" onClick={() => setShowBulk(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium">
              <Upload className="w-4 h-4" />Load default roles
            </button>
          </div>
        </div>
      )}
    </div>
  );
}