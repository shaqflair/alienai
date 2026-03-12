"use client";

import { useMemo, useState, useTransition } from "react";
import type { MemberRow } from "../page";

function fmtDate(iso: string | null) {
  if (!iso) return "--";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "2-digit",
  });
}

function safeText(value: string | null | undefined, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function memberDisplayName(member: MemberRow) {
  return (
    safeText(member.full_name) ||
    safeText(member.email) ||
    safeText(member.user_id) ||
    "Unknown member"
  );
}

function memberDisplayEmail(member: MemberRow) {
  return safeText(member.email, "");
}

function Avatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  const safeName = safeText(name, "Unknown");
  const initial = safeName[0]?.toUpperCase() ?? "?";
  const hue =
    Math.abs(
      safeName.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
    ) % 360;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={safeName}
        style={{
          width: 34,
          height: 34,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0,
          border: "1.5px solid #e2e8f0",
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: 34,
        height: 34,
        borderRadius: "50%",
        background: `hsl(${hue},55%,88%)`,
        color: `hsl(${hue},55%,35%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "13px",
        fontWeight: 800,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

const ROLE_STYLE = {
  owner: { bg: "rgba(124,58,237,0.1)", color: "#7c3aed", label: "Owner" },
  admin: { bg: "rgba(14,116,144,0.1)", color: "#0e7490", label: "Admin" },
  member: { bg: "rgba(100,116,139,0.1)", color: "#64748b", label: "Member" },
};

async function updateMemberRole(
  organisationId: string,
  userId: string,
  role: string
) {
  const res = await fetch("/api/organisation-members", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organisation_id: organisationId,
      user_id: userId,
      role,
    }),
  });
  return res.json();
}

async function removeMember(organisationId: string, userId: string) {
  const res = await fetch("/api/organisation-members", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      organisation_id: organisationId,
      user_id: userId,
    }),
  });
  return res.json();
}

export default function MembersClient({
  members: initial,
  isAdmin,
  organisationId,
}: {
  members: MemberRow[];
  myRole: "owner" | "admin" | "member";
  isAdmin: boolean;
  organisationId: string;
  myUserId: string;
}) {
  const [members, setMembers] = useState<MemberRow[]>(initial);
  const [filter, setFilter] = useState<"all" | "admin" | "member">("all");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();

    return members.filter((m) => {
      if (filter === "admin" && m.role !== "admin" && m.role !== "owner") {
        return false;
      }

      if (filter === "member" && (m.role === "admin" || m.role === "owner")) {
        return false;
      }

      if (q) {
        const name = memberDisplayName(m).toLowerCase();
        const email = memberDisplayEmail(m).toLowerCase();
        const userId = safeText(m.user_id).toLowerCase();

        if (
          !name.includes(q) &&
          !email.includes(q) &&
          !userId.includes(q)
        ) {
          return false;
        }
      }

      return true;
    });
  }, [members, filter, search]);

  function handleRoleChange(userId: string, newRole: "admin" | "member") {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const res = await updateMemberRole(organisationId, userId, newRole);
      if (!res.ok) {
        setError(res.error ?? "Failed to update role");
        return;
      }

      setMembers((ms) =>
        ms.map((m) => (m.user_id === userId ? { ...m, role: newRole } : m))
      );
      setSuccess("Role updated");
    });
  }

  function handleRemove(userId: string, name: string) {
    if (!confirm(`Remove ${name} from the organisation?`)) return;

    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const res = await removeMember(organisationId, userId);
      if (!res.ok) {
        setError(res.error ?? "Failed to remove member");
        return;
      }

      setMembers((ms) => ms.filter((m) => m.user_id !== userId));
      setSuccess(`${name} removed`);
    });
  }

  return (
    <div
      style={{
        padding: "32px 40px",
        maxWidth: "760px",
        fontFamily: "'DM Sans', sans-serif",
      }}
    >
      <div style={{ marginBottom: "24px" }}>
        <h1
          style={{
            fontSize: "18px",
            fontWeight: 900,
            color: "#0f172a",
            margin: "0 0 4px",
          }}
        >
          Members
        </h1>
        <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
          {members.length} member{members.length !== 1 ? "s" : ""} in this
          organisation
        </p>
      </div>

      {(success || error) && (
        <div
          style={{
            padding: "9px 14px",
            borderRadius: "8px",
            marginBottom: "14px",
            fontSize: "13px",
            fontWeight: 600,
            background: success
              ? "rgba(16,185,129,0.1)"
              : "rgba(239,68,68,0.08)",
            border: `1.5px solid ${
              success
                ? "rgba(16,185,129,0.2)"
                : "rgba(239,68,68,0.2)"
            }`,
            color: success ? "#059669" : "#dc2626",
          }}
        >
          {success || error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "14px",
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, or user ID..."
          style={{
            flex: 1,
            minWidth: "180px",
            padding: "7px 12px",
            borderRadius: "8px",
            border: "1.5px solid #e2e8f0",
            fontSize: "12px",
            outline: "none",
            color: "#0f172a",
          }}
        />
        {(["all", "admin", "member"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              padding: "7px 14px",
              borderRadius: "8px",
              border: "1.5px solid",
              cursor: "pointer",
              borderColor: filter === f ? "#0e7490" : "#e2e8f0",
              background:
                filter === f ? "rgba(14,116,144,0.08)" : "white",
              color: filter === f ? "#0e7490" : "#64748b",
              fontSize: "11px",
              fontWeight: 700,
              textTransform: "capitalize",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      <div
        style={{
          background: "white",
          borderRadius: "14px",
          border: "1.5px solid #e2e8f0",
          overflow: "hidden",
        }}
      >
        {visible.length === 0 ? (
          <div
            style={{
              padding: "48px 0",
              textAlign: "center",
              fontSize: "13px",
              color: "#94a3b8",
            }}
          >
            No members found
          </div>
        ) : (
          visible.map((m, i) => {
            const displayName = memberDisplayName(m);
            const displayEmail = memberDisplayEmail(m);
            const roleMeta = ROLE_STYLE[m.role] ?? ROLE_STYLE.member;
            const canManage = isAdmin && !m.isMe && m.role !== "owner";

            return (
              <div
                key={m.user_id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px 16px",
                  borderBottom:
                    i < visible.length - 1 ? "1px solid #f1f5f9" : "none",
                  opacity: isPending ? 0.7 : 1,
                }}
              >
                <Avatar name={displayName} avatarUrl={m.avatar_url} />

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#0f172a",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    {displayName}
                    {m.isMe && (
                      <span
                        style={{
                          fontSize: "9px",
                          background: "rgba(14,116,144,0.1)",
                          color: "#0e7490",
                          padding: "1px 5px",
                          borderRadius: "4px",
                        }}
                      >
                        You
                      </span>
                    )}
                  </div>

                  <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                    {displayEmail || safeText(m.user_id)}
                    {" · "}Joined {fmtDate(m.joined_at)}
                  </div>
                </div>

                {canManage ? (
                  <div style={{ display: "flex", gap: "8px" }}>
                    <select
                      value={m.role}
                      onChange={(e) =>
                        handleRoleChange(
                          m.user_id,
                          e.target.value as "admin" | "member"
                        )
                      }
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        padding: "4px 8px",
                        borderRadius: "6px",
                        border: "1.5px solid #e2e8f0",
                        cursor: "pointer",
                      }}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>

                    <button
                      onClick={() => handleRemove(m.user_id, displayName)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: "6px",
                        border: "1.5px solid #fecaca",
                        color: "#dc2626",
                        fontSize: "11px",
                        fontWeight: 600,
                        cursor: "pointer",
                        background: "white",
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <span
                    style={{
                      fontSize: "10px",
                      fontWeight: 800,
                      padding: "3px 8px",
                      borderRadius: "5px",
                      background: roleMeta.bg,
                      color: roleMeta.color,
                    }}
                  >
                    {roleMeta.label}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}