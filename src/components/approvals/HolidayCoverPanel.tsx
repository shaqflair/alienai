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

function clean(x: any) {
  const t = String(x ?? "").trim();
  return t || "";
}

function fmt(x: string) {
  try {
    const d = new Date(x);
    return Number.isNaN(d.getTime())
      ? x
      : d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return x;
  }
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

  const [fromUserId, setFromUserId] = useState("");
  const [toUserId, setToUserId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");

  async function load() {
    setErr("");
    if (isBadId(projectId)) {
      setMembers([]);
      setItems([]);
      setErr("Missing projectId");
      return;
    }

    setLoading(true);
    try {
      // ✅ org users (route supports projectId OR orgId; we use projectId here)
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

      // delegations
      const dRes = await fetch(
        `/api/approvals/delegations?projectId=${encodeURIComponent(projectId)}`
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

  const label = useMemo(() => {
    const map = new Map(members.map((m) => [clean(m.user_id), memberLabel(m)]));
    return (uid: string) => map.get(clean(uid)) || clean(uid) || "User";
  }, [members]);

  // keep selections valid if members refresh
  useEffect(() => {
    const ids = new Set(members.map((m) => clean(m.user_id)));
    if (fromUserId && !ids.has(clean(fromUserId))) setFromUserId("");
    if (toUserId && !ids.has(clean(toUserId))) setToUserId("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.length]);

  const saveDisabled =
    !canEdit ||
    !fromUserId ||
    !toUserId ||
    !startsAt ||
    !endsAt ||
    clean(fromUserId) === clean(toUserId);

  async function save() {
    setErr("");

    if (!canEdit) {
      setErr("Read-only: platform admin permission required to manage holiday cover.");
      return;
    }

    if (!clean(fromUserId) || !clean(toUserId) || !clean(startsAt) || !clean(endsAt)) return;

    if (clean(fromUserId) === clean(toUserId)) {
      setErr("Delegate from and cover person must be different.");
      return;
    }

    try {
      const res = await fetch("/api/approvals/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          from_user_id: fromUserId,
          to_user_id: toUserId,
          starts_at: startsAt,
          ends_at: endsAt,
          reason: reason.trim() || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) {
        const hint = authHintFromStatus(res.status);
        setErr((json?.error || "Failed to save holiday cover") + (hint ? ` (${hint})` : ""));
        return;
      }

      setFromUserId("");
      setToUserId("");
      setStartsAt("");
      setEndsAt("");
      setReason("");
      await load();
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to save holiday cover"));
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

  return (
    <section className="rounded-xl border bg-white">
      <div className="p-4 flex items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold">Holiday cover</div>
          <div className="text-sm text-gray-600">
            Delegate approvals for a date range.
          </div>

          {!canEdit ? (
            <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              Read-only: holiday cover can only be edited by a <b>platform admin</b>.
            </div>
          ) : (
            <div className="mt-2 text-xs text-emerald-700">Admin mode</div>
          )}

          {loading ? <div className="mt-1 text-xs text-gray-500">Loading…</div> : null}
        </div>

        <button
          onClick={load}
          className="text-sm underline hover:opacity-80"
          type="button"
        >
          Refresh
        </button>
      </div>

      {err ? <div className="border-t p-3 text-sm text-red-600">{err}</div> : null}

      <div className="border-t p-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-1">
          <span className="text-xs text-gray-600">Delegate from</span>
          <select
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            value={fromUserId}
            onChange={(e) => setFromUserId(e.target.value)}
            disabled={!canEdit}
          >
            <option value="">Select member…</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-gray-600">Cover person</span>
          <select
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            value={toUserId}
            onChange={(e) => setToUserId(e.target.value)}
            disabled={!canEdit}
          >
            <option value="">Select member…</option>
            {members.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {memberLabel(m)}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-gray-600">Starts (ISO)</span>
          <input
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            placeholder="2026-01-10T00:00:00Z"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            disabled={!canEdit}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-xs text-gray-600">Ends (ISO)</span>
          <input
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            placeholder="2026-01-20T00:00:00Z"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            disabled={!canEdit}
          />
        </label>

        <label className="grid gap-1 md:col-span-2">
          <span className="text-xs text-gray-600">Reason (optional)</span>
          <input
            className="rounded border px-3 py-2 text-sm disabled:opacity-50"
            placeholder="Annual leave, sick cover, etc."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={!canEdit}
          />
        </label>

        <div className="md:col-span-2">
          <button
            onClick={save}
            disabled={saveDisabled}
            className="rounded border px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
            type="button"
            title={!canEdit ? "Platform admin only" : undefined}
          >
            Save holiday cover
          </button>

          {fromUserId && toUserId && clean(fromUserId) === clean(toUserId) ? (
            <div className="mt-1 text-xs text-amber-700">
              Delegate from and cover person must be different.
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t p-4 space-y-2">
        <div className="font-medium">Current cover rules</div>

        {!items.length ? (
          <div className="text-sm text-gray-600">No holiday cover set.</div>
        ) : (
          <div className="divide-y rounded-lg border">
            {items.map((d) => (
              <div key={d.id} className="p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm">
                    <span className="font-medium">{label(d.from_user_id)}</span> →{" "}
                    <span className="font-medium">{label(d.to_user_id)}</span>
                  </div>
                  <div className="text-xs text-gray-600">
                    {fmt(d.starts_at)} → {fmt(d.ends_at)}{" "}
                    {d.reason ? `· ${d.reason}` : ""}
                  </div>
                </div>

                <button
                  onClick={() => remove(d.id)}
                  className="text-xs underline hover:opacity-80 disabled:opacity-50"
                  type="button"
                  disabled={!canEdit}
                  title={!canEdit ? "Platform admin only" : undefined}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}