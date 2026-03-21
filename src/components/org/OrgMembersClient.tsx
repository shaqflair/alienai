// src/components/org/OrgMembersClient.tsx
"use client";

import React, { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import JobTitleCombobox from "@/components/org/JobTitleCombobox";

type OrgRole = "owner" | "admin" | "member";

type MemberRow = {
  user_id:         string;
  role:            OrgRole;
  full_name?:      string | null;
  email?:          string | null;
  avatar_url?:     string | null;
  job_title?:      string | null;
  line_manager_id?: string | null;
  joined_at?:      string | null;
  isMe?:           boolean;
};

type InviteStatus = "pending" | "accepted" | "revoked";

type InviteRow = {
  id:          string;
  email:       string | null;
  role:        "admin" | "member";
  status:      InviteStatus;
  created_at?: string | null;
  token?:      string | null;
};

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
function safeText(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}
function displayName(m: MemberRow) {
  return safeText(m.full_name) || safeText(m.email) || safeText(m.user_id) || "Unknown member";
}
function displayEmail(m: MemberRow) { return safeText(m.email); }
function fmtDate(iso?: string | null) {
  const s = safeText(iso);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
function roleRank(r: OrgRole) { return r === "owner" ? 0 : r === "admin" ? 1 : 2; }
function isEmailLike(v: string) { const s = String(v ?? "").trim(); return s.includes("@") && s.includes("."); }
function inviteStatusTone(s: InviteStatus): "default" | "success" | "warn" | "muted" {
  return s === "accepted" ? "success" : s === "pending" ? "warn" : "muted";
}

/* ------------------------------------------------------------------ */
/* Shared UI primitives                                                 */
/* ------------------------------------------------------------------ */
function Pill({ children, tone = "default" }: { children: React.ReactNode; tone?: "default"|"success"|"warn"|"muted" }) {
  const cls = tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : tone === "warn"    ? "border-amber-200 bg-amber-50 text-amber-700"
    : tone === "muted"   ? "border-gray-200 bg-gray-50 text-gray-500"
    : "border-gray-200 bg-white text-gray-700";
  return <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-xs " + cls}>{children}</span>;
}

function ConfirmInline({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  if (!armed) return (
    <button className="rounded border px-2 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      type="button" disabled={disabled} onClick={() => setArmed(true)}>{label}</button>
  );
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-sm text-red-600">Are you sure?</span>
      <button className="rounded border border-red-300 px-2 py-1 text-sm hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        type="button" disabled={disabled} onClick={onConfirm}>Confirm</button>
      <button className="rounded border px-2 py-1 text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        type="button" disabled={disabled} onClick={() => setArmed(false)}>Cancel</button>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Edit Modal                                                           */
/* ------------------------------------------------------------------ */
type EditForm = {
  full_name:       string;
  job_title:       string;
  line_manager_id: string;
};

function EditModal({
  member, allMembers, organisationId, onClose, onSaved,
}: {
  member:         MemberRow;
  allMembers:     MemberRow[];
  organisationId: string;
  onClose:        () => void;
  onSaved:        (patch: EditForm) => void;
}) {
  const [form, setForm] = useState<EditForm>({
    full_name:       safeText(member.full_name),
    job_title:       safeText(member.job_title),
    line_manager_id: safeText(member.line_manager_id),
  });
  const [saving, startSave] = useTransition();
  const [error, setError]   = useState("");

  const managers = allMembers.filter(m => m.user_id !== member.user_id);

  function save() {
    if (!form.full_name.trim()) { setError("Name is required"); return; }
    setError("");
    startSave(async () => {
      try {
        const res = await fetch("/api/member-profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id:         member.user_id,
            full_name:       form.full_name.trim(),
            job_title:       form.job_title.trim() || null,
            line_manager_id: form.line_manager_id || null,
          }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || !j?.ok) { setError(j?.error || "Save failed"); return; }
        onSaved(form);
      } catch (e: any) {
        setError(e?.message || "Unexpected error");
      }
    });
  }

  const inp = "w-full rounded border bg-white px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-cyan-500";
  const lbl = "block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1";

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:9999, background:"rgba(15,23,42,0.45)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ background:"white", borderRadius:16, width:"100%", maxWidth:460, boxShadow:"0 24px 64px rgba(0,0,0,0.18)", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ padding:"18px 22px 14px", borderBottom:"1.5px solid #f1f5f9", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:"#0f172a" }}>Edit member</div>
            <div style={{ fontSize:12, color:"#94a3b8", marginTop:2 }}>{safeText(member.email)}</div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", fontSize:18, color:"#94a3b8", lineHeight:1, padding:4 }}>x</button>
        </div>

        {/* Body */}
        <div style={{ padding:"18px 22px", display:"grid", gap:16 }}>

          <div>
            <label className={lbl}>Full name *</label>
            <input className={inp} value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="e.g. Jane Smith" />
          </div>

          {/* ── Job title: combobox from rate card ── */}
          <div>
            <label className={lbl}>Job title</label>
            <JobTitleCombobox
              orgId={organisationId}
              value={form.job_title}
              onChange={val => setForm(f => ({ ...f, job_title: val }))}
              disabled={saving}
              placeholder="e.g. Senior Delivery Manager"
            />
          </div>

          <div>
            <label className={lbl}>Line manager</label>
            <select className={inp + " cursor-pointer"} value={form.line_manager_id}
              onChange={e => setForm(f => ({ ...f, line_manager_id: e.target.value }))}>
              <option value="">-- None --</option>
              {managers.map(m => (
                <option key={m.user_id} value={m.user_id}>
                  {displayName(m)}{m.job_title ? " (" + m.job_title + ")" : ""}
                </option>
              ))}
            </select>
            <div style={{ fontSize:11, color:"#94a3b8", marginTop:4 }}>
              Select who this person reports to within the organisation.
            </div>
          </div>

          {error && (
            <div style={{ padding:"9px 12px", borderRadius:8, background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", color:"#dc2626", fontSize:13 }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"12px 22px 18px", borderTop:"1.5px solid #f1f5f9", display:"flex", justifyContent:"flex-end", gap:10 }}>
          <button onClick={onClose}
            style={{ padding:"8px 16px", borderRadius:8, fontSize:13, fontWeight:600, border:"1.5px solid #e2e8f0", background:"white", cursor:"pointer", color:"#475569" }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            style={{ padding:"8px 18px", borderRadius:8, fontSize:13, fontWeight:700, border:"none", cursor: saving ? "wait" : "pointer", background: saving ? "#94a3b8" : "#0e7490", color:"white" }}>
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                       */
/* ------------------------------------------------------------------ */
export default function OrgMembersClient(props: {
  organisationId: string;
  myRole:         OrgRole;
  members:        MemberRow[];
  invites:        InviteRow[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr]               = useState("");
  const [showInviteHistory, setShowInviteHistory] = useState(false);
  const [members, setMembers]       = useState<MemberRow[]>(props.members);
  const [editing, setEditing]       = useState<MemberRow | null>(null);
  const [savedId, setSavedId]       = useState<string | null>(null);

  const manage = props.myRole === "admin" || props.myRole === "owner";

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const byRole = roleRank(a.role) - roleRank(b.role);
      if (byRole !== 0) return byRole;
      return displayName(a).localeCompare(displayName(b));
    });
  }, [members]);

  const owner = useMemo(() => sortedMembers.find(m => m.role === "owner") ?? null, [sortedMembers]);

  const pendingInvites    = useMemo(() => (props.invites ?? []).filter(i => i.status === "pending"),    [props.invites]);
  const historicalInvites = useMemo(() => (props.invites ?? []).filter(i => i.status !== "pending"),   [props.invites]);
  const visibleInvites    = showInviteHistory ? [...pendingInvites, ...historicalInvites] : pendingInvites;

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole]   = useState<"member"|"admin">("member");

  const managerMap = useMemo(() => Object.fromEntries(members.map(m => [m.user_id, displayName(m)])), [members]);

  async function readJsonSafe(r: Response) { return r.json().catch(() => ({})); }
  async function apiPost(url: string, body: any)  { const r = await fetch(url, { method:"POST",  headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) }); const j = await readJsonSafe(r); if (!r.ok || !j?.ok) throw new Error(j?.error || "Request failed"); return j; }
  async function apiPatch(url: string, body: any) { const r = await fetch(url, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) }); const j = await readJsonSafe(r); if (!r.ok || !j?.ok) throw new Error(j?.error || "Request failed"); return j; }
  async function apiDelete(url: string)           { const r = await fetch(url, { method:"DELETE" }); const j = await readJsonSafe(r); if (!r.ok || !j?.ok) throw new Error(j?.error || "Request failed"); return j; }

  function invitePath(token?: string | null) { if (!token) return ""; return "/organisations/invite/" + encodeURIComponent(token); }
  async function copyInvite(token?: string | null) {
    const path = invitePath(token);
    if (!path || typeof window === "undefined") return;
    try { await navigator.clipboard.writeText(window.location.origin + path); }
    catch { setErr("Could not copy invite link."); }
  }

  function handleEdited(patch: EditForm) {
    if (!editing) return;
    setMembers(prev => prev.map(m =>
      m.user_id === editing.user_id
        ? { ...m, full_name: patch.full_name, job_title: patch.job_title, line_manager_id: patch.line_manager_id || null }
        : m
    ));
    setSavedId(editing.user_id);
    setTimeout(() => setSavedId(null), 3000);
    setEditing(null);
  }

  return (
    <div className="space-y-8 text-gray-900">

      {editing && (
        <EditModal
          member={editing}
          allMembers={members}
          organisationId={props.organisationId}
          onClose={() => setEditing(null)}
          onSaved={handleEdited}
        />
      )}

      {err ? <div className="rounded border bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

      {/* Single-owner notice */}
      <div className="rounded border bg-white p-4 text-sm text-gray-700">
        <div className="mb-1 font-medium">Single-owner governance</div>
        <div className="text-xs text-gray-500">
          The <b>owner</b> cannot be removed or demoted here. Ownership transfer happens in{" "}
          <b>Organisation settings &rarr; Governance</b>.
        </div>
        {owner && (
          <div className="mt-2 text-sm">
            <span className="text-gray-500">Current owner:</span>{" "}
            <span className="font-medium">{displayName(owner)}</span>
          </div>
        )}
      </div>

      {/* Invite */}
      {manage ? (
        <div className="space-y-3 rounded border bg-white p-4">
          <div className="font-medium">Invite member</div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <div className="text-xs text-gray-500">Email</div>
              <input className="w-[280px] rounded border bg-white px-3 py-2 text-gray-900 placeholder:text-gray-400"
                value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                placeholder="name@company.com" disabled={pending} />
            </div>
            <div className="space-y-1">
              <div className="text-xs text-gray-500">Role</div>
              <select className="rounded border bg-white px-3 py-2 text-gray-900"
                value={inviteRole} onChange={e => setInviteRole(e.target.value as "member"|"admin")} disabled={pending}>
                <option value="member">member</option>
                <option value="admin">admin</option>
              </select>
            </div>
            <button type="button"
              className="rounded border px-3 py-2 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={pending || !inviteEmail.trim() || !isEmailLike(inviteEmail)}
              onClick={() => {
                setErr("");
                startTransition(async () => {
                  try {
                    await apiPost("/api/organisation-invites", { organisation_id: props.organisationId, email: inviteEmail.trim(), role: inviteRole });
                    setInviteEmail(""); setInviteRole("member");
                    router.refresh();
                  } catch (e: any) { setErr(e?.message || "Invite failed"); }
                });
              }}>Invite</button>
          </div>
          <div className="text-xs text-gray-500">Invites produce a shareable link. Email sending can come later.</div>
        </div>
      ) : (
        <div className="rounded border bg-white p-4 text-sm text-gray-600">
          You can view members. Only <b>owners/admins</b> can invite, remove, or change roles.
        </div>
      )}

      {/* Members table */}
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
                <th className="py-2 pr-3">Job title</th>
                <th className="py-2 pr-3">Line manager</th>
                <th className="py-2 pr-3">Role</th>
                <th className="py-2 pr-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedMembers.map(m => {
                const isOwner = m.role === "owner";
                const name    = displayName(m);
                const email   = displayEmail(m);
                const joined  = fmtDate(m.joined_at);
                const lmName  = m.line_manager_id ? (managerMap[m.line_manager_id] ?? "Unknown") : null;
                const justSaved = savedId === m.user_id;

                return (
                  <tr key={m.user_id} className="border-b last:border-b-0" style={{ background: justSaved ? "rgba(14,116,144,0.04)" : "white", transition:"background 0.3s" }}>
                    <td className="py-2 pr-3">
                      <div className="font-medium">
                        {name}
                        {m.isMe ? <span className="ml-2 text-xs text-gray-500">(You)</span> : null}
                        {justSaved ? <span className="ml-2 text-xs font-semibold text-emerald-600">Saved ✓</span> : null}
                      </div>
                      {email  ? <div className="text-xs text-gray-500">{email}</div>   : null}
                      {!email ? <div className="text-xs text-gray-400">{m.user_id}</div> : null}
                      {joined ? <div className="text-xs text-gray-400">Joined {joined}</div> : null}
                    </td>

                    <td className="py-2 pr-3">
                      <span className="text-xs text-gray-600">{safeText(m.job_title) || "--"}</span>
                    </td>

                    <td className="py-2 pr-3">
                      <span className="text-xs text-gray-600">{lmName || "--"}</span>
                    </td>

                    <td className="py-2 pr-3">
                      {manage && !isOwner ? (
                        <select className="rounded border bg-white px-2 py-1 text-gray-900" value={m.role} disabled={pending}
                          onChange={e => {
                            const nextRole = e.target.value as "member"|"admin";
                            setErr("");
                            startTransition(async () => {
                              try {
                                await apiPatch("/api/organisation-members", { organisation_id: props.organisationId, user_id: m.user_id, role: nextRole });
                                router.refresh();
                              } catch (e: any) { setErr(e?.message || "Role update failed"); }
                            });
                          }}>
                          <option value="member">member</option>
                          <option value="admin">admin</option>
                        </select>
                      ) : (
                        <Pill>{m.role}</Pill>
                      )}
                    </td>

                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-2">
                        {manage && (
                          <button
                            onClick={() => setEditing(m)}
                            style={{ padding:"4px 12px", borderRadius:6, fontSize:12, fontWeight:600, border:"1.5px solid #e2e8f0", background:"white", cursor:"pointer", color:"#0e7490" }}
                            onMouseEnter={e => (e.currentTarget.style.borderColor = "#0e7490")}
                            onMouseLeave={e => (e.currentTarget.style.borderColor = "#e2e8f0")}
                          >Edit</button>
                        )}
                        {manage && !isOwner && (
                          <ConfirmInline label="Remove" disabled={pending}
                            onConfirm={() => {
                              setErr("");
                              startTransition(async () => {
                                try {
                                  await apiDelete("/api/organisation-members?organisationId=" + encodeURIComponent(props.organisationId) + "&userId=" + encodeURIComponent(m.user_id));
                                  router.refresh();
                                } catch (e: any) { setErr(e?.message || "Remove failed"); }
                              });
                            }} />
                        )}
                        {!manage && <span className="text-xs text-gray-400">--</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedMembers.length === 0 && (
                <tr><td className="py-4 text-gray-500" colSpan={5}>No members found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invites */}
      <div className="rounded border bg-white p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="font-medium">Invites</div>
          <div className="flex items-center gap-2">
            <Pill tone="warn">{pendingInvites.length} pending</Pill>
            {historicalInvites.length > 0 && (
              <button type="button" className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                onClick={() => setShowInviteHistory(v => !v)}>
                {showInviteHistory ? "Hide history" : "Show history (" + historicalInvites.length + ")"}
              </button>
            )}
          </div>
        </div>
        <div className="mb-3 text-xs text-gray-500">
          Accepted invites appear in <b>Organisation members</b>. This table manages pending invites.
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
              {visibleInvites.map(inv => {
                const path  = invitePath(inv.token);
                const imail = safeText(inv.email);
                const created = fmtDate(inv.created_at);
                return (
                  <tr key={inv.id} className="border-b last:border-b-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{imail || "--"}</div>
                      {created && <div className="text-xs text-gray-500">{created}</div>}
                    </td>
                    <td className="py-2 pr-3"><Pill>{inv.role}</Pill></td>
                    <td className="py-2 pr-3"><Pill tone={inviteStatusTone(inv.status)}>{inv.status}</Pill></td>
                    <td className="py-2 pr-3">
                      {inv.token && inv.status === "pending" ? (
                        <div className="flex items-center gap-2">
                          <input readOnly className="w-[300px] rounded border bg-white px-2 py-1 text-xs text-gray-900" value={path} />
                          <button type="button" className="rounded border px-2 py-1 text-sm hover:bg-gray-50"
                            onClick={() => copyInvite(inv.token)}>Copy</button>
                        </div>
                      ) : <span className="text-xs text-gray-400">--</span>}
                    </td>
                    <td className="py-2 pr-3">
                      {manage && inv.status === "pending" ? (
                        <ConfirmInline label="Revoke" disabled={pending}
                          onConfirm={() => {
                            setErr("");
                            startTransition(async () => {
                              try { await apiPatch("/api/organisation-invites", { id: inv.id, status: "revoked" }); router.refresh(); }
                              catch (e: any) { setErr(e?.message || "Revoke failed"); }
                            });
                          }} />
                      ) : <span className="text-xs text-gray-400">--</span>}
                    </td>
                  </tr>
                );
              })}
              {visibleInvites.length === 0 && (
                <tr><td className="py-4 text-gray-500" colSpan={5}>{showInviteHistory ? "No invites." : "No pending invites."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}