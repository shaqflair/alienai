// src/components/approvals/HolidayCoverPanel.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

type Member = {
  user_id: string;
  full_name?: string;
  email?: string;
  role?: string;
  label?: string;
};

type Delegation = {
  id: string;
  from_user_id: string;
  to_user_id: string;
  starts_at: string;
  ends_at: string;
  reason: string | null;
  is_active: boolean;
};

type DelegationStatus = "active" | "upcoming" | "expired";

function clean(x: any) {
  return String(x ?? "").trim();
}

function toDateInputValue(iso: string): string {
  // Convert ISO string to YYYY-MM-DD for date input
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function toIsoFromDate(dateStr: string, endOfDay = false): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr + (endOfDay ? "T23:59:59.000Z" : "T00:00:00.000Z"));
    return d.toISOString();
  } catch {
    return "";
  }
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch {
    return iso;
  }
}

function getDelegationStatus(d: Delegation): DelegationStatus {
  const now = Date.now();
  const start = new Date(d.starts_at).getTime();
  const end = new Date(d.ends_at).getTime();
  if (now < start) return "upcoming";
  if (now > end) return "expired";
  return "active";
}

function StatusBadge({ status }: { status: DelegationStatus }) {
  const cfg = {
    active: {
      bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d",
      dot: "#22c55e", label: "Active",
    },
    upcoming: {
      bg: "#fffbeb", border: "#fde68a", color: "#92400e",
      dot: "#f59e0b", label: "Upcoming",
    },
    expired: {
      bg: "#f4f4f2", border: "#e3e3df", color: "#6b7280",
      dot: "#9ca3af", label: "Expired",
    },
  }[status];

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 20,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      fontSize: 11, fontWeight: 600, color: cfg.color,
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: cfg.dot, flexShrink: 0,
      }} />
      {cfg.label}
    </span>
  );
}

function pickMembers(json: any): Member[] {
  const arr =
    (Array.isArray(json?.items) && json.items) ||
    (Array.isArray(json?.users) && json.users) ||
    (Array.isArray(json?.members) && json.members) ||
    [];
  return (arr as Member[]).filter((m) => clean((m as any)?.user_id));
}

function memberLabel(m: Member) {
  return (
    clean(m.label) ||
    clean(m.full_name) ||
    clean(m.email) ||
    clean(m.user_id) ||
    "Member"
  );
}

function isBadId(x: string) {
  const v = clean(x).toLowerCase();
  return !v || v === "null" || v === "undefined";
}

function authHintFromStatus(status: number) {
  if (status === 401) return "You are not signed in.";
  if (status === 403) return "Platform admin permission required.";
  return "";
}

export default function HolidayCoverPanel({
  projectId,
  canEdit = false,
}: {
  projectId: string;
  canEdit?: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [items, setItems] = useState<Delegation[]>([]);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [showExpired, setShowExpired] = useState(false);

  // Form state — using date strings (YYYY-MM-DD) for <input type="date">
  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [startsDate, setStartsDate] = useState("");   // YYYY-MM-DD
  const [endsDate, setEndsDate] = useState("");        // YYYY-MM-DD
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  async function load(includeInactive = showExpired) {
    setErr("");
    if (isBadId(projectId)) {
      setMembers([]);
      setItems([]);
      setErr("Missing projectId");
      return;
    }

    setLoading(true);
    try {
      const mRes = await fetch(
        `/api/approvals/org-users?projectId=${encodeURIComponent(projectId)}`
      );
      const mJson = await mRes.json().catch(() => ({}));
      if (!mRes.ok || !mJson?.ok) {
        const hint = authHintFromStatus(mRes.status);
        setErr((mJson?.error || "Failed to load members") + (hint ? ` (${hint})` : ""));
        setMembers([]);
      } else {
        setMembers(pickMembers(mJson));
      }

      const dRes = await fetch(
        `/api/approvals/delegations?projectId=${encodeURIComponent(projectId)}${includeInactive ? "&includeInactive=1" : ""}`
      );
      const dJson = await dRes.json().catch(() => ({}));
      if (!dRes.ok || !dJson?.ok) {
        const hint = authHintFromStatus(dRes.status);
        setErr((prev) => prev || (dJson?.error || "Failed to load holiday cover") + (hint ? ` (${hint})` : ""));
        setItems([]);
      } else {
        setItems(dJson.items || []);
      }
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load"));
      setMembers([]);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Reload when toggling expired view
  async function toggleExpired() {
    const next = !showExpired;
    setShowExpired(next);
    await load(next);
  }

  const label = useMemo(() => {
    const map = new Map(members.map((m) => [clean(m.user_id), memberLabel(m)]));
    return (uid: string) => map.get(clean(uid)) || clean(uid) || "User";
  }, [members]);

  // Keep selections valid if members refresh
  useEffect(() => {
    const ids = new Set(members.map((m) => clean(m.user_id)));
    if (fromUserId && !ids.has(clean(fromUserId))) setFromUserId("");
    if (toUserId && !ids.has(clean(toUserId))) setToUserId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.length]);

  // Validation
  const dateError = useMemo(() => {
    if (!startsDate || !endsDate) return null;
    if (new Date(endsDate) <= new Date(startsDate)) {
      return "End date must be after start date.";
    }
    return null;
  }, [startsDate, endsDate]);

  const samePersonError =
    fromUserId && toUserId && clean(fromUserId) === clean(toUserId)
      ? "Delegate from and cover person must be different."
      : null;

  const saveDisabled =
    saving ||
    !canEdit ||
    !fromUserId ||
    !toUserId ||
    !startsDate ||
    !endsDate ||
    !!dateError ||
    !!samePersonError;

  async function save() {
    setErr("");

    if (!canEdit) {
      setErr("Read-only: platform admin permission required to manage holiday cover.");
      return;
    }

    if (!clean(fromUserId) || !clean(toUserId) || !startsDate || !endsDate) return;
    if (dateError || samePersonError) return;

    setSaving(true);
    try {
      const res = await fetch("/api/approvals/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          from_user_id: fromUserId,
          to_user_id: toUserId,
          starts_at: toIsoFromDate(startsDate, false),
          ends_at:   toIsoFromDate(endsDate, true),
          reason: reason.trim() || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const hint = authHintFromStatus(res.status);
        setErr((json?.error || "Failed to save holiday cover") + (hint ? ` (${hint})` : ""));
        return;
      }

      // Reset form
      setFromUserId("");
      setToUserId("");
      setStartsDate("");
      setEndsDate("");
      setReason("");
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to save holiday cover"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setErr("");

    if (!canEdit) {
      setErr("Read-only: platform admin permission required to manage holiday cover.");
      return;
    }

    try {
      const res = await fetch(
        `/api/approvals/delegations?projectId=${encodeURIComponent(projectId)}&id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const hint = authHintFromStatus(res.status);
        setErr((json?.error || "Failed to remove") + (hint ? ` (${hint})` : ""));
      } else {
        await load();
      }
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to remove"));
    }
  }

  // Sorted: active first, upcoming second, expired last
  const sortedItems = useMemo(() => {
    const order: Record<DelegationStatus, number> = { active: 0, upcoming: 1, expired: 2 };
    return [...items].sort((a, b) => {
      const sa = getDelegationStatus(a);
      const sb = getDelegationStatus(b);
      if (order[sa] !== order[sb]) return order[sa] - order[sb];
      return new Date(b.starts_at).getTime() - new Date(a.starts_at).getTime();
    });
  }, [items]);

  const activeCount   = items.filter(d => getDelegationStatus(d) === "active").length;
  const upcomingCount = items.filter(d => getDelegationStatus(d) === "upcoming").length;
  const expiredCount  = items.filter(d => getDelegationStatus(d) === "expired").length;

  const inputClass = "w-full rounded border border-gray-200 px-3 py-2 text-sm focus:border-blue-400 focus:outline-none disabled:opacity-50 disabled:bg-gray-50";

  return (
    <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-100">
        <div>
          <div className="text-base font-semibold text-gray-900">Holiday Cover</div>
          <div className="mt-0.5 text-sm text-gray-500">
            Delegate approval authority for a date range. Active delegates can approve,
            request changes, or reject on behalf of the original approver.
          </div>

          {/* Summary pills */}
          {items.length > 0 && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              {activeCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-semibold text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  {activeCount} active
                </span>
              )}
              {upcomingCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  {upcomingCount} upcoming
                </span>
              )}
              {expiredCount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 border border-gray-200 px-2.5 py-0.5 text-xs font-semibold text-gray-500">
                  {expiredCount} expired
                </span>
              )}
            </div>
          )}

          {!canEdit ? (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Read-only — holiday cover can only be managed by a <b>platform admin</b>.
            </div>
          ) : (
            <div className="mt-2 text-xs font-medium text-emerald-700">✓ Admin mode</div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {loading && <span className="text-xs text-gray-400">Loading…</span>}
          <button
            onClick={() => load()}
            className="rounded border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            type="button"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error ── */}
      {err && (
        <div className="border-b border-red-100 bg-red-50 px-5 py-3 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* ── Add form ── */}
      {canEdit && (
        <div className="border-b border-gray-100 p-5">
          <div className="mb-3 text-sm font-semibold text-gray-700">Add holiday cover</div>
          <div className="grid gap-3 sm:grid-cols-2">

            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-600">Delegate from <span className="text-red-400">*</span></span>
              <select className={inputClass} value={fromUserId} onChange={e => setFromUserId(e.target.value)}>
                <option value="">Select approver going on leave…</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-600">Cover person <span className="text-red-400">*</span></span>
              <select className={inputClass} value={toUserId} onChange={e => setToUserId(e.target.value)}>
                <option value="">Select cover approver…</option>
                {members.map(m => (
                  <option key={m.user_id} value={m.user_id}>{memberLabel(m)}</option>
                ))}
              </select>
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-600">Cover starts <span className="text-red-400">*</span></span>
              {/* FIX: date picker instead of raw ISO text input */}
              <input
                type="date"
                className={inputClass}
                value={startsDate}
                onChange={e => setStartsDate(e.target.value)}
                max={endsDate || undefined}
              />
            </label>

            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-600">Cover ends <span className="text-red-400">*</span></span>
              <input
                type="date"
                className={inputClass}
                value={endsDate}
                onChange={e => setEndsDate(e.target.value)}
                min={startsDate || undefined}
              />
            </label>

            <label className="grid gap-1 sm:col-span-2">
              <span className="text-xs font-medium text-gray-600">Reason (optional)</span>
              <input
                className={inputClass}
                placeholder="Annual leave, sick cover, maternity, etc."
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
            </label>

            {/* Inline validation messages */}
            {samePersonError && (
              <div className="sm:col-span-2 text-xs font-medium text-amber-700">
                ⚠ {samePersonError}
              </div>
            )}
            {dateError && (
              <div className="sm:col-span-2 text-xs font-medium text-red-600">
                ⚠ {dateError}
              </div>
            )}

            <div className="sm:col-span-2 flex items-center gap-3">
              <button
                onClick={save}
                disabled={saveDisabled}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                type="button"
              >
                {saving ? "Saving…" : "Save holiday cover"}
              </button>
              <span className="text-xs text-gray-400">
                The delegate will be notified when approvals are assigned during this period.
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Current cover rules ── */}
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-semibold text-gray-700">
            Cover rules
            {items.length > 0 && (
              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
                {items.length}
              </span>
            )}
          </div>

          {/* FIX: show/hide expired toggle */}
          {expiredCount > 0 && (
            <button
              type="button"
              onClick={toggleExpired}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 underline"
            >
              {showExpired ? `Hide expired (${expiredCount})` : `Show expired (${expiredCount})`}
            </button>
          )}
        </div>

        {!sortedItems.length ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-8 text-center text-sm text-gray-400">
            No holiday cover configured.
          </div>
        ) : (
          <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 overflow-hidden">
            {sortedItems.map(d => {
              const status = getDelegationStatus(d);
              const isExpiredRow = status === "expired";
              return (
                <div
                  key={d.id}
                  className={[
                    "flex items-start justify-between gap-4 px-4 py-3",
                    isExpiredRow ? "bg-gray-50 opacity-70" : "bg-white",
                  ].join(" ")}
                >
                  <div className="min-w-0 flex-1">
                    {/* Who → Who */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800">
                        {label(d.from_user_id)}
                      </span>
                      <span className="text-gray-400">→</span>
                      <span className="text-sm font-semibold text-gray-800">
                        {label(d.to_user_id)}
                      </span>
                      <StatusBadge status={status} />
                    </div>

                    {/* Date range */}
                    <div className="mt-1 text-xs text-gray-500">
                      {fmtDate(d.starts_at)} → {fmtDate(d.ends_at)}
                      {d.reason && (
                        <span className="ml-2 italic">· {d.reason}</span>
                      )}
                    </div>
                  </div>

                  {/* Remove — only show for active/upcoming, not expired */}
                  {canEdit && !isExpiredRow && (
                    <button
                      onClick={() => remove(d.id)}
                      className="shrink-0 rounded border border-red-100 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-100 transition-colors"
                      type="button"
                    >
                      Remove
                    </button>
                  )}

                  {/* Expired label instead of button */}
                  {isExpiredRow && (
                    <span className="shrink-0 text-xs text-gray-400">Ended</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Info note */}
        <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-700">
          <strong>How it works:</strong> When an approval step is assigned to a delegating
          approver, the cover person can approve, request changes, or reject on their behalf.
          Both the original approver and delegate receive notifications. All decisions are
          audit-logged with the delegation reference.
        </div>
      </div>
    </section>
  );
}