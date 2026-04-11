"use client";

import { useState, useTransition } from "react";
import type { MemberRow } from "../page";
import { updateMemberProfile } from "../_actions/updateMemberProfile";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
type Props = {
  members:        MemberRow[];
  myRole:          "owner" | "admin" | "member";
  isAdmin:        boolean;
  organisationId: string;
  myUserId:       string;
};

type EditState = {
  member:           MemberRow;
  full_name:        string;
  job_title:        string;
  line_manager_id: string;
  org_role:         "owner" | "admin" | "member";
};

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  owner:  { bg: "rgba(124,58,237,0.1)",  color: "#7c3aed" },
  admin:  { bg: "rgba(14,116,144,0.1)",  color: "#0e7490" },
  member: { bg: "rgba(100,116,139,0.08)", color: "#64748b" },
};

function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
  if (url) {
    return (
      <img src={url} alt={name} width={size} height={size}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "linear-gradient(135deg,#0e7490,#0891b2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "white", fontSize: size * 0.33, fontWeight: 700,
    }}>
      {initials || "?"}
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const s = ROLE_COLORS[role] ?? ROLE_COLORS.member;
  return (
    <span style={{
      fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 5,
      textTransform: "capitalize", background: s.bg, color: s.color,
    }}>{role}</span>
  );
}

/* ------------------------------------------------------------------ */
/* Edit Modal                                                           */
/* ------------------------------------------------------------------ */
function EditModal({
  state, members, onClose, onSave,
}: {
  state:   EditState;
  members: MemberRow[];
  onClose: () => void;
  onSave:  (patch: Omit<EditState, "member">) => void;
}) {
  const [form, setForm] = useState({
    full_name:       state.full_name,
    job_title:       state.job_title,
    line_manager_id: state.line_manager_id,
    org_role:        state.org_role,
  });
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const eligibleManagers = members.filter(m => m.user_id !== state.member.user_id);

  function handleSave() {
    if (!form.full_name.trim()) { setError("Name is required"); return; }
    setError(null);
    startTransition(async () => {
      const result = await updateMemberProfile({
        targetUserId:    state.member.user_id,
        full_name:       form.full_name,
        job_title:       form.job_title,
        line_manager_id: form.line_manager_id || null,
        org_role:        form.org_role,
      });
      if (!result.ok) { setError(result.error); return; }
      onSave(form);
    });
  }

  const inp: React.CSSProperties = {
    width: "100%", padding: "9px 12px", fontSize: 14,
    border: "1.5px solid #e2e8f0", borderRadius: 8,
    outline: "none", fontFamily: "inherit", color: "#0f172a",
    background: "white",
  };

  const label: React.CSSProperties = {
    display: "block", fontSize: 11, fontWeight: 700,
    color: "#64748b", marginBottom: 5, textTransform: "uppercase",
    letterSpacing: "0.05em",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(15,23,42,0.45)", backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: 20,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "white", borderRadius: 16, width: "100%", maxWidth: 480,
        boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: "1.5px solid #f1f5f9",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Avatar name={state.member.full_name} url={state.member.avatar_url} size={40} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a" }}>
                Edit member
              </div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>
                {state.member.email}
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: 20, color: "#94a3b8", lineHeight: 1, padding: 4,
          }}>&#x2715;</button>
        </div>

        {/* Form */}
        <div style={{ padding: "20px 24px", display: "grid", gap: 18 }}>

          {/* Full name */}
          <div>
            <label style={label}>Full name *</label>
            <input
              style={inp}
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="e.g. Jane Smith"
            />
          </div>

          {/* Job title */}
          <div>
            <label style={label}>Job title</label>
            <input
              style={inp}
              value={form.job_title}
              onChange={e => setForm(f => ({ ...f, job_title: e.target.value }))}
              placeholder="e.g. Senior Delivery Manager"
            />
          </div>

          {/* Line manager */}
          <div>
            <label style={label}>Line manager</label>
            <select
              style={{ ...inp, cursor: "pointer" }}
              value={form.line_manager_id}
              onChange={e => setForm(f => ({ ...f, line_manager_id: e.target.value }))}
            >
              <option value="">-- None --</option>
              {eligibleManagers.map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {m.full_name}{m.job_title ? ` (${m.job_title})` : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Org role */}
          <div>
            <label style={label}>Organisation role</label>
            <div style={{ display: "flex", gap: 8 }}>
              {(["member", "admin", "owner"] as const).map(r => {
                const s = ROLE_COLORS[r];
                const active = form.org_role === r;
                return (
                  <button
                    key={r}
                    onClick={() => setForm(f => ({ ...f, org_role: r }))}
                    style={{
                      flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 12,
                      fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
                      border: active ? `2px solid ${s.color}` : "2px solid #e2e8f0",
                      background: active ? s.bg : "transparent",
                      color: active ? s.color : "#94a3b8",
                      transition: "all 0.15s",
                    }}
                  >{r}</button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 6 }}>
              {form.org_role === "owner"  && "Full access. Can manage billing, members and all settings."}
              {form.org_role === "admin"  && "Can manage members, projects and organisation settings."}
              {form.org_role === "member" && "Standard access to projects and resources they are assigned to."}
            </div>
          </div>

          {/* Error */}
          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 8,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
              color: "#dc2626", fontSize: 13,
            }}>{error}</div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: "14px 24px 20px",
          borderTop: "1.5px solid #f1f5f9",
          display: "flex", justifyContent: "flex-end", gap: 10,
        }}>
          <button onClick={onClose} style={{
            padding: "9px 18px", borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: "1.5px solid #e2e8f0", background: "white", cursor: "pointer", color: "#475569",
          }}>Cancel</button>
          <button onClick={handleSave} disabled={pending} style={{
            padding: "9px 20px", borderRadius: 8, fontSize: 13, fontWeight: 700,
            border: "none", cursor: pending ? "wait" : "pointer",
            background: pending ? "#94a3b8" : "#0e7490",
            color: "white", transition: "background 0.15s",
          }}>
            {pending ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Client Component                                                 */
/* ------------------------------------------------------------------ */
export default function MembersClient({
  members: initialMembers,
  myRole, isAdmin, myUserId,
}: Props) {
  const [members, setMembers] = useState<MemberRow[]>(initialMembers);
  const [editing, setEditing]  = useState<EditState | null>(null);
  const [saved, setSaved]      = useState<string | null>(null);

  function openEdit(m: MemberRow) {
    setEditing({
      member:          m,
      full_name:       m.full_name,
      job_title:       m.job_title,
      line_manager_id: m.line_manager_id ?? "",
      org_role:         m.role,
    });
  }

  function handleSaved(patch: Omit<EditState, "member">) {
    if (!editing) return;
    setMembers(prev => prev.map(m =>
      m.user_id === editing.member.user_id
        ? { ...m, full_name: patch.full_name, job_title: patch.job_title, line_manager_id: patch.line_manager_id || null, role: patch.org_role }
        : m
    ));
    setSaved(editing.member.user_id);
    setTimeout(() => setSaved(null), 3000);
    setEditing(null);
  }

  const managerMap = Object.fromEntries(members.map(m => [m.user_id, m.full_name]));

  return (
    <>
      {editing && (
        <EditModal
          state={editing}
          members={members}
          onClose={() => setEditing(null)}
          onSave={handleSaved}
        />
      )}

      <div style={{ maxWidth: 760 }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0f172a", letterSpacing: "-0.3px", marginBottom: 4 }}>
            Members
          </h1>
          <p style={{ fontSize: 14, color: "#64748b" }}>
            {members.length} member{members.length !== 1 ? "s" : ""} in this organisation.
            {isAdmin && " Click Edit to update name, title, line manager or role."}
          </p>
        </div>

        {/* Table */}
        <div style={{
          border: "1.5px solid #e2e8f0", borderRadius: 14,
          overflow: "hidden", background: "white",
        }}>
          {/* Table header */}
          <div style={{
            display: "grid",
            gridTemplateColumns: isAdmin ? "1fr 160px 180px 90px 80px" : "1fr 160px 180px 90px",
            gap: 0, padding: "10px 20px",
            background: "#f8fafc", borderBottom: "1.5px solid #e2e8f0",
            fontSize: 10, fontWeight: 800, color: "#94a3b8",
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            <div>Member</div>
            <div>Job title</div>
            <div>Line manager</div>
            <div>Role</div>
            {isAdmin && <div />}
          </div>

          {/* Rows */}
          {members.map((m, i) => {
            const lmName = m.line_manager_id ? (managerMap[m.line_manager_id] ?? "?") : "?";
            const justSaved = saved === m.user_id;
            return (
              <div key={m.user_id} style={{
                display: "grid",
                gridTemplateColumns: isAdmin ? "1fr 160px 180px 90px 80px" : "1fr 160px 180px 90px",
                gap: 0, padding: "14px 20px",
                borderBottom: i < members.length - 1 ? "1px solid #f1f5f9" : "none",
                alignItems: "center",
                background: justSaved ? "rgba(14,116,144,0.04)" : "white",
                transition: "background 0.3s",
              }}>
                {/* Name + email */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                  <Avatar name={m.full_name} url={m.avatar_url} size={34} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {m.full_name}
                      </span>
                      {m.isMe && (
                        <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4, background: "rgba(14,116,144,0.1)", color: "#0e7490" }}>
                          You
                        </span>
                      )}
                      {justSaved && (
                        <span style={{ fontSize: 9, fontWeight: 800, padding: "1px 6px", borderRadius: 4, background: "rgba(34,197,94,0.1)", color: "#16a34a" }}>
                          Saved
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.email}
                    </div>
                  </div>
                </div>

                {/* Job title */}
                <div style={{ fontSize: 13, color: m.job_title ? "#475569" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {m.job_title || "?"}
                </div>

                {/* Line manager */}
                <div style={{ fontSize: 13, color: m.line_manager_id ? "#475569" : "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {lmName}
                </div>

                {/* Role badge */}
                <div><RoleBadge role={m.role} /></div>

                {/* Edit button ? admins only */}
                {isAdmin && (
                  <div>
                    <button
                      onClick={() => openEdit(m)}
                      style={{
                        padding: "5px 12px", borderRadius: 7, fontSize: 12, fontWeight: 600,
                        border: "1.5px solid #e2e8f0", background: "white", cursor: "pointer",
                        color: "#475569", transition: "all 0.15s",
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#0e7490"; (e.currentTarget as HTMLButtonElement).style.color = "#0e7490"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0"; (e.currentTarget as HTMLButtonElement).style.color = "#475569"; }}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Permission note for non-admins */}
        {!isAdmin && (
          <div style={{ marginTop: 16, fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6 }}>
            <span>&#x1F512;</span>
            Only admins and owners can edit member details.
          </div>
        )}
      </div>
    </>
  );
}
