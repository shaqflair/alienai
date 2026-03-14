// src/components/artifacts/ResourcePicker.tsx
"use client";

import { useState, useMemo } from "react";
import { User, ChevronDown, X, Zap, AlertCircle } from "lucide-react";
import type { RateCardMatch } from "@/app/actions/resource-rate-lookup";
import type {
  Resource,
  ResourceRateType,
  ResourceType,
} from "./FinancialPlanEditor";

export type PickedPerson = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  job_title: string | null;
  department: string | null;
  rate_type: ResourceRateType | null;
  rate: number | null;
  currency: string | null;
  resource_type: ResourceType | null;
  role_label: string | null;
  rate_source: "personal" | "role" | null;
};

type OrgMember = {
  user_id: string;
  full_name: string | null;
  name: string;
  email: string | null;
  avatar_url: string | null;
  job_title: string | null;
  department: string | null;
  role: string;
};

function Avatar({ name, avatarUrl, size = 7 }: { name?: string | null; avatarUrl?: string | null; size?: number }) {
  const initials = (name ?? "?").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return <img src={avatarUrl} alt={name ?? ""} className={`w-${size} h-${size} rounded-full object-cover flex-shrink-0`} />;
  }
  return (
    <div className={`w-${size} h-${size} rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "\u00a3", USD: "$", EUR: "\u20ac", AUD: "A$", CAD: "C$",
};

function RateBadge({ match, source }: { match: RateCardMatch; source: "personal" | "role" }) {
  const sym   = CURRENCY_SYMBOLS[match.currency] ?? match.currency;
  const label = match.rate_type === "day_rate" ? "/day" : "/mo";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${source === "personal" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
      <Zap className="w-2.5 h-2.5" />
      {sym}{Number(match.rate).toLocaleString()}{label}
      {source === "role" && <span className="opacity-70">(role)</span>}
    </span>
  );
}

const memberCache: Record<string, OrgMember[]> = {};

type Props = {
  organisationId: string;
  value: string | null;
  currentResource: Resource;
  disabled?: boolean;
  onPick: (person: PickedPerson) => void;
};

export default function ResourcePicker({ organisationId, value, currentResource, disabled = false, onPick }: Props) {
  const [open,        setOpen]        = useState(false);
  const [q,           setQ]           = useState("");
  const [members,     setMembers]     = useState<OrgMember[]>(memberCache[organisationId] ?? []);
  const [loading,     setLoading]     = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError,   setRateError]   = useState<string | null>(null);

  const selected = members.find((m) => m.user_id === value);

  async function handleOpen() {
    if (disabled) return;
    setOpen((o) => !o);
    if (members.length > 0 || loading) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/org/members?orgId=${encodeURIComponent(organisationId)}`, { cache: "no-store" });
      const d = await res.json();
      if (Array.isArray(d.members)) {
        memberCache[organisationId] = d.members;
        setMembers(d.members);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handleSelect(member: OrgMember) {
    setOpen(false);
    setQ("");
    setRateError(null);
    setRateLoading(true);

    let rateMatch: RateCardMatch | null = null;
    let rateSource: "personal" | "role" | null = null;

    try {
      const res = await fetch(
        `/api/org/rate-card?orgId=${encodeURIComponent(organisationId)}&userId=${encodeURIComponent(member.user_id)}`,
        { cache: "no-store" }
      );
      const d = await res.json();
      if (d.ok && d.match) {
        rateMatch  = d.match as RateCardMatch;
        rateSource = "personal";
      }
    } catch {
      setRateError("Could not load rate -- please set manually");
    } finally {
      setRateLoading(false);
    }

    onPick({
      user_id:       member.user_id,
      full_name:     member.full_name,
      email:         member.email,
      avatar_url:    member.avatar_url,
      job_title:     member.job_title,
      department:    member.department,
      rate_type:     rateMatch?.rate_type     ?? null,
      rate:          rateMatch?.rate          ?? null,
      currency:      rateMatch?.currency      ?? null,
      resource_type: rateMatch?.resource_type ?? null,
      role_label:    rateMatch?.role_label    ?? null,
      rate_source:   rateSource,
    });
  }

  const emptyPick: PickedPerson = {
    user_id: "", full_name: null, email: null, avatar_url: null,
    job_title: null, department: null, rate_type: null, rate: null,
    currency: null, resource_type: null, role_label: null, rate_source: null,
  };

  function handleClear(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onPick(emptyPick);
  }

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return members.filter((m) =>
      (m.full_name  ?? "").toLowerCase().includes(lq) ||
      (m.email      ?? "").toLowerCase().includes(lq) ||
      (m.job_title  ?? "").toLowerCase().includes(lq) ||
      (m.department ?? "").toLowerCase().includes(lq)
    );
  }, [members, q]);

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`w-full flex items-center gap-2 border rounded-lg px-2.5 py-1.5 text-sm bg-white transition-colors ${
          disabled
            ? "border-gray-100 opacity-60 cursor-default"
            : "border-gray-200 hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400"
        }`}
      >
        {selected ? (
          <>
            <Avatar name={selected.full_name} avatarUrl={selected.avatar_url} size={6} />
            <div className="flex-1 min-w-0 text-left">
              <div className="text-xs font-medium text-gray-900 truncate">
                {selected.full_name ?? selected.email}
              </div>
              {selected.job_title && (
                <div className="text-[10px] text-gray-400 truncate">{selected.job_title}</div>
              )}
            </div>
            {currentResource.rate_type && (currentResource.day_rate || currentResource.monthly_cost) && (
              <RateBadge
                match={{
                  rate_type:     currentResource.rate_type,
                  rate:          Number(currentResource.rate_type === "day_rate" ? currentResource.day_rate : currentResource.monthly_cost),
                  currency:      "GBP",
                  resource_type: currentResource.type,
                  role_label:    currentResource.name,
                }}
                source="personal"
              />
            )}
            {!disabled && (
              <span
                role="button"
                tabIndex={0}
                onClick={handleClear}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onPick(emptyPick); }
                }}
                className="ml-1 text-gray-300 hover:text-gray-500 flex-shrink-0 inline-flex items-center justify-center"
                aria-label="Clear selected person"
                title="Clear"
              >
                <X className="w-3 h-3" />
              </span>
            )}
          </>
        ) : rateLoading ? (
          <>
            <div className="w-6 h-6 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
            <span className="text-xs text-gray-400 flex-1 text-left">Loading rate...</span>
          </>
        ) : (
          <>
            <User className="w-4 h-4 text-gray-300 flex-shrink-0" />
            <span className="text-xs text-gray-400 flex-1 text-left">Pick a person...</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
          </>
        )}
      </button>

      {rateError && (
        <div className="flex items-center gap-1 mt-0.5 px-1 text-[10px] text-amber-600">
          <AlertCircle className="w-2.5 h-2.5" />
          {rateError}
        </div>
      )}

      {open && (
        <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl">
          <div className="p-2 border-b border-gray-100 flex items-center gap-2">
            <input
              autoFocus
              className="flex-1 text-xs text-gray-900 px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400 placeholder:text-gray-400"
              placeholder="Search name, title, department..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button
              type="button"
              onClick={() => { setOpen(false); setQ(""); }}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1.5 transition-colors"
              aria-label="Close picker"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <ul className="max-h-60 overflow-y-auto py-1">
            {loading && (
              <li className="px-3 py-4 text-xs text-gray-400 text-center">Loading members...</li>
            )}
            {!loading && filtered.length === 0 && (
              <li className="px-3 py-4 text-xs text-gray-400 text-center">No members found</li>
            )}
            {!loading && filtered.map((m) => (
              <li key={m.user_id}>
                <button
                  type="button"
                  onClick={() => handleSelect(m)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-50 transition-colors"
                >
                  <Avatar name={m.full_name} avatarUrl={m.avatar_url} size={7} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-900 truncate">
                      {m.full_name ?? m.email}
                    </div>
                    {m.job_title && (
                      <div className="text-[10px] text-indigo-500 truncate">{m.job_title}</div>
                    )}
                    {m.department && (
                      <div className="text-[10px] text-gray-400 truncate">{m.department}</div>
                    )}
                  </div>
                  <span className="text-[10px] text-gray-300 flex-shrink-0">{m.role}</span>
                </button>
              </li>
            ))}
          </ul>

          <div className="border-t border-gray-100 px-3 py-2 text-[10px] text-gray-400 flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 text-emerald-500" />
            Rate auto-fills from Rate Card on selection
          </div>
        </div>
      )}
    </div>
  );
}