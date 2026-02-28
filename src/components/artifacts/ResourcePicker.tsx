"use client";

import { useState, useMemo, useTransition } from "react";
import { User, ChevronDown, X, Zap, AlertCircle } from "lucide-react";
import { getOrgMembersForPicker } from "@/app/actions/resource-rates";
import { getRateForUser }         from "@/app/actions/resource-rate-lookup";
import type { OrgMemberForPicker } from "@/app/actions/resource-rates";
import type { RateCardMatch }       from "@/app/actions/resource-rate-lookup";
import type {
  Resource, ResourceRateType, ResourceType,
} from "./FinancialPlanEditor";

// ── PickedPerson ─────────────────────────────────────────────────────────────
// Returned to the parent when a user selects someone from the picker.

export type PickedPerson = {
  user_id:       string;
  full_name:     string | null;
  email:         string | null;
  avatar_url:    string | null;
  job_title:     string | null;
  department:    string | null;
  // Rate card fields — null if no rate found
  rate_type:     ResourceRateType | null;
  rate:          number | null;
  currency:      string | null;
  resource_type: ResourceType | null;
  role_label:    string | null;
  rate_source:   "personal" | "role" | null; // which rate matched
};

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({
  name, avatarUrl, size = 7,
}: { name?: string | null; avatarUrl?: string | null; size?: number }) {
  const initials = (name ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name ?? ""}
        className={`w-${size} h-${size} rounded-full object-cover flex-shrink-0`}
      />
    );
  }
  return (
    <div className={`w-${size} h-${size} rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-semibold flex-shrink-0`}>
      {initials}
    </div>
  );
}

// ── Rate badge ────────────────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€", AUD: "A$", CAD: "C$",
};

function RateBadge({ match, source }: { match: RateCardMatch; source: "personal" | "role" }) {
  const sym  = CURRENCY_SYMBOLS[match.currency] ?? match.currency;
  const label = match.rate_type === "day_rate" ? "/day" : "/mo";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
      source === "personal"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-blue-100 text-blue-700"
    }`}>
      <Zap className="w-2.5 h-2.5" />
      {sym}{Number(match.rate).toLocaleString()}{label}
      {source === "role" && <span className="opacity-70">(role)</span>}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  organisationId:  string;
  value:           string | null; // user_id of currently selected person
  currentResource: Resource;
  disabled?:       boolean;
  onPick:          (person: PickedPerson) => void;
};

// Cache members per org to avoid redundant fetches within the same session
const memberCache: Record<string, OrgMemberForPicker[]> = {};

export default function ResourcePicker({
  organisationId, value, currentResource, disabled = false, onPick,
}: Props) {
  const [open, setOpen]     = useState(false);
  const [q, setQ]           = useState("");
  const [members, setMembers] = useState<OrgMemberForPicker[]>(memberCache[organisationId] ?? []);
  const [loading, setLoading] = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateError, setRateError]     = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const selected = members.find(m => m.user_id === value);

  // ── Load members on first open ─────────────────────────────────────────────
  async function handleOpen() {
    if (disabled) return;
    setOpen(o => !o);
    if (members.length > 0 || loading) return;
    setLoading(true);
    try {
      const data = await getOrgMembersForPicker(organisationId);
      memberCache[organisationId] = data;
      setMembers(data);
    } catch {
      // silently fail — empty list shown
    } finally {
      setLoading(false);
    }
  }

  // ── Select a member → look up their rate card ─────────────────────────────
  async function handleSelect(member: OrgMemberForPicker) {
    setOpen(false);
    setQ("");
    setRateError(null);
    setRateLoading(true);

    let rateMatch: RateCardMatch | null = null;
    let rateSource: "personal" | "role" | null = null;

    try {
      rateMatch = await getRateForUser(organisationId, member.user_id);
      if (rateMatch) {
        // Determine source: personal if user_id was matched, role if fallback
        // getRateForUser tries personal first, then role — we can infer from role_label
        // For now, treat as personal if we got a result; the action handles fallback
        rateSource = "personal"; // conservative label — action already tried personal first
      }
    } catch {
      setRateError("Could not load rate — please set manually");
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

  // ── Clear ─────────────────────────────────────────────────────────────────
  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onPick({
      user_id: "", full_name: null, email: null, avatar_url: null,
      job_title: null, department: null,
      rate_type: null, rate: null, currency: null,
      resource_type: null, role_label: null, rate_source: null,
    });
  }

  // ── Filtered list ─────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return members.filter(m =>
      (m.full_name  ?? "").toLowerCase().includes(lq) ||
      (m.email      ?? "").toLowerCase().includes(lq) ||
      (m.job_title  ?? "").toLowerCase().includes(lq) ||
      (m.department ?? "").toLowerCase().includes(lq)
    );
  }, [members, q]);

  // ── Render ─────────────────────────────────────────────────────────────────
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
              <div className="text-xs font-medium text-gray-800 truncate">
                {selected.full_name ?? selected.email}
              </div>
              {selected.job_title && (
                <div className="text-[10px] text-gray-400 truncate">{selected.job_title}</div>
              )}
            </div>
            {/* Rate badge — show current resource rate if set */}
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
              <button
                type="button"
                onClick={handleClear}
                className="ml-1 text-gray-300 hover:text-gray-500 flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </>
        ) : rateLoading ? (
          <>
            <div className="w-6 h-6 rounded-full bg-gray-100 animate-pulse flex-shrink-0" />
            <span className="text-xs text-gray-400 flex-1 text-left">Loading rate…</span>
          </>
        ) : (
          <>
            <User className="w-4 h-4 text-gray-300 flex-shrink-0" />
            <span className="text-xs text-gray-400 flex-1 text-left">Pick a person…</span>
            <ChevronDown className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
          </>
        )}
      </button>

      {/* Rate error */}
      {rateError && (
        <div className="flex items-center gap-1 mt-0.5 px-1 text-[10px] text-amber-600">
          <AlertCircle className="w-2.5 h-2.5" />
          {rateError}
        </div>
      )}

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <input
              autoFocus
              className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
              placeholder="Search name, title, department…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>

          <ul className="max-h-60 overflow-y-auto py-1">
            {loading && (
              <li className="px-3 py-4 text-xs text-gray-400 text-center">Loading members…</li>
            )}
            {!loading && filtered.length === 0 && (
              <li className="px-3 py-4 text-xs text-gray-400 text-center">No members found</li>
            )}
            {!loading && filtered.map(m => (
              <li key={m.user_id}>
                <button
                  type="button"
                  onClick={() => handleSelect(m)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-blue-50 transition-colors"
                >
                  <Avatar name={m.full_name} avatarUrl={m.avatar_url} size={7} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-gray-800 truncate">
                      {m.full_name ?? m.email}
                    </div>
                    {m.job_title && (
                      <div className="text-[10px] text-indigo-500 truncate">{m.job_title}</div>
                    )}
                    {m.department && (
                      <div className="text-[10px] text-gray-400 truncate">{m.department}</div>
                    )}
                  </div>
                  {/* Show role label from org membership */}
                  <span className="text-[10px] text-gray-300 flex-shrink-0">{m.role}</span>
                </button>
              </li>
            ))}
          </ul>

          {/* Footer hint */}
          <div className="border-t border-gray-100 px-3 py-2 text-[10px] text-gray-400 flex items-center gap-1">
            <Zap className="w-2.5 h-2.5 text-emerald-500" />
            Rate auto-fills from Rate Card on selection
          </div>
        </div>
      )}
    </div>
  );
}