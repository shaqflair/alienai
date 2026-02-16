"use client";

import React, { useEffect, useMemo, useState } from "react";

type Group = { id: string; name?: string | null };

type Rule = {
  id: string;
  organisation_id: string;
  artifact_type: string;
  approval_role: string;
  step: number;
  min_amount: number;
  max_amount: number | null;
  is_active: boolean;
  created_at?: string | null;

  approval_group_id?: string | null;
  approver_user_id?: string | null;
};

type OrgApprover = {
  id: string;
  organisation_id: string;
  user_id: string | null;
  email: string | null;
  name: string | null;
  approver_role: string | null;
  department: string | null;
  is_active: boolean;
  created_at?: string | null;
  label?: string | null;
};

function clean(x: any) {
  const t = String(x ?? "").trim();
  return t || "";
}

function safeOrgIdOf(x: any) {
  const s = clean(x);
  if (!s || s === "undefined" || s === "null") return "";
  return s;
}

function safeNum(x: any, fallback: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function money(n: any) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "£0";
  return `£${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function approverLabel(a: any) {
  const email = clean(a?.email);
  const name = clean(a?.name);
  const dept = clean(a?.department);
  const role = clean(a?.approver_role);

  const main = name || email || "Approver";
  const meta = [email && name ? email : "", dept && `Dept: ${dept}`, role && `Role: ${role}`]
    .filter(Boolean)
    .join(" · ");

  return meta ? `${main} · ${meta}` : main;
}

export default function RulesPanel({
  orgId,
  artifactType = "change",
}: {
  orgId: string;
  artifactType?: string;
}) {
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const [rules, setRules] = useState<Rule[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [orgApprovers, setOrgApprovers] = useState<OrgApprover[]>([]);

  const safeOrgId = useMemo(() => safeOrgIdOf(orgId), [orgId]);

  async function loadAll() {
    setErr("");
    if (!safeOrgId) {
      setErr("Missing organisation id");
      return;
    }

    setLoading(true);
    try {
      const [rRes, gRes, aRes] = await Promise.all([
        fetch(
          `/api/approvals/rules?orgId=${encodeURIComponent(safeOrgId)}&artifactType=${encodeURIComponent(
            artifactType
          )}`
        ),
        fetch(
          `/api/approvals/groups?orgId=${encodeURIComponent(safeOrgId)}&artifactType=${encodeURIComponent(
            artifactType
          )}`
        ),
        fetch(`/api/approvals/approvers?orgId=${encodeURIComponent(safeOrgId)}&q=`),
      ]);

      const rJson = await rRes.json().catch(() => ({}));
      const gJson = await gRes.json().catch(() => ({}));
      const aJson = await aRes.json().catch(() => ({}));

      if (!rRes.ok || !rJson?.ok) throw new Error(rJson?.error || "Failed to load rules");
      if (!gRes.ok || !gJson?.ok) throw new Error(gJson?.error || "Failed to load groups");
      if (!aRes.ok || !aJson?.ok) throw new Error(aJson?.error || "Failed to load approvers");

      // ✅ API returns { rules: [...] }
      setRules((rJson.rules ?? []) as Rule[]);
      setGroups((gJson.groups ?? []) as Group[]);
      setOrgApprovers((aJson.approvers ?? []) as OrgApprover[]);
    } catch (e: any) {
      setErr(String(e?.message || e || "Error"));
      setRules([]);
      setGroups([]);
      setOrgApprovers([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeOrgId, artifactType]);

  const groupById = useMemo(() => {
    const m = new Map<string, Group>();
    for (const g of groups ?? []) m.set(clean(g?.id), g);
    return m;
  }, [groups]);

  const linkableApprovers = useMemo(() => {
    return (orgApprovers ?? []).filter((a) => Boolean(clean(a.user_id)));
  }, [orgApprovers]);

  // --- Add rule form state ---
  const [step, setStep] = useState("1");
  const [role, setRole] = useState("Approver");
  const [min, setMin] = useState("0");
  const [max, setMax] = useState("");
  const [targetMode, setTargetMode] = useState<"group" | "user">("group");

  const [groupId, setGroupId] = useState("");
  const [userPickQ, setUserPickQ] = useState("");
  const [pickedApproverId, setPickedApproverId] = useState(""); // organisation_approvers.id (UI select)
  const [userId, setUserId] = useState(""); // auth.users.id (saved into rule.approver_user_id)

  // ✅ keep group selection valid
  useEffect(() => {
    if (targetMode !== "group") return;
    const first = groups?.[0]?.id;
    const next = clean(first);
    setGroupId((prev) => {
      if (prev && (groups ?? []).some((g: any) => String(g?.id) === String(prev))) return prev;
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactType, targetMode, groups.length]);

  const filteredLinkableApprovers = useMemo(() => {
    const q = userPickQ.trim().toLowerCase();
    const items = linkableApprovers;
    if (!q) return items;

    return items.filter((a) => {
      const hay = `${a.email ?? ""} ${a.name ?? ""} ${a.department ?? ""} ${a.approver_role ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [linkableApprovers, userPickQ]);

  // ✅ keep user selection valid (pickedApproverId + userId)
  useEffect(() => {
    if (targetMode !== "user") return;

    const first = filteredLinkableApprovers[0];
    const firstId = clean(first?.id);
    const firstUserId = clean(first?.user_id);

    setPickedApproverId((prev) => {
      if (prev && filteredLinkableApprovers.some((a) => String(a.id) === String(prev))) return prev;
      return firstId;
    });

    setUserId((prev) => {
      // if pickedApproverId changes, we'll set userId below in the onChange handler too
      return prev || firstUserId;
    });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetMode, artifactType, filteredLinkableApprovers.length]);

  async function addRule() {
    setErr("");
    if (!safeOrgId) return;

    const stepNo = Math.max(1, safeNum(step || 1, 1));
    const minNo = Math.max(0, safeNum(min || 0, 0));
    const maxNo = max === "" ? null : safeNum(max, NaN);

    if (maxNo != null && Number.isFinite(maxNo) && maxNo < minNo) {
      setErr("Max amount must be >= min amount");
      return;
    }

    const payload: any = {
      orgId: safeOrgId,
      artifactType,
      step: stepNo,
      approval_role: role.trim() || "Approver",
      min_amount: minNo,
      max_amount: maxNo == null ? null : Number(maxNo),
      is_active: true,
    };

    if (targetMode === "group") {
      if (!clean(groupId)) return alert("Select a group first.");
      payload.approval_group_id = groupId;
    } else {
      if (!clean(userId)) {
        return alert(
          "Selected approver is not linked to a user account yet. Ask them to sign in once, or use a Group rule."
        );
      }
      payload.approver_user_id = userId;
    }

    const res = await fetch("/api/approvals/rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      setErr(json?.error || "Failed to add rule");
      return;
    }

    await loadAll();
  }

  async function removeRule(id: string) {
    const okConfirm = window.confirm("Disable this rule?");
    if (!okConfirm) return;

    const url = new URL("/api/approvals/rules", window.location.origin);
    url.searchParams.set("orgId", safeOrgId);
    url.searchParams.set("id", id);

    const res = await fetch(url.toString(), { method: "DELETE" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json?.ok) {
      setErr(json?.error || "Failed to delete rule");
      return;
    }

    await loadAll();
  }

  const sorted = useMemo(() => {
    const r = [...(rules ?? [])];
    r.sort(
      (a: any, b: any) =>
        Number(a.step ?? 1) - Number(b.step ?? 1) ||
        Number(a.min_amount ?? 0) - Number(b.min_amount ?? 0)
    );
    return r;
  }, [rules]);

  function formatGroupName(id: string) {
    const g = groupById.get(clean(id));
    return clean(g?.name) || "Group";
  }

  function formatApproverName(uid: string) {
    const a = (orgApprovers ?? []).find((x) => clean(x.user_id) === clean(uid));
    return a ? approverLabel(a) : "Approver";
  }

  return (
    <div className="space-y-3">
      {err ? <div className="text-sm text-red-600">{err}</div> : null}
      {loading ? <div className="text-sm text-gray-600">Loading…</div> : null}

      <div className="border rounded-lg p-3 space-y-3">
        <div className="text-sm font-semibold">Add rule</div>

        <div className="grid md:grid-cols-4 gap-2">
          <label className="text-xs text-gray-600">
            Step
            <input
              className="block border rounded-md px-2 py-1 text-sm"
              value={step}
              onChange={(e) => setStep(e.target.value)}
            />
          </label>

          <label className="text-xs text-gray-600">
            Role label
            <input
              className="block border rounded-md px-2 py-1 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            />
          </label>

          <label className="text-xs text-gray-600">
            Min amount
            <input
              className="block border rounded-md px-2 py-1 text-sm"
              value={min}
              onChange={(e) => setMin(e.target.value)}
            />
          </label>

          <label className="text-xs text-gray-600">
            Max amount (blank=∞)
            <input
              className="block border rounded-md px-2 py-1 text-sm"
              value={max}
              onChange={(e) => setMax(e.target.value)}
            />
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-600">
            Target type
            <select
              className="block border rounded-md px-2 py-1 text-sm"
              value={targetMode}
              onChange={(e) => setTargetMode(e.target.value as any)}
            >
              <option value="group">Group</option>
              <option value="user">User</option>
            </select>
          </label>

          {targetMode === "group" ? (
            <label className="text-xs text-gray-600">
              Group
              <select
                className="block border rounded-md px-2 py-1 text-sm w-[320px]"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              >
                {groups.length === 0 ? (
                  <option value="">No groups yet</option>
                ) : (
                  groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name || "Unnamed group"}
                    </option>
                  ))
                )}
              </select>
            </label>
          ) : (
            <div className="space-y-2">
              <label className="text-xs text-gray-600">
                Search approvers
                <input
                  className="block border rounded-md px-2 py-1 text-sm w-[320px]"
                  value={userPickQ}
                  onChange={(e) => setUserPickQ(e.target.value)}
                />
              </label>

              <label className="text-xs text-gray-600">
                Select approver
                <select
                  className="block border rounded-md px-2 py-1 text-sm w-[320px]"
                  value={pickedApproverId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setPickedApproverId(id);
                    const a = (orgApprovers ?? []).find((x) => String(x.id) === String(id));
                    setUserId(clean(a?.user_id));
                  }}
                >
                  {filteredLinkableApprovers.length === 0 ? (
                    <option value="">No linked approvers found</option>
                  ) : (
                    filteredLinkableApprovers.map((a) => (
                      <option key={a.id} value={a.id}>
                        {approverLabel(a)}
                      </option>
                    ))
                  )}
                </select>

                {filteredLinkableApprovers.length === 0 ? (
                  <div className="mt-1 text-xs text-amber-700">
                    No approvers are linked to a user account yet. Ask them to sign in once, or use a Group rule.
                  </div>
                ) : null}
              </label>
            </div>
          )}

          <button
            className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50"
            type="button"
            onClick={addRule}
            disabled={!safeOrgId || (targetMode === "group" ? !clean(groupId) : !clean(userId))}
          >
            Add
          </button>
        </div>

        <div className="text-xs text-gray-500">
          Tip: add groups first, then attach rules to groups. This keeps rules stable even before users sign in.
        </div>
      </div>

      <div className="divide-y border rounded-lg">
        {sorted.length === 0 ? (
          <div className="p-3 text-sm text-gray-600">No rules for this artifact type.</div>
        ) : (
          sorted.map((r: any) => {
            const isGroup = Boolean(clean(r.approval_group_id));
            const who = isGroup
              ? `Group: ${formatGroupName(r.approval_group_id)}`
              : `Approver: ${formatApproverName(r.approver_user_id)}`;

            return (
              <div key={r.id} className="p-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    Step {r.step ?? 1} — {r.approval_role || "Approver"}
                  </div>
                  <div className="text-xs text-gray-700">
                    Band: {money(r.min_amount)} → {r.max_amount == null ? "∞" : money(r.max_amount)}
                  </div>
                  <div className="text-xs text-gray-700 truncate">{who}</div>
                </div>

                <button
                  className="border rounded-md px-3 py-1.5 text-sm hover:bg-gray-50"
                  type="button"
                  onClick={() => removeRule(r.id)}
                >
                  Disable
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
