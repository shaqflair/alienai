"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Search, X, Check, ChevronDown, User, Loader2 } from "lucide-react";
import type { OrgMemberForPicker, ResourceRate } from "@/app/actions/resource-rates";
import { getOrgMembersForPicker, getResourceRateForUser } from "@/app/actions/resource-rates";
import type { Resource, ResourceRole, ResourceType } from "./FinancialPlanEditor";
import { RESOURCE_ROLE_LABELS } from "./FinancialPlanEditor";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PickedPerson = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
  job_title: string | null;
  // Auto-filled from rate card if available
  rate_type?: "day_rate" | "monthly_cost";
  rate?: number;
  currency?: string;
  resource_type?: ResourceType;
  role_label?: string;
};

type Props = {
  organisationId: string;
  value: string | null;          // current user_id
  currentResource: Resource;     // the resource row being edited
  onPick: (person: PickedPerson) => void;
  disabled?: boolean;
};

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ name, url }: { name: string | null; url: string | null }) {
  const initials = (name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (url) {
    return (
      <img src={url} alt={name ?? ""} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
    );
  }
  return (
    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center flex-shrink-0">
      {initials}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function ResourcePicker({
  organisationId,
  value,
  currentResource,
  onPick,
  disabled = false,
}: Props) {
  const [open,       setOpen]       = useState(false);
  const [query,      setQuery]      = useState("");
  const [members,    setMembers]    = useState<OrgMemberForPicker[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [rateLoading, setRateLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load members once when dropdown opens for first time
  const loaded = useRef(false);
  useEffect(() => {
    if (!open || loaded.current) return;
    loaded.current = true;
    setLoading(true);
    getOrgMembersForPicker(organisationId)
      .then(setMembers)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [open, organisationId]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selected = useMemo(
    () => members.find((m) => m.user_id === value) ?? null,
    [members, value]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return members;
    const q = query.toLowerCase();
    return members.filter(
      (m) =>
        m.full_name?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.department?.toLowerCase().includes(q) ||
        m.department?.toLowerCase().includes(q)
    );
  }, [members, query]);

  const handlePick = useCallback(
    async (member: OrgMemberForPicker) => {
      setOpen(false);
      setQuery("");

      // Start with basic info
      const picked: PickedPerson = {
        user_id:       member.user_id,
        full_name:     member.full_name,
        email:         member.email,
        avatar_url:    member.avatar_url,
        department:    member.department,
        job_title:     member.department,
        role_label:    member.department ?? "",
      };

      onPick(picked); // fire immediately so UI feels snappy

      // Then fetch rate card and enrich
      setRateLoading(true);
      try {
        const rates = await getResourceRateForUser(organisationId, member.user_id);
        if (rates.length > 0) {
          // Prefer day_rate if available, otherwise monthly_cost
          const rate =
            rates.find((r) => r.rate_type === "day_rate") ?? rates[0];

          onPick({
            ...picked,
            rate_type:     rate.rate_type as "day_rate" | "monthly_cost",
            rate:          rate.rate,
            currency:      rate.currency,
            resource_type: rate.resource_type as ResourceType,
            role_label:    rate.role_label || member.department || "",
          });
        }
      } catch (e) {
        console.error("Failed to fetch rate card:", e);
      } finally {
        setRateLoading(false);
      }
    },
    [organisationId, onPick]
  );

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white text-sm text-left hover:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {value && selected ? (
          <>
            <Avatar name={selected.full_name} url={selected.avatar_url} />
            <div className="flex-1 min-w-0">
              <div className="font-medium text-gray-800 text-xs truncate">
                {selected.full_name ?? selected.email}
              </div>
              {selected.department && (
                <div className="text-[10px] text-gray-400 truncate">{selected.department}</div>
              )}
            </div>
            {rateLoading && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />}
          </>
        ) : value && !selected && !loading ? (
          // user_id set but members not loaded yet
          <>
            <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="flex-1 text-xs text-gray-600 truncate">{currentResource.name || "Selected"}</span>
            {rateLoading && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin flex-shrink-0" />}
          </>
        ) : (
          <>
            <User className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <span className="flex-1 text-xs text-gray-400">Pick a person…</span>
          </>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden">
          {/* Search */}
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
              <input
                autoFocus
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, dept…"
                className="flex-1 text-xs text-gray-800 placeholder-gray-400 focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery("")}>
                  <X className="w-3.5 h-3.5 text-gray-400 hover:text-gray-600" />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className="max-h-56 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-8 gap-2 text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Loading people…</span>
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="py-8 text-center text-xs text-gray-400">
                {query ? "No people match your search" : "No org members found"}
              </div>
            )}
            {!loading && filtered.map((m) => (
              <button
                key={m.user_id}
                type="button"
                onClick={() => handlePick(m)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-blue-50 transition-colors ${
                  m.user_id === value ? "bg-blue-50" : ""
                }`}
              >
                <Avatar name={m.full_name} url={m.avatar_url} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-gray-800 truncate">
                    {m.full_name ?? m.email ?? "Unknown"}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    {m.department && (
                      <span className="text-[10px] text-gray-400 truncate">{m.department}</span>
                    )}
                    {m.department && (
                      <span className="text-[10px] text-gray-400 truncate">· {m.job_title}</span>
                    )}
                  </div>
                </div>
                {m.user_id === value && <Check className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />}
              </button>
            ))}
          </div>

          {/* Footer hint */}
          {!loading && members.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
              <p className="text-[10px] text-gray-400">
                Rate will auto-fill from org rate card if set.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}