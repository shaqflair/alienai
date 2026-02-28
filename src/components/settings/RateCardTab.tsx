ï»¿"use client";

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

// Ã¢âEURÃ¢âEUR Types Ã¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEUR

const CURRENCIES = ["GBP", "USD", "EUR", "AUD", "CAD"] as const;
const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "Â£", USD: "$", EUR: "Ã¢âÂ¬", AUD: "A$", CAD: "C$",
};

const RESOURCE_TYPES = [
  { value: "internal",   label: "Internal",   cls: "bg-blue-100 text-blue-700"   },
  { value: "contractor", label: "Contractor", cls: "bg-amber-100 text-amber-700" },
  { value: "vendor",     label: "Vendor",     cls: "bg-purple-100 text-purple-700" },
  { value: "consultant", label: "Consultant", cls: "bg-gray-100 text-gray-700"   },
] as const;

type ResourceTypeValue = typeof RESOURCE_TYPES[number]["value"];

type EditRow = {
  id?: string;
  user_id: string;
  role_label: string;
  rate_type: "day_rate" | "monthly_cost";
  rate: number | "";
  currency: string;
  resource_type: ResourceTypeValue;
  notes: string;
  effective_from: string;
};

function today() {
  return new Date().toISOString().split("T")[0];
}

function emptyEdit(userId = "", currency = "GBP"): EditRow {
  return {
    user_id: userId,
    role_label: "",
    rate_type: "day_rate",
    rate: "",
    currency,
    resource_type: "internal",
    notes: "",
    effective_from: today(),
  };
}

// Ã¢âEURÃ¢âEUR Avatar Ã¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEUR

function Avatar({ name, url, size = 7 }: { name: string | null; url: string | null; size?: number }) {
  const initials = (name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const sz = `w-${size} h-${size}`;

  if (url) {
    return (
      <img
        src={url}
        alt={name ?? ""}
        className={`${sz} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div className={`${sz} rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0`}>
      {initials}
    </div>
  );
}

// Ã¢âEURÃ¢âEUR Person picker (searchable dropdown) Ã¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEUR

function PersonPicker({
  members,
  value,
  onChange,
  disabled,
}: {
  members: OrgMemberForPicker[];
  value: string;
  onChange: (userId: string, member: OrgMemberForPicker | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery]     = useState("");
  const [open,  setOpen]      = useState(false);

  const selected = members.find((m) => m.user_id === value) ?? null;

  const filtered = useMemo(() => {
    if (!query.trim()) return members;
    const q = query.toLowerCase();
    return members.filter(
      (m) =>
        m.full_name?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.department?.toLowerCase().includes(q) ||
        m.job_title?.toLowerCase().includes(q)
    );
  }, [members, query]);

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white text-sm text-left hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50"
      >
        {selected ? (
          <>
            <Avatar name={selected.full_name} url={selected.avatar_url} size={6} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-800 truncate">{selected.full_name ?? selected.email}</div>
              {selected.department && (
                <div className="text-xs text-gray-400 truncate">{selected.department}</div>
              )}
            </div>
          </>
        ) : (
          <span className="text-gray-400 flex-1">Search for a personÃ¢EURÂ¦</span>
        )}
        <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, email, departmentÃ¢EURÂ¦"
                className="flex-1 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery("")} className="text-gray-400 hover:text-gray-600">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Results */}
          <div className="max-h-60 overflow-y-auto divide-y divide-gray-50">
            {filtered.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-gray-400">No people found</div>
            )}
            {filtered.map((m) => (
              <button
                key={m.user_id}
                type="button"
                onClick={() => {
                  onChange(m.user_id, m);
                  setOpen(false);
                  setQuery("");
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-blue-50 transition-colors ${
                  m.user_id === value ? "bg-blue-50" : ""
                }`}
              >
                <Avatar name={m.full_name} url={m.avatar_url} size={7} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">
                    {m.full_name ?? m.email ?? "Unknown"}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    {m.department && (
                      <span className="text-xs text-gray-400 truncate">{m.department}</span>
                    )}
                    {m.job_title && (
                      <span className="text-xs text-gray-400 truncate">ÃÂ· {m.job_title}</span>
                    )}
                  </div>
                </div>
                {m.user_id === value && <Check className="w-4 h-4 text-blue-500 flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
      )}
    </div>
  );
}

// Ã¢âEURÃ¢âEUR Rate form (inline) Ã¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEUR

function RateForm({
  organisationId,
  members,
  initial,
  onDone,
  onCancel,
}: {
  organisationId: string;
  members: OrgMemberForPicker[];
  initial: EditRow;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [row, setRow]           = useState<EditRow>(initial);
  const [error, setError]       = useState<string | null>(null);
  const [pending, startTrans]   = useTransition();

  const patch = (p: Partial<EditRow>) => setRow((r) => ({ ...r, ...p }));

  const handlePersonChange = (userId: string, member: OrgMemberForPicker | null) => {
    patch({
      user_id:    userId,
      role_label: member?.job_title ?? row.role_label,
    });
  };

  const handleSubmit = () => {
    if (!row.user_id)           return setError("Please select a person.");
    if (!row.role_label.trim()) return setError("Role label is required.");
    if (row.rate === "" || Number(row.rate) <= 0) return setError("Rate must be greater than 0.");

    setError(null);
    startTrans(async () => {
      try {
        await upsertResourceRate({
          id:              initial.id,
          organisation_id: organisationId,
          user_id:         row.user_id,
          role_label:      row.role_label.trim(),
          rate_type:       row.rate_type,
          rate:            Number(row.rate),
          currency:        row.currency,
          resource_type:   row.resource_type,
          notes:           row.notes || undefined,
          effective_from:  row.effective_from,
        });
        onDone();
      } catch (e: any) {
        setError(e.message ?? "Failed to save rate.");
      }
    });
  };

  const sym = CURRENCY_SYMBOLS[row.currency] ?? "Â£";

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-4">
      <div className="text-sm font-semibold text-gray-700">
        {initial.id ? "Edit rate" : "Add rate"}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Person picker */}
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Person *
          </label>
          <PersonPicker
            members={members}
            value={row.user_id}
            onChange={handlePersonChange}
            disabled={!!initial.id} // can't change person when editing
          />
        </div>

        {/* Role label */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Role label *
          </label>
          <input
            type="text"
            value={row.role_label}
            onChange={(e) => patch({ role_label: e.target.value })}
            placeholder="e.g. Senior Developer"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Resource type */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Type
          </label>
          <select
            value={row.resource_type}
            onChange={(e) => patch({ resource_type: e.target.value as ResourceTypeValue })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {RESOURCE_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Rate method */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Rate method
          </label>
          <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5 w-fit">
            {(["day_rate", "monthly_cost"] as const).map((rt) => (
              <button
                key={rt}
                type="button"
                onClick={() => patch({ rate_type: rt })}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                  row.rate_type === rt
                    ? "bg-white shadow text-gray-900"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {rt === "day_rate" ? "Day rate" : "Monthly"}
              </button>
            ))}
          </div>
        </div>

        {/* Rate + currency */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Rate ({row.rate_type === "day_rate" ? "per day" : "per month"}) *
          </label>
          <div className="flex gap-2">
            <select
              value={row.currency}
              onChange={(e) => patch({ currency: e.target.value })}
              className="border border-gray-200 rounded-lg px-2 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <div className="flex-1 flex items-center gap-1 border border-gray-200 rounded-lg px-3 py-2 bg-white">
              <span className="text-gray-400 text-sm">{sym}</span>
              <input
                type="number"
                min={0}
                step={50}
                value={row.rate}
                onChange={(e) => patch({ rate: e.target.value === "" ? "" : Number(e.target.value) })}
                className="flex-1 border-0 bg-transparent text-sm font-semibold text-gray-800 focus:outline-none"
                placeholder="0"
              />
            </div>
          </div>
        </div>

        {/* Effective from */}
        <div>
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Effective from
          </label>
          <input
            type="date"
            value={row.effective_from}
            onChange={(e) => patch({ effective_from: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Notes */}
        <div className="md:col-span-2">
          <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Notes
          </label>
          <input
            type="text"
            value={row.notes}
            onChange={(e) => patch({ notes: e.target.value })}
            placeholder="e.g. includes agency uplift, outside IR35Ã¢EURÂ¦"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={pending}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all disabled:opacity-60 shadow-sm"
        >
          <Check className="w-4 h-4" />
          {pending ? "SavingÃ¢EURÂ¦" : "Save rate"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-all"
        >
          <X className="w-4 h-4" />
          Cancel
        </button>
      </div>
    </div>
  );
}

// Ã¢âEURÃ¢âEUR Main component Ã¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEURÃ¢âEUR

type Props = {
  organisationId: string;
  rates: ResourceRate[];
  members: OrgMemberForPicker[];
  isAdmin: boolean;
};

export default function RateCardTab({
  organisationId,
  rates: initialRates,
  members,
  isAdmin,
}: Props) {
  const [rates, setRates]         = useState<ResourceRate[]>(initialRates);
  const [adding, setAdding]       = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch]       = useState("");
  const [pending, startTrans]     = useTransition();

  const filtered = useMemo(() => {
    if (!search.trim()) return rates;
    const q = search.toLowerCase();
    return rates.filter(
      (r) =>
        r.full_name?.toLowerCase().includes(q) ||
        r.email?.toLowerCase().includes(q) ||
        r.role_label?.toLowerCase().includes(q) ||
        r.department?.toLowerCase().includes(q)
    );
  }, [rates, search]);

  const handleDone = () => {
    setAdding(false);
    setEditingId(null);
    // Re-fetch by reloading Ã¢EURâ server action calls revalidatePath
    window.location.reload();
  };

  const handleDelete = (id: string) => {
    if (!confirm("Delete this rate? This cannot be undone.")) return;
    startTrans(async () => {
      await deleteResourceRate(id, organisationId);
      setRates((r) => r.filter((x) => x.id !== id));
    });
  };

  const sym = (currency: string) => CURRENCY_SYMBOLS[currency] ?? currency;
  const typeInfo = (t: string) =>
    RESOURCE_TYPES.find((x) => x.value === t) ?? RESOURCE_TYPES[3];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Resource Rate Card</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Set day rates or monthly costs per person. These auto-fill when a PM adds someone to a Financial Plan.
            {!isAdmin && " Contact an org admin to make changes."}
          </p>
        </div>
        {isAdmin && !adding && (
          <button
            onClick={() => { setAdding(true); setEditingId(null); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-sm"
          >
            <Plus className="w-4 h-4" /> Add rate
          </button>
        )}
      </div>

      {/* Add form */}
      {adding && isAdmin && (
        <RateForm
          organisationId={organisationId}
          members={members}
          initial={emptyEdit()}
          onDone={handleDone}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Search */}
      {rates.length > 0 && (
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white max-w-sm">
          <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, role, departmentÃ¢EURÂ¦"
            className="flex-1 text-sm text-gray-800 placeholder-gray-400 focus:outline-none"
          />
        </div>
      )}

      {/* Rate table */}
      {filtered.length === 0 && !adding ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-6 py-12 text-center">
          <p className="text-sm text-gray-400">
            {rates.length === 0
              ? "No rate cards set up yet."
              : "No rates match your search."}
          </p>
          {isAdmin && rates.length === 0 && (
            <button
              onClick={() => setAdding(true)}
              className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition-all"
            >
              <Plus className="w-4 h-4" /> Add first rate
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          <table className="w-full text-sm border-collapse bg-white">
            <thead>
              <tr className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-200">
                {["Person", "Role", "Type", "Rate", "Effective from", "Notes", ""].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-left whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, idx) => {
                const isEditing = editingId === r.id;
                const badge = typeInfo(r.resource_type);

                if (isEditing) {
                  return (
                    <tr key={r.id}>
                      <td colSpan={7} className="px-4 py-3 border-b border-gray-100">
                        <RateForm
                          organisationId={organisationId}
                          members={members}
                          initial={{
                            id:            r.id,
                            user_id:       r.user_id,
                            role_label:    r.role_label,
                            rate_type:     r.rate_type,
                            rate:          r.rate,
                            currency:      r.currency,
                            resource_type: r.resource_type as ResourceTypeValue,
                            notes:         r.notes ?? "",
                            effective_from: r.effective_from,
                          }}
                          onDone={handleDone}
                          onCancel={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  );
                }

                return (
                  <tr
                    key={r.id}
                    className={`${idx % 2 === 0 ? "bg-white" : "bg-gray-50/40"} hover:bg-blue-50/20 group transition-colors border-b border-gray-100`}
                  >
                    {/* Person */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.full_name} url={r.avatar_url} size={7} />
                        <div>
                          <div className="font-medium text-gray-800 text-sm">
                            {r.full_name ?? r.email ?? "Unknown"}
                          </div>
                          {r.department && (
                            <div className="text-xs text-gray-400">{r.department}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Role */}
                    <td className="px-4 py-3 text-sm text-gray-700">{r.role_label}</td>

                    {/* Type badge */}
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
                        {badge.label}
                      </span>
                    </td>

                    {/* Rate */}
                    <td className="px-4 py-3">
                      <div className="font-semibold text-gray-800 tabular-nums">
                        {sym(r.currency)}{r.rate.toLocaleString("en-GB")}
                      </div>
                      <div className="text-xs text-gray-400">
                        {r.rate_type === "day_rate" ? "per day" : "per month"}
                      </div>
                    </td>

                    {/* Effective from */}
                    <td className="px-4 py-3 text-sm text-gray-500 tabular-nums whitespace-nowrap">
                      {new Date(r.effective_from).toLocaleDateString("en-GB", {
                        day: "numeric", month: "short", year: "numeric",
                      })}
                    </td>

                    {/* Notes */}
                    <td className="px-4 py-3 text-sm text-gray-400 max-w-[180px] truncate">
                      {r.notes ?? "Ã¢EURâ"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      {isAdmin && (
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => { setEditingId(r.id); setAdding(false); }}
                            className="p-1.5 rounded-lg hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
                            title="Edit"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(r.id)}
                            disabled={pending}
                            className="p-1.5 rounded-lg hover:bs-red-100 text-gray-400 hover:text-red-600 transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      {rates.length > 0 && (
        <p className="text-xs text-gray-400">
          {rates.length} rate{rates.length !== 1 ? "s" : ""} configured ÃÂ· {" "}
          {new Set(rates.map((r) => r.user_id)).size} people
        </p>
      )}
    </div>
  );
}

