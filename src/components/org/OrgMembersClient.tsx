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
  avatar_url?: string | null;
  joined_at?: string | null;
  isMe?: boolean;
};

type InviteStatus = "pending" | "accepted" | "revoked";

type InviteRow = {
  id: string;
  email: string | null;
  role: "admin" | "member";
  status: InviteStatus;
  created_at?: string | null;
  token?: string | null;
};

function safeText(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}

function displayName(m: MemberRow) {
  return safeText(m.full_name) || safeText(m.email) || safeText(m.user_id) || "Unknown member";
}

function displayEmail(m: MemberRow) {
  return safeText(m.email);
}

function fmtDate(iso?: string | null) {
  const s = safeText(iso);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Pill({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "success" | "warn" | "muted";
}) {
  const cls =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : tone === "warn"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : tone === "muted"
      ? "border-gray-200 bg-gray-50 text-gray-500"
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
        className="rounded border px-2 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
        className="rounded border border-red-300 px-2 py-1 text-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        type="button"
        disabled={disabled}
        onClick={onConfirm}
      >
        Confirm
      </button>
      <button
        className="rounded border px-2 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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

function inviteStatusTone(status: InviteStatus): "default" | "success" | "warn" | "muted" {
  if (status === "accepted") return "success";
  if (status === "pending") return "warn";
  return "muted";
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
  const [showInviteHistory, setShowInviteHistory] = useState(false);

  const manage = props.myRole === "admin" || props.myRole === "owner";

  const sortedMembers = useMemo(() => {
    return [...(props.members ?? [])].sort((a, b) => {
      const byRole = roleRank(a.role) - roleRank(b.role);
      if (byRole !== 0) return byRole;
      return displayName(a).localeCompare(displayName(b));
    });
  }, [props.members]);

  const owner = useMemo(
    () => sortedMembers.find((m) => m.role === "owner") ?? null,
    [sortedMembers]
  );

  const pendingInvites = useMemo(() => {
    return (props.invites ?? []).filter((i) => i.status === "pending");
  }, [props.invites]);

  const historicalInvites = useMemo(() => {
    return (props.invites ?? []).filter((i) => i.status !== "pending");
  }, [props.invites]);

  const visibleInvites = showInviteHistory
    ? [...pendingInvites, ...historicalInvites]
    : pendingInvites;

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");

  async function readJsonSafe(r: Response) {
    return r.json().catch(() => ({}));
  }

  async function apiPost(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const j = await readJsonSafe(r);
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Request failed");
    return j;
  }

  async function apiPatch(url: string, body: any) {
    const r = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const j = await readJsonSafe(r);
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Request failed");
    return j;
  }

  async function apiDelete(url: string) {
    const r = await fetch(url, { method: "DELETE" });
    const j = await readJsonSafe(r);
    if (!r.ok || !j?.ok) throw new Error(j?.error || "Request failed");
    return j;
  }

  function invitePath(token?: string | null) {
    if (!token) return "";
    return `/organisations/invite/${encodeURIComponent(token)}`;
  }

  async function copyInvite(token?: string | null) {
    const p = invitePath(token);
    if (!p || typeof window === "undefined") return;

    const absolute = `${window.location.origin}${p}`;
    try {
      await navigator.clipboard.writeText(absolute);
    } catch {
      setErr("Could not copy invite link.");
    }
  }

  return (
    <div className="space-y-8 text-gray-900">
      {err ? <div className="rounded border bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

      <div className="rounded border bg-white p-4 text-sm text-gray-700">
        <div className="mb-1 font-medium">Single-owner governance</div>
        <div className="text-xs text-gray-500">
          The <b>owner</b> cannot be removed or demoted here. Ownership transfer happens in{" "}
          <b>Organisation settings → Governance</b>.
        </div>
        {owner ? (
          <div className="mt-2 text-sm">
            <span className="text-gray-500">Current owner:</span>{" "}
            <span className="font-medium">{displayName(owner)}</span>
          </div>
        ) : null}
      </div>

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
              className="rounded border px-3 py-2 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
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
                    setInviteRole("member");
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

          <div className="text-xs text-gray-500">
            Invites produce a shareable link. Email sending can come later.
          </div>
        </div>
      ) : (
        <div className="rounded border bg-white p-4 text-sm text-gray-600">
          You can view members. Only <b>owners/admins</b> can invite, remove, or change roles.
        </div>
      )}

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
                const name = displayName(m);
                const email = displayEmail(m);
                const joined = fmtDate(m.joined_at);

                return (
                  <tr key={m.user_id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">
                        {name}
                        {m.isMe ? <span className="ml-2 text-xs text-gray-500">(You)</span> : null}
                      </div>
                      {email ? <div className="text-xs text-gray-500">{email}</div> : null}
                      {!email ? <div className="text-xs text-gray-400">{m.user_id}</div> : null}
                      {joined ? <div className="text-xs text-gray-400">Joined {joined}</div> : null}
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

      <div className="rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-medium">Invites</div>
          <div className="flex items-center gap-2">
            <Pill tone="warn">{pendingInvites.length} pending</Pill>
            {historicalInvites.length > 0 ? (
              <button
                type="button"
                className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                onClick={() => setShowInviteHistory((v) => !v)}
              >
                {showInviteHistory ? "Hide history" : `Show history (${historicalInvites.length})`}
              </button>
            ) : null}
          </div>
        </div>

        <div className="mb-3 text-xs text-gray-500">
          Accepted invites should appear in <b>Organisation members</b>. The table below is focused on pending invite management.
        </div>

        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-500">
              <tr className="border-b">
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Link</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>

            <tbody>
              {visibleInvites.map((inv) => {
                const path = invitePath(inv.token);
                const inviteEmailValue = safeText(inv.email);
                const created = fmtDate(inv.created_at);

                return (
                  <tr key={inv.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{inviteEmailValue || "—"}</div>
                      {created ? <div className="text-xs text-gray-500">{created}</div> : null}
                    </td>

                    <td className="py-2 pr-3">
                      <Pill>{inv.role}</Pill>
                    </td>

                    <td className="py-2 pr-3">
                      <Pill tone={inviteStatusTone(inv.status)}>{inv.status}</Pill>
                    </td>

                    <td className="py-2 pr-3">
                      {inv.token && inv.status === "pending" ? (
                        <div className="flex items-center gap-2">
                          <input
                            readOnly
                            className="w-[320px] rounded border bg-white px-2 py-1 text-xs text-gray-900"
                            value={path}
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
                      {manage && inv.status === "pending" ? (
                        <ConfirmInline
                          label="Revoke"
                          disabled={pending}
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
                );
              })}

              {visibleInvites.length === 0 ? (
                <tr>
                  <td className="py-4 text-gray-500" colSpan={5}>
                    {showInviteHistory ? "No invites." : "No pending invites."}
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