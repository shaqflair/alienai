// src/components/projects/MembersClient.tsx
"use client";

import React, { useMemo, useState, useTransition } from "react";

import {
  updateMemberRole,
  removeMember,
  restoreMember,
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
  // Support both shapes (server page currently uses invited_at)
  invited_at?: string | null;
  created_at?: string | null;
  expires_at?: string | null;
  project_id?: string; // tolerate
};

function canManage(myRole: Role) {
  return String(myRole).toLowerCase() === "owner"; // strict v1
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
        className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-60"
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
        className="rounded border border-red-300 px-2 py-1 text-sm hover:bg-red-50 disabled:opacity-60"
        onClick={onConfirm}
        disabled={disabled}
      >
        Confirm
      </button>
      <button
        type="button"
        className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-60"
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

  const pendingLabel = pending ? <Pill tone="info">Working…</Pill> : null;

  return (
    <div className="space-y-8">
      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start justify-between gap-3">
          <div className="whitespace-pre-wrap">{err}</div>
          <button
            type="button"
            className="shrink-0 rounded-md border border-red-200 bg-white px-2 py-1 text-xs hover:bg-red-50"
            onClick={() => setErr("")}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {/* Invite */}
      {manage ? (
        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="font-semibold text-gray-900">Invite member</div>
            {pendingLabel}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700">Email</div>
              <input
                className="w-[280px] rounded border border-gray-200 px-3 py-2 text-sm disabled:opacity-60"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={pending}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-medium text-gray-700">Role</div>
              <select
                className="rounded border border-gray-200 px-3 py-2 text-sm disabled:opacity-60"
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
              className="rounded border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
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

          <div className="text-xs text-gray-600">
            Invites can be resent or revoked. Members can be removed (soft delete).
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
          You can view members. Only <b>owners</b> can invite/remove/change roles.
        </div>
      )}

      {/* Members */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-semibold text-gray-900">Active members</div>
          <div className="flex items-center gap-2">
            {pendingLabel}
            <Pill>{sortedMembers.length} total</Pill>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-600">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Member</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Actions</th>
              </tr>
            </thead>

            <tbody>
              {sortedMembers.map((m) => (
                <tr key={m.user_id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium text-gray-900">{m.full_name || m.email || m.user_id}</div>
                    {m.email ? <div className="text-xs text-gray-600">{m.email}</div> : null}
                  </td>

                  <td className="py-2 pr-3">
                    {manage ? (
                      <select
                        className="rounded border border-gray-200 px-2 py-1 text-sm disabled:opacity-60"
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
                          className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-60"
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
                  <td className="py-4 text-gray-600" colSpan={3}>
                    No members found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invites */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-semibold text-gray-900">Pending invites</div>
          <div className="flex items-center gap-2">
            {pendingLabel}
            <Pill>{(invites ?? []).length} pending</Pill>
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-600">
              <tr className="border-b">
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Role</th>
                <th className="py-2 pr-3 font-medium">Actions</th>
              </tr>
            </thead>

            <tbody>
              {(invites ?? []).map((inv) => {
                const invitedAt = inv.invited_at ?? inv.created_at ?? null;

                return (
                  <tr key={inv.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-gray-900">{inv.email}</div>
                      {invitedAt ? (
                        <div className="text-xs text-gray-600">Invited: {fmtUtc(invitedAt)}</div>
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
                            className="rounded border border-gray-200 px-2 py-1 text-sm hover:bg-gray-50 disabled:opacity-60"
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
                );
              })}

              {(invites ?? []).length === 0 ? (
                <tr>
                  <td className="py-4 text-gray-600" colSpan={3}>
                    No pending invites.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="mt-3 text-xs text-gray-600">
          “Resend invite” typically updates timestamps. “Revoke invite” deletes the invite row only.
        </div>
      </div>
    </div>
  );
}