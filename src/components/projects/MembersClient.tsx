// src/components/projects/MembersClient.tsx
"use client";

import React, { useMemo, useState, useTransition } from "react";

import {
  updateMemberRole,
  removeMember,
  restoreMember, // ✅ FIX: you were calling this but not importing it
  inviteMember,
  resendInvite,
  revokeInvite,
} from "@/app/projects/[id]/members/actions";

export type Role = "owner" | "editor" | "viewer" | (string & {});

export type MemberRow = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
  role: Role;
  status?: string; // e.g. "active"
};

export type InviteRow = {
  id: string;
  email: string;
  role: Role;
  status?: string; // e.g. "pending"
  created_at?: string | null;
  expires_at?: string | null;
};

function canManage(myRole: Role) {
  return String(myRole).toLowerCase() === "owner"; // strict v1
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border bg-white px-2 py-0.5 text-xs">
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
        className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
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
        className="rounded border border-red-300 px-2 py-1 text-sm hover:bg-red-50"
        onClick={onConfirm}
        disabled={disabled}
      >
        Confirm
      </button>
      <button
        type="button"
        className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
        onClick={() => setArmed(false)}
        disabled={disabled}
      >
        Cancel
      </button>
    </span>
  );
}

function isEmailLike(v: string) {
  const s = String(v ?? "").trim();
  return s.includes("@") && s.includes(".");
}

export default function MembersClient({
  projectId,
  myRole,
  members,
  invites,
}: {
  projectId: string;
  myRole: Role;
  members: MemberRow[];
  invites: InviteRow[];
}) {
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string>("");

  const manage = canManage(myRole);

  const sortedMembers = useMemo(() => {
    const rank = (r: string) => (r === "owner" ? 0 : r === "editor" ? 1 : 2);
    return [...(members ?? [])].sort((a, b) => rank(String(a.role)) - rank(String(b.role)));
  }, [members]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("viewer");

  function handleError(e: any) {
    const msg = e?.message || String(e);
    setErr(msg);
  }

  return (
    <div className="space-y-8">
      {err ? (
        <div className="rounded border bg-red-50 p-3 text-sm text-red-700">{err}</div>
      ) : null}

      {/* Invite */}
      {manage ? (
        <div className="space-y-3 rounded border bg-white p-4">
          <div className="font-medium">Invite member</div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs text-gray-500">Email</div>
              <input
                className="w-[280px] rounded border px-3 py-2"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={pending}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs text-gray-500">Role</div>
              <select
                className="rounded border px-3 py-2"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                disabled={pending}
              >
                <option value="viewer">viewer</option>
                <option value="editor">editor</option>
                <option value="owner">owner</option>
              </select>
            </div>

            <button
              type="button"
              className="rounded border px-3 py-2 hover:bg-gray-50"
              disabled={pending || !inviteEmail.trim() || !isEmailLike(inviteEmail)}
              onClick={() => {
                setErr("");
                startTransition(async () => {
                  try {
                    await inviteMember(projectId, inviteEmail.trim(), inviteRole as any);
                    setInviteEmail("");
                  } catch (e) {
                    handleError(e);
                  }
                });
              }}
            >
              Invite
            </button>
          </div>

          <div className="text-xs text-gray-500">
            Invites can be resent or revoked. Members can be removed (soft delete).
          </div>
        </div>
      ) : (
        <div className="rounded border bg-white p-4 text-sm text-gray-600">
          You can view members. Only <b>owners</b> can invite/remove/change roles.
        </div>
      )}

      {/* Members */}
      <div className="rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium">Active members</div>
          <Pill>{sortedMembers.length} total</Pill>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr className="border-b">
                <th className="py-2 pr-3">Member</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {sortedMembers.map((m) => (
                <tr key={m.user_id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{m.full_name || m.email || m.user_id}</div>
                    {m.email ? <div className="text-xs text-gray-500">{m.email}</div> : null}
                  </td>

                  <td className="py-2 pr-3">
                    {manage ? (
                      <select
                        className="rounded border px-2 py-1"
                        value={String(m.role)}
                        disabled={pending}
                        onChange={(e) => {
                          setErr("");
                          startTransition(async () => {
                            try {
                              await updateMemberRole(projectId, m.user_id, e.target.value as any);
                            } catch (err) {
                              handleError(err);
                            }
                          });
                        }}
                      >
                        <option value="viewer">viewer</option>
                        <option value="editor">editor</option>
                        <option value="owner">owner</option>
                      </select>
                    ) : (
                      <Pill>{String(m.role)}</Pill>
                    )}
                  </td>

                  <td className="py-2 pr-3">
                    {manage ? (
                      <div className="flex flex-wrap gap-2">
                        <ConfirmInline
                          label="Remove from project"
                          disabled={pending}
                          onConfirm={() => {
                            setErr("");
                            startTransition(async () => {
                              try {
                                await removeMember(projectId, m.user_id);
                              } catch (e) {
                                handleError(e);
                              }
                            });
                          }}
                        />
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                          disabled={pending}
                          onClick={() => {
                            setErr("");
                            startTransition(async () => {
                              try {
                                await restoreMember(projectId, m.user_id);
                              } catch (e) {
                                handleError(e);
                              }
                            });
                          }}
                        >
                          Restore
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}

              {sortedMembers.length === 0 ? (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={3}>
                    No members found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invites */}
      <div className="rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium">Pending invites</div>
          <Pill>{(invites ?? []).length} pending</Pill>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr className="border-b">
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {(invites ?? []).map((inv) => (
                <tr key={inv.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{inv.email}</div>
                    {inv.created_at ? (
                      <div className="text-xs text-gray-500">
                        Invited:{" "}
                        {new Date(inv.created_at).toISOString().replace("T", " ").replace("Z", " UTC")}
                      </div>
                    ) : null}
                  </td>

                  <td className="py-2 pr-3">
                    <Pill>{String(inv.role)}</Pill>
                  </td>

                  <td className="py-2 pr-3">
                    {manage ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                          disabled={pending}
                          onClick={() => {
                            setErr("");
                            startTransition(async () => {
                              try {
                                await resendInvite(inv.id, projectId);
                              } catch (e) {
                                handleError(e);
                              }
                            });
                          }}
                        >
                          Resend invite
                        </button>

                        <ConfirmInline
                          label="Revoke invite"
                          disabled={pending}
                          onConfirm={() => {
                            setErr("");
                            startTransition(async () => {
                              try {
                                await revokeInvite(inv.id, projectId);
                              } catch (e) {
                                handleError(e);
                              }
                            });
                          }}
                        />
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}

              {(invites ?? []).length === 0 ? (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={3}>
                    No pending invites.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-500">
          “Resend invite” typically updates timestamps. “Revoke invite” deletes the invite row only.
        </div>
      </div>

      <div className="hidden">{isEmailLike("x@y.com") ? null : null}</div>
    </div>
  );
}
