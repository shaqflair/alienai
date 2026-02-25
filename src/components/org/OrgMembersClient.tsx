// src/components/org/OrgMembersClient.tsx
"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

type OrgRole = "owner" | "admin" | "member";

type MemberRow = {
  user_id: string;
  role: OrgRole;
  full_name?: string | null;
  email?: string | null;
};

type InviteRow = {
  id: string;
  email: string;
  role: "admin" | "member";
  status: "pending" | "accepted" | "revoked";
  created_at?: string | null;
  token?: string | null; // for copy link
};

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
        className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
        type="button"
        disabled={disabled}
        onClick={() => setArmed(true)}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-sm text-red-600">Are you sure?</span>
      <button
        className="rounded border border-red-300 px-2 py-1 text-sm hover:bg-red-50"
        type="button"
        disabled={disabled}
        onClick={onConfirm}
      >
        Confirm
      </button>
      <button
        className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
        type="button"
        disabled={disabled}
        onClick={() => setArmed(false)}
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

function roleRank(r: OrgRole) {
  return r === "owner" ? 0 : r === "admin" ? 1 : 2;
}

export default function OrgMembersClient(props: {
  organisationId: string;
  myRole: OrgRole;
  members: MemberRow[];
  invites: InviteRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState("");

  const manage = props.myRole === "admin" || props.myRole === "owner";

  const sortedMembers = useMemo(() => {
    return [...(props.members ?? [])].sort((a, b) => roleRank(a.role) - roleRank(b.role));
  }, [props.members]);

  const owner = useMemo(() => sortedMembers.find((m) => m.role === "owner") ?? null, [sortedMembers]);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");

  async function apiPost(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) throw new Error(j?.error || "Request failed");
    return j;
  }

  async function apiPatch(url: string, body: any) {
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) throw new Error(j?.error || "Request failed");
    return j;
  }

  async function apiDelete(url: string) {
    const r = await fetch(url, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) throw new Error(j?.error || "Request failed");
    return j;
  }

  function invitePath(token?: string | null) {
    if (!token) return "";
    return `/organisations/invite/${encodeURIComponent(token)}`;
  }

  async function copyInvite(token?: string | null) {
    const p = invitePath(token);
    if (!p) return;
    const absolute = `${window.location.origin}${p}`;
    try {
      await navigator.clipboard.writeText(absolute);
    } catch {
      // ignore
    }
  }

  return (
    <div className="space-y-8 text-gray-900">
      {err ? <div className="rounded border bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

      {/* Governance hint */}
      <div className="rounded border bg-white p-4 text-sm text-gray-700">
        <div className="font-medium mb-1">Single-owner governance</div>
        <div className="text-xs text-gray-500">
          The <b>owner</b> cannot be removed or demoted here. Ownership transfer happens in{" "}
          <b>Organisation settings → Governance</b>.
        </div>
        {owner ? (
          <div className="mt-2 text-sm">
            <span className="text-gray-500">Current owner:</span>{" "}
            <span className="font-medium">{owner.full_name || owner.email || owner.user_id}</span>
          </div>
        ) : null}
      </div>

      {/* Invite */}
      {manage ? (
        <div className="space-y-3 rounded border bg-white p-4">
          <div className="font-medium">Invite member</div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs text-gray-500">Email</div>
              <input
                className="w-[280px] rounded border bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@company.com"
                disabled={pending}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs text-gray-500">Role</div>
              <select
                className="rounded border bg-white px-3 py-2 text-gray-900"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "member" | "admin")}
                disabled={pending}
              >
                <option value="member">member</option>
                <option value="admin">admin</option>
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
                    await apiPost("/api/organisation-invites", {
                      organisation_id: props.organisationId,
                      email: inviteEmail.trim(),
                      role: inviteRole,
                    });
                    setInviteEmail("");
                    router.refresh();
                  } catch (e: any) {
                    setErr(e?.message || "Invite failed");
                  }
                });
              }}
            >
              Invite
            </button>
          </div>

          <div className="text-xs text-gray-500">Invites produce a shareable link. Email sending can come later.</div>
        </div>
      ) : (
        <div className="rounded border bg-white p-4 text-sm text-gray-600">
          You can view members. Only <b>owners/admins</b> can invite/remove/change roles.
        </div>
      )}

      {/* Members */}
      <div className="rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-medium">Organisation members</div>
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
              {sortedMembers.map((m) => {
                const isOwner = m.role === "owner";

                return (
                  <tr key={m.user_id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{m.full_name || m.email || m.user_id}</div>
                      {m.email ? <div className="text-xs text-gray-500">{m.email}</div> : null}
                    </td>

                    <td className="py-2 pr-3">
                      {manage && !isOwner ? (
                        <select
                          className="rounded border bg-white px-2 py-1 text-gray-900"
                          value={m.role}
                          disabled={pending}
                          onChange={(e) => {
                            const nextRole = e.target.value as "member" | "admin";

                            setErr("");
                            startTransition(async () => {
                              try {
                                await apiPatch("/api/organisation-members", {
                                  organisation_id: props.organisationId,
                                  user_id: m.user_id,
                                  role: nextRole,
                                });
                                router.refresh();
                              } catch (e: any) {
                                setErr(e?.message || "Role update failed");
                              }
                            });
                          }}
                        >
                          {/* owner is intentionally NOT available here */}
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      ) : (
                        <Pill>{m.role}</Pill>
                      )}
                    </td>

                    <td className="py-2 pr-3">
                      {manage && !isOwner ? (
                        <ConfirmInline
                          label="Remove"
                          disabled={pending}
                          onConfirm={() => {
                            setErr("");
                            startTransition(async () => {
                              try {
                                // Backend should soft-remove (removed_at = now()).
                                await apiDelete(
                                  `/api/organisation-members?organisationId=${encodeURIComponent(
                                    props.organisationId
                                  )}&userId=${encodeURIComponent(m.user_id)}`
                                );
                                router.refresh();
                              } catch (e: any) {
                                setErr(e?.message || "Remove failed");
                              }
                            });
                          }}
                        />
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}

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
          <div className="font-medium">Invites</div>
          <Pill>{(props.invites ?? []).filter((i) => i.status === "pending").length} pending</Pill>
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr className="border-b">
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Link</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {(props.invites ?? []).map((inv) => (
                <tr key={inv.id} className="border-b last:border-b-0">
                  <td className="py-2 pr-3">
                    <div className="font-medium">{inv.email}</div>
                    <div className="text-xs text-gray-500">{inv.status}</div>
                  </td>

                  <td className="py-2 pr-3">
                    <Pill>{inv.role}</Pill>
                  </td>

                  <td className="py-2 pr-3">
                    {inv.token ? (
                      <div className="flex items-center gap-2">
                        <input
                          readOnly
                          className="w-[320px] rounded border bg-white px-2 py-1 text-xs text-gray-900"
                          value={`${typeof window !== "undefined" ? window.location.origin : ""}${invitePath(inv.token)}`}
                        />
                        <button
                          type="button"
                          className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                          onClick={() => copyInvite(inv.token)}
                        >
                          Copy
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>

                  <td className="py-2 pr-3">
                    {manage ? (
                      <ConfirmInline
                        label="Revoke"
                        disabled={pending || inv.status !== "pending"}
                        onConfirm={() => {
                          setErr("");
                          startTransition(async () => {
                            try {
                              await apiPatch("/api/organisation-invites", {
                                id: inv.id,
                                status: "revoked",
                              });
                              router.refresh();
                            } catch (e: any) {
                              setErr(e?.message || "Revoke failed");
                            }
                          });
                        }}
                      />
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              ))}

              {(props.invites ?? []).length === 0 ? (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={4}>
                    No invites.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}