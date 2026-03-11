"use client";

import React, { useMemo, useState } from "react";
import {
  updateMemberRole,
  removeMember,
  restoreMember,
  addMemberFromOrg,
  revokeInvite,
} from "@/app/projects/[id]/members/actions";

export type Role = "owner" | "editor" | "viewer" | (string & {});

export type MemberRow = {
  project_id?: string;
  user_id: string;
  full_name?: string | null;
  display_name?: string | null;
  email?: string | null;
  role: Role;
  removed_at?: string | null;
  status?: string;
};

export type InviteRow = {
  id: string;
  project_id?: string;
  email: string;
  role: Role;
  status?: string;
  invited_at?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
};

export type OrgMemberOption = {
  user_id: string;
  full_name: string | null;
  email: string | null;
};

function canManage(myRole: Role) {
  return String(myRole).toLowerCase() === "owner";
}

function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "info" | "danger";
}) {
  const cls =
    tone === "danger"
      ? "border-red-200 bg-red-50 text-red-700"
      : tone === "info"
        ? "border-sky-200 bg-sky-50 text-sky-700"
        : "border-gray-200 bg-white text-gray-700";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {children}
    </span>
  );
}

function ConfirmInline({
  label,
  onConfirm,
  disabled,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <button
        type="button"
        className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        onClick={() => setArmed(true)}
        disabled={disabled}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-sm text-red-600">Are you sure?</span>
      <button
        type="button"
        className="rounded border border-red-300 px-2 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
        onClick={onConfirm}
        disabled={disabled}
      >
        Confirm
      </button>
      <button
        type="button"
        className="rounded border border-gray-200 px-2 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
        onClick={() => setArmed(false)}
        disabled={disabled}
      >
        Cancel
      </button>
    </span>
  );
}

function fmtUtc(x: string) {
  try {
    return new Date(x).toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return x;
  }
}

export default function MembersClient({
  projectId,
  myRole,
  members,
  invites,
  orgMembers = [],
}: {
  projectId: string;
  myRole: Role;
  members: MemberRow[];
  invites: InviteRow[];
  orgMembers?: OrgMemberOption[];
}) {
  const manage = canManage(myRole);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Add member picker state
  const [selectedUserId, setSelectedUserId] = useState("");
  const [addRole, setAddRole] = useState<Role>("viewer");
  const [search, setSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedName, setSelectedName] = useState("");

  const currentMemberIds = new Set(members.map((m) => m.user_id));

  // Org members not already on the project
  const availableOrgMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orgMembers
      .filter((m) => !currentMemberIds.has(m.user_id))
      .filter((m) =>
        q
          ? (m.full_name || "").toLowerCase().includes(q) ||
            (m.email || "").toLowerCase().includes(q)
          : true
      );
  }, [orgMembers, currentMemberIds, search]);

  const sortedMembers = useMemo(() => {
    const rank = (r: string) => (r === "owner" ? 0 : r === "editor" ? 1 : 2);
    return [...(members ?? [])].sort((a, b) => rank(String(a.role)) - rank(String(b.role)));
  }, [members]);

  async function run(fn: () => Promise<void>) {
    setErr("");
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  const busyBadge = busy ? <Pill tone="info">Working…</Pill> : null;

  return (
    <div className="relative z-[2] space-y-8 bg-white p-6 text-gray-900 opacity-100">
      {err ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <div className="whitespace-pre-wrap">{err}</div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
            onClick={() => setErr("")}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* ── Add member from org ── */}
      {manage ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-gray-900">Add member</div>
            {busyBadge}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            {/* People picker */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700">Person</div>
              <div className="relative w-[280px]">
                <input
                  className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 disabled:opacity-60"
                  value={selectedUserId ? selectedName : search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setSelectedUserId("");
                    setSelectedName("");
                    setDropdownOpen(true);
                  }}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
                  placeholder="Search by name or email..."
                  disabled={busy}
                />
                {dropdownOpen && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                    {availableOrgMembers.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-400">
                        {orgMembers.length === 0
                          ? "No org members found"
                          : "All org members already added"}
                      </div>
                    ) : (
                      availableOrgMembers.map((m) => (
                        <div
                          key={m.user_id}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setSelectedUserId(m.user_id);
                            setSelectedName(m.full_name || m.email || m.user_id);
                            setSearch("");
                            setDropdownOpen(false);
                          }}
                          className="flex cursor-pointer flex-col gap-0.5 border-b border-gray-100 px-3 py-2 last:border-b-0 hover:bg-gray-50"
                        >
                          <span className="text-sm font-medium text-gray-900">
                            {m.full_name || "—"}
                          </span>
                          <span className="text-xs text-gray-500">{m.email}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Role picker */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700">Role</div>
              <select
                className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:opacity-60"
                value={addRole}
                onChange={(e) => setAddRole(e.target.value as Role)}
                disabled={busy}
              >
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="owner">owner</option>
              </select>
            </div>

            {/* Add button */}
            <button
              type="button"
              className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              disabled={busy || !selectedUserId}
              onClick={() =>
                run(async () => {
                  await addMemberFromOrg(projectId, selectedUserId, addRole as any);
                  setSelectedUserId("");
                  setSelectedName("");
                  setSearch("");
                })
              }
            >
              Add to project
            </button>
          </div>

          <div className="text-xs text-gray-500">
            Only people already in your organisation appear here.
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700 shadow-sm">
          You can view members. Only <b>owners</b> can add or remove members.
        </div>
      )}

      {/* ── Active members ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-semibold text-gray-900">Active members</div>
          <div className="flex items-center gap-2">
            {busyBadge}
            <Pill>{sortedMembers.length} total</Pill>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-600">
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-3 font-medium">Member</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedMembers.map((m) => {
                const memberName = m.display_name || m.full_name || m.email || m.user_id;
                return (
                  <tr key={m.user_id} className="border-b border-gray-200 last:border-b-0">
                    <td className="py-3 pr-3">
                      <div className="font-medium text-gray-900">{memberName}</div>
                      {m.email ? <div className="text-xs text-gray-600">{m.email}</div> : null}
                    </td>
                    <td className="py-3 pr-3">
                      {manage ? (
                        <select
                          className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 disabled:opacity-60"
                          value={String(m.role)}
                          disabled={busy}
                          onChange={(e) =>
                            run(async () => {
                              await updateMemberRole(projectId, m.user_id, e.target.value as any);
                            })
                          }
                        >
                          <option value="viewer">viewer</option>
                          <option value="editor">editor</option>
                          <option value="owner">owner</option>
                        </select>
                      ) : (
                        <Pill>{String(m.role)}</Pill>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      {manage ? (
                        <div className="flex flex-wrap gap-2">
                          <ConfirmInline
                            label="Remove"
                            disabled={busy}
                            onConfirm={() =>
                              run(async () => { await removeMember(projectId, m.user_id); })
                            }
                          />
                          <button
                            type="button"
                            className="rounded border border-gray-300 bg-white px-2 py-1 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-60"
                            disabled={busy}
                            onClick={() =>
                              run(async () => { await restoreMember(projectId, m.user_id); })
                            }
                          >
                            Restore
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {sortedMembers.length === 0 ? (
                <tr>
                  <td className="py-4 text-gray-600" colSpan={3}>No members found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pending invites (legacy cleanup only) ── */}
      {(invites ?? []).length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="font-semibold text-gray-900">Pending invites</div>
            <Pill>{invites.length} pending</Pill>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-600">
                <tr className="border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Email</th>
                  <th className="py-2 pr-3 font-medium">Role</th>
                  <th className="py-2 pr-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-200 last:border-b-0">
                    <td className="py-3 pr-3">
                      <div className="font-medium text-gray-900">{inv.email}</div>
                      {inv.invited_at ? (
                        <div className="text-xs text-gray-600">Invited: {fmtUtc(inv.invited_at)}</div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3"><Pill>{String(inv.role)}</Pill></td>
                    <td className="py-3 pr-3">
                      {manage ? (
                        <ConfirmInline
                          label="Revoke invite"
                          disabled={busy}
                          onConfirm={() =>
                            run(async () => { await revokeInvite(inv.id, projectId); })
                          }
                        />
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}