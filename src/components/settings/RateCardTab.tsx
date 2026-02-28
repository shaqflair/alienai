"use client";

import { useState, useTransition, useCallback, useMemo } from "react";
import {
  Plus, Trash2, Pencil, Check, X, Search,
  ChevronDown, AlertCircle,
} from "lucide-react";
import type { OrgMemberForPicker, ResourceRate } from "@/app/actions/resource-rates";
import {
  upsertResourceRate,
  deleteResourceRate,
} from "@/app/actions/resource-rates";

// -- Types ------------------------------------------------------------------

const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"] as const;
const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "\u00a3", USD: "$", EUR: "\u20ac", AUD: "A$", CAD: "C$",
};

const RESOURCE_TYPES = [
  { value: "internal",   label: "Internal",   cls: "bg-blue-100 text-blue-700"   },
  { value: "contractor", label: "Contractor", cls: "bg-amber-100 text-amber-700" },
  { value: "vendor",     label: "Vendor",     cls: "bg-purple-100 text-purple-700" },
  { value: "consultant", label: "Consultant", cls: "bg-gray-100 text-gray-700"   },
] as const;

type ResourceTypeValue = typeof RESOURCE_TYPES[number]["value"];

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

function emptyEdit(userId = "", today = ""): EditRow {
  return {
    userId,
    roleLabel: "",
    rateType: "day_rate",
    rate: 0,
    currency: "GBP",
    resourceType: "internal",
    notes: "",
    effectiveFrom: today,
  };
}

// -- Avatar -----------------------------------------------------------------

function Avatar({ name, avatarUrl, size = 8 }: { name?: string | null; avatarUrl?: string | null; size?: number }) {
  const initials = (name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name ?? ""} className={`w-${size} h-${size} rounded-full object-cover`} />;
  }
  return (
    <div className={`w-${size} h-${size} rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold`}>
      {initials}
    </div>
  );
}

// -- Person picker (searchable dropdown) ------------------------------------

function PersonPicker({
  members,
  value,
  onChange,
}: {
  members: OrgMemberForPicker[];
  value: string;
  onChange: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = members.find(m => m.user_id === value);
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return members.filter(m =>
      (m.full_name ?? "").toLowerCase().includes(lq) ||
      (m.email ?? "").toLowerCase().includes(lq) ||
      (m.department ?? "").toLowerCase().includes(lq)
    );
  }, [members, q]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        {selected ? (
          <>
            <Avatar name={selected.full_name} avatarUrl={selected.avatar_url} size={6} />
            <span className="flex-1 text-left truncate">{selected.full_name ?? selected.email}</span>
          </>
        ) : (
          <>
            <Search className="w-4 h-4 text-gray-400" />
            <span className="text-gray-400 flex-1">Search for a person...</span>
          </>
        )}
        <ChevronDown className="w-4 h-4 text-gray-400 ml-auto" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500"
              placeholder="Search by name, email, department..."
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <ul className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-gray-400">No results</li>
            )}
            {filtered.map(m => (
              <li key={m.user_id}>
                <button
                  type="button"
                  onClick={() => { onChange(m.user_id); setOpen(false); setQ(""); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-indigo-50 text-left"
                >
                  <Avatar name={m.full_name} avatarUrl={m.avatar_url} size={7} />
                  <div className="min-w-0">
                    <div className="font-medium truncate">{m.full_name ?? m.email}</div>
                    {m.full_name && m.email && (
                      <div className="text-xs text-gray-400 truncate">{m.email}</div>
                    )}
                    {m.job_title && (
                      <span className="text-xs text-gray-400 truncate">&middot; {m.job_title}</span>
                    )}
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

// -- Rate form (inline) -----------------------------------------------------

function RateForm({
  members,
  initial,
  onSave,
  onCancel,
  today,
}: {
  members: OrgMemberForPicker[];
  initial: EditRow;
  onSave: (row: EditRow) => void;
  onCancel: () => void;
  today: string;
}) {
  const [row, setRow] = useState<EditRow>(initial);
  const [pending, startTransition] = useTransition();

  function set<K extends keyof EditRow>(k: K, v: EditRow[K]) {
    setRow(r => ({ ...r, [k]: v }));
  }

  function handleSave() {
    if (!row.userId || !row.roleLabel || row.rate < 0) return;
    startTransition(() => onSave(row));
  }

  const sym = CURRENCY_SYMBOLS[row.currency] ?? "\u00a3";
  const rateLabel = row.rateType === "day_rate" ? "RATE (PER DAY)" : "MONTHLY COST";

  return (
    <div className="border border-indigo-200 rounded-xl p-4 bg-indigo-50/30 space-y-4">
      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">PERSON *</label>
        <PersonPicker members={members} value={row.userId} onChange={v => set("userId", v)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">ROLE LABEL *</label>
          <input
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="e.g. Senior Developer"
            value={row.roleLabel}
            onChange={e => set("roleLabel", e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">TYPE</label>
          <select
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
            value={row.resourceType}
            onChange={e => set("resourceType", e.target.value as ResourceTypeValue)}
          >
            {RESOURCE_TYPES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">RATE METHOD</label>
          <div className="flex gap-2">
            {(["day_rate", "monthly_cost"] as const).map(rt => (
              <button
                key={rt}
                type="button"
                onClick={() => set("rateType", rt)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  row.rateType === rt
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium"
                    : "border-gray-300 bg-white text-gray-600 hover:border-gray-400"
                }`}
              >
                {rt === "day_rate" ? "Day rate" : "Monthly"}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-600 mb-1">{rateLabel} *</label>
          <div className="flex gap-2">
            <select
              className="text-sm border border-gray-300 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
              value={row.currency}
              onChange={e => set("currency", e.target.value)}
            >
              {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="relative flex-1">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">{sym}</span>
              <input
                type="number"
                min={0}
                step={0.01}
                className="w-full text-sm border border-gray-300 rounded-lg pl-7 pr-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={row.rate}
                onChange={e => set("rate", parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">EFFECTIVE FROM</label>
        <input
          type="date"
          className="text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          value={row.effectiveFrom}
          onChange={e => set("effectiveFrom", e.target.value)}
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-gray-600 mb-1">NOTES</label>
        <input
          className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="e.g. includes agency uplift, outside IR35..."
          value={row.notes}
          onChange={e => set("notes", e.target.value)}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          disabled={pending}
          onClick={handleSave}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-60 font-medium"
        >
          <Check className="w-4 h-4" />
          {pending ? "Saving..." : "Save rate"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}

// -- Main component ---------------------------------------------------------

export interface RateCardTabProps {
  organisationId: string;
  rates: ResourceRate[];
  members: OrgMemberForPicker[];
}

export default function RateCardTab({ organisationId, rates: initialRates, members }: RateCardTabProps) {
  const today = new Date().toISOString().slice(0, 10);

  const [rates, setRates] = useState<ResourceRate[]>(initialRates);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<EditRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState("");

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
        organisationId,
        userId: row.userId,
        roleLabel: row.roleLabel,
        rateType: row.rateType,
        rate: row.rate,
        currency: row.currency,
        resourceType: row.resourceType,
        notes: row.notes || null,
        effectiveFrom: row.effectiveFrom,
      });
      if (res.error) { setError(res.error); return; }
      // Re-fetch by reloading - server action calls revalidatePath
      window.location.reload();
    });
  }

  function handleEdit(row: EditRow) {
    setError(null);
    startTransition(async () => {
      const res = await upsertResourceRate({
        id: editId ?? undefined,
        organisationId,
        userId: row.userId,
        roleLabel: row.roleLabel,
        rateType: row.rateType,
        rate: row.rate,
        currency: row.currency,
        resourceType: row.resourceType,
        notes: row.notes || null,
        effectiveFrom: row.effectiveFrom,
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
    setEditRow({
      userId: r.user_id,
      roleLabel: r.role_label,
      rateType: r.rate_type,
      rate: r.rate,
      currency: r.currency,
      resourceType: r.resource_type as ResourceTypeValue,
      notes: r.notes ?? "",
      effectiveFrom: r.effective_from,
    });
    setShowForm(false);
  }

  function cancelEdit() { setEditId(null); setEditRow(null); }

  const rtMap = Object.fromEntries(RESOURCE_TYPES.map(t => [t.value, t]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Resource Rate Card</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Set day rates or monthly costs per person. These auto-fill when a PM adds someone to a Financial Plan.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {!showForm && (
        <button
          type="button"
          onClick={() => { setShowForm(true); cancelEdit(); }}
          className="flex items-center gap-2 px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium"
        >
          <Plus className="w-4 h-4" />
          Add rate
        </button>
      )}

      {showForm && (
        <RateForm
          members={members}
          initial={emptyEdit("", today)}
          onSave={row => { handleAdd(row); setShowForm(false); }}
          onCancel={() => setShowForm(false)}
          today={today}
        />
      )}

      {rates.length > 0 && (
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Search by name, role, department..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">PERSON</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">ROLE</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">TYPE</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">RATE</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">EFFECTIVE FROM</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">NOTES</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map(r => (
                  <>
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Avatar name={r.full_name} avatarUrl={r.avatar_url} size={7} />
                          <div>
                            <div className="font-medium text-gray-900">{r.full_name ?? r.email ?? r.user_id}</div>
                            {r.department && <div className="text-xs text-gray-400">{r.department}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.role_label}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${rtMap[r.resource_type]?.cls ?? "bg-gray-100 text-gray-700"}`}>
                          {rtMap[r.resource_type]?.label ?? r.resource_type}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {CURRENCY_SYMBOLS[r.currency] ?? r.currency}{r.rate.toLocaleString()}
                        <span className="text-xs text-gray-400 font-normal ml-1">
                          {r.rate_type === "day_rate" ? "/day" : "/mo"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{r.effective_from}</td>
                      <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{r.notes ?? "-"}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(r.id)}
                            className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editId === r.id && editRow && (
                      <tr key={`${r.id}-edit`}>
                        <td colSpan={7} className="px-4 py-3 bg-gray-50">
                          <RateForm
                            members={members}
                            initial={editRow}
                            onSave={row => { handleEdit(row); cancelEdit(); }}
                            onCancel={cancelEdit}
                            today={today}
                          />
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400">
            {rates.length} rate{rates.length !== 1 ? "s" : ""} configured &middot;{" "}
            Showing latest effective rate per person &amp; role
          </p>
        </div>
      )}

      {rates.length === 0 && !showForm && (
        <div className="text-center py-12 text-gray-400 border border-dashed border-gray-200 rounded-xl">
          <p className="text-sm">No rates configured yet.</p>
          <p className="text-xs mt-1">Click &ldquo;Add rate&rdquo; to get started.</p>
        </div>
      )}
    </div>
  );
}
