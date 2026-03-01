"use client";
// FILE: src/app/people/invite/_components/InviteClient.tsx

import { useState, useTransition, useRef } from "react";
import { sendInviteAction, bulkInviteAction, revokeInviteAction } from "../actions";

/* =============================================================================
   TYPES
============================================================================= */
export type OrgInvite = {
  id:           string;
  email:        string;
  role:         "admin" | "member";
  status:       "pending" | "accepted" | "revoked" | "expired";
  created_at:   string;
  accepted_at:  string | null;
  expires_at:   string | null;
};

/* =============================================================================
   HELPERS
============================================================================= */
function fmtDate(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "2-digit",
  });
}

function isExpired(invite: OrgInvite): boolean {
  if (invite.status !== "pending") return false;
  if (!invite.expires_at) return false;
  return new Date(invite.expires_at).getTime() < Date.now();
}

function effectiveStatus(invite: OrgInvite): string {
  if (isExpired(invite)) return "expired";
  return invite.status;
}

const STATUS_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  pending:  { bg: "rgba(245,158,11,0.1)",  color: "#d97706", label: "Pending"  },
  accepted: { bg: "rgba(16,185,129,0.1)",  color: "#059669", label: "Accepted" },
  revoked:  { bg: "rgba(100,116,139,0.1)", color: "#64748b", label: "Revoked"  },
  expired:  { bg: "rgba(239,68,68,0.1)",   color: "#dc2626", label: "Expired"  },
};

/* =============================================================================
   AVATAR INITIALS
============================================================================= */
function Avatar({ email }: { email: string }) {
  const initial = email[0]?.toUpperCase() ?? "?";
  const hue     = Math.abs(email.split("").reduce((a, c) => a + c.charCodeAt(0), 0)) % 360;
  return (
    <div style={{
      width: 32, height: 32, borderRadius: "50%",
      background: `hsl(${hue},55%,88%)`,
      color: `hsl(${hue},55%,35%)`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "13px", fontWeight: 800, flexShrink: 0,
    }}>{initial}</div>
  );
}

/* =============================================================================
   INVITE ROW
============================================================================= */
function InviteRow({
  invite, organisationId, onRevoke, onResend,
}: {
  invite:         OrgInvite;
  organisationId: string;
  onRevoke:       (id: string) => void;
  onResend:       (email: string, role: "admin" | "member") => void;
}) {
  const status     = effectiveStatus(invite);
  const statusMeta = STATUS_STYLE[status] ?? STATUS_STYLE.pending;
  const isPending  = status === "pending";
  const isExp      = status === "expired";

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px",
      padding: "12px 16px",
      borderBottom: "1px solid #f1f5f9",
      background: "white",
      transition: "background 0.1s",
    }}>
      <Avatar email={invite.email} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: "13px", fontWeight: 700, color: "#0f172a",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{invite.email}</div>
        <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "1px" }}>
          Invited {fmtDate(invite.created_at)}
          {invite.expires_at && isPending && (
            <> &middot; Expires {fmtDate(invite.expires_at)}</>
          )}
          {invite.accepted_at && (
            <> &middot; Accepted {fmtDate(invite.accepted_at)}</>
          )}
        </div>
      </div>

      {/* Role badge */}
      <span style={{
        fontSize: "10px", fontWeight: 800, padding: "3px 8px",
        borderRadius: "5px", textTransform: "capitalize",
        background: invite.role === "admin" ? "rgba(124,58,237,0.1)" : "rgba(14,116,144,0.1)",
        color:      invite.role === "admin" ? "#7c3aed"              : "#0e7490",
      }}>{invite.role}</span>

      {/* Status badge */}
      <span style={{
        fontSize: "10px", fontWeight: 700, padding: "3px 8px",
        borderRadius: "5px",
        background: statusMeta.bg, color: statusMeta.color,
      }}>{statusMeta.label}</span>

      {/* Actions */}
      <div style={{ display: "flex", gap: "6px" }}>
        {(isPending || isExp) && (
          <button type="button"
            onClick={() => onResend(invite.email, invite.role)}
            style={{
              fontSize: "11px", fontWeight: 600,
              padding: "4px 10px", borderRadius: "6px",
              border: "1.5px solid #e2e8f0", background: "white",
              color: "#0e7490", cursor: "pointer",
            }}>
            Resend
          </button>
        )}
        {isPending && (
          <button type="button"
            onClick={() => onRevoke(invite.id)}
            style={{
              fontSize: "11px", fontWeight: 600,
              padding: "4px 10px", borderRadius: "6px",
              border: "1.5px solid #fecaca", background: "white",
              color: "#dc2626", cursor: "pointer",
            }}>
            Revoke
          </button>
        )}
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN CLIENT
============================================================================= */
export default function InviteClient({
  organisationId,
  initialInvites,
}: {
  organisationId:  string;
  initialInvites:  OrgInvite[];
}) {
  const [invites,    setInvites]    = useState<OrgInvite[]>(initialInvites);
  const [tab,        setTab]        = useState<"single" | "bulk">("single");
  const [email,      setEmail]      = useState("");
  const [bulkEmails, setBulkEmails] = useState("");
  const [role,       setRole]       = useState<"member" | "admin">("member");
  const [filterSt,   setFilterSt]   = useState<"all" | "pending" | "accepted" | "revoked">("all");
  const [error,      setError]      = useState<string | null>(null);
  const [success,    setSuccess]    = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<Array<{ email: string; ok: boolean; error?: string }> | null>(null);
  const [isPending,  startTransition] = useTransition();

  const pendingCount  = invites.filter(i => effectiveStatus(i) === "pending").length;
  const acceptedCount = invites.filter(i => i.status === "accepted").length;

  async function refreshInvites() {
    try {
      const res  = await fetch(`/api/organisation-invites?organisationId=${organisationId}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok) setInvites(json.items ?? []);
    } catch {}
  }

  function handleSingle(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null);
    const fd = new FormData();
    fd.set("organisation_id", organisationId);
    fd.set("email",  email.trim().toLowerCase());
    fd.set("role",   role);
    startTransition(async () => {
      try {
        await sendInviteAction(fd);
        setEmail("");
        setSuccess(`Invite sent to ${email.trim()}`);
        await refreshInvites();
      } catch (err: any) {
        setError(err?.message ?? "Failed to send invite");
      }
    });
  }

  function handleBulk(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setSuccess(null); setBulkResult(null);
    const fd = new FormData();
    fd.set("organisation_id", organisationId);
    fd.set("emails", bulkEmails);
    fd.set("role",   role);
    startTransition(async () => {
      try {
        const results = await bulkInviteAction(fd) as any;
        setBulkResult(results ?? []);
        const sent = (results ?? []).filter((r: any) => r.ok).length;
        if (sent > 0) setSuccess(`${sent} invite${sent !== 1 ? "s" : ""} sent`);
        setBulkEmails("");
        await refreshInvites();
      } catch (err: any) {
        setError(err?.message ?? "Failed to send invites");
      }
    });
  }

  function handleRevoke(inviteId: string) {
    setError(null); setSuccess(null);
    const fd = new FormData();
    fd.set("invite_id",       inviteId);
    fd.set("organisation_id", organisationId);
    startTransition(async () => {
      try {
        await revokeInviteAction(fd);
        setSuccess("Invite revoked");
        await refreshInvites();
      } catch (err: any) {
        setError(err?.message ?? "Failed to revoke");
      }
    });
  }

  function handleResend(emailAddr: string, inviteRole: "admin" | "member") {
    setError(null); setSuccess(null);
    const fd = new FormData();
    fd.set("organisation_id", organisationId);
    fd.set("email",  emailAddr);
    fd.set("role",   inviteRole);
    fd.set("resend", "true");
    startTransition(async () => {
      try {
        await sendInviteAction(fd);
        setSuccess(`Invite resent to ${emailAddr}`);
        await refreshInvites();
      } catch (err: any) {
        setError(err?.message ?? "Failed to resend");
      }
    });
  }

  const visibleInvites = invites.filter(i => {
    if (filterSt === "all") return true;
    return effectiveStatus(i) === filterSt;
  });

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        .inv-row:hover { background: #fafafa !important; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      <div style={{
        fontFamily: "'DM Sans', sans-serif",
        minHeight: "100vh", background: "#f8fafc", padding: "32px 24px",
      }}>
        <div style={{ maxWidth: "860px", margin: "0 auto" }}>

          {/* Header */}
          <div style={{ marginBottom: "24px" }}>
            <h1 style={{ fontSize: "22px", fontWeight: 900, color: "#0f172a",
                         margin: "0 0 4px", letterSpacing: "-0.3px" }}>
              Invite people
            </h1>
            <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
              {pendingCount} pending &middot; {acceptedCount} accepted
            </p>
          </div>

          {/* Feedback */}
          {success && (
            <div style={{
              padding: "10px 14px", borderRadius: "8px",
              background: "rgba(16,185,129,0.1)", border: "1.5px solid rgba(16,185,129,0.25)",
              color: "#059669", fontSize: "13px", fontWeight: 600,
              marginBottom: "16px", animation: "fadeIn 0.2s ease",
            }}>
              {success}
            </div>
          )}
          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: "8px",
              background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.25)",
              color: "#dc2626", fontSize: "13px", fontWeight: 600,
              marginBottom: "16px", animation: "fadeIn 0.2s ease",
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: "20px", alignItems: "start" }}>

            {/* ── Left: invite form ── */}
            <div style={{
              background: "white", borderRadius: "14px",
              border: "1.5px solid #e2e8f0",
              overflow: "hidden",
            }}>
              {/* Tab switcher */}
              <div style={{
                display: "flex", borderBottom: "1.5px solid #f1f5f9",
                padding: "4px 4px 0",
              }}>
                {(["single", "bulk"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setTab(t)} style={{
                    flex: 1, padding: "8px 0", border: "none", background: "none",
                    fontSize: "12px", fontWeight: 700, cursor: "pointer",
                    color: tab === t ? "#0e7490" : "#94a3b8",
                    borderBottom: tab === t ? "2px solid #0e7490" : "2px solid transparent",
                    marginBottom: "-1px", transition: "all 0.15s",
                    textTransform: "capitalize",
                  }}>{t === "single" ? "Single invite" : "Bulk invite"}</button>
                ))}
              </div>

              <div style={{ padding: "20px" }}>
                {/* Role selector */}
                <div style={{ marginBottom: "14px" }}>
                  <label style={{
                    fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                    textTransform: "uppercase", letterSpacing: "0.06em",
                    display: "block", marginBottom: "6px",
                  }}>Role</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    {(["member", "admin"] as const).map(r => (
                      <button key={r} type="button" onClick={() => setRole(r)} style={{
                        flex: 1, padding: "7px 0",
                        borderRadius: "8px", border: "1.5px solid",
                        borderColor: role === r
                          ? (r === "admin" ? "#7c3aed" : "#0e7490")
                          : "#e2e8f0",
                        background: role === r
                          ? (r === "admin" ? "rgba(124,58,237,0.08)" : "rgba(14,116,144,0.08)")
                          : "white",
                        color: role === r
                          ? (r === "admin" ? "#7c3aed" : "#0e7490")
                          : "#94a3b8",
                        fontSize: "12px", fontWeight: 700, cursor: "pointer",
                        textTransform: "capitalize",
                      }}>{r}</button>
                    ))}
                  </div>
                  <p style={{ fontSize: "11px", color: "#94a3b8", margin: "6px 0 0" }}>
                    {role === "admin"
                      ? "Admins can manage people, projects, and invite others."
                      : "Members can view and manage allocations and projects."}
                  </p>
                </div>

                {tab === "single" ? (
                  <form onSubmit={handleSingle}>
                    <label style={{
                      fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      display: "block", marginBottom: "6px",
                    }}>Email address</label>
                    <input
                      type="email" required
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      placeholder="colleague@company.com"
                      style={{
                        width: "100%", boxSizing: "border-box",
                        padding: "9px 12px", borderRadius: "8px",
                        border: "1.5px solid #e2e8f0", fontSize: "13px",
                        fontFamily: "inherit", outline: "none",
                        marginBottom: "12px",
                        color: "#0f172a",
                      }}
                    />
                    <button type="submit" disabled={isPending} style={{
                      width: "100%", padding: "10px",
                      background: isPending ? "#94a3b8" : "#0e7490",
                      color: "white", border: "none", borderRadius: "9px",
                      fontSize: "13px", fontWeight: 800, cursor: isPending ? "not-allowed" : "pointer",
                      boxShadow: "0 2px 12px rgba(14,116,144,0.25)",
                    }}>
                      {isPending ? "Sending..." : "Send invite"}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleBulk}>
                    <label style={{
                      fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                      textTransform: "uppercase", letterSpacing: "0.06em",
                      display: "block", marginBottom: "6px",
                    }}>Email addresses</label>
                    <textarea
                      required
                      value={bulkEmails}
                      onChange={e => setBulkEmails(e.target.value)}
                      placeholder={"alice@co.com\nbob@co.com\ncarol@co.com"}
                      rows={5}
                      style={{
                        width: "100%", boxSizing: "border-box",
                        padding: "9px 12px", borderRadius: "8px",
                        border: "1.5px solid #e2e8f0", fontSize: "13px",
                        fontFamily: "inherit", outline: "none", resize: "vertical",
                        marginBottom: "6px", color: "#0f172a",
                      }}
                    />
                    <p style={{ fontSize: "11px", color: "#94a3b8", margin: "0 0 10px" }}>
                      Separate by newline, comma, or semicolon. All get the same role.
                    </p>
                    <button type="submit" disabled={isPending} style={{
                      width: "100%", padding: "10px",
                      background: isPending ? "#94a3b8" : "#0e7490",
                      color: "white", border: "none", borderRadius: "9px",
                      fontSize: "13px", fontWeight: 800, cursor: isPending ? "not-allowed" : "pointer",
                      boxShadow: "0 2px 12px rgba(14,116,144,0.25)",
                    }}>
                      {isPending ? "Sending..." : "Send all invites"}
                    </button>

                    {/* Bulk results */}
                    {bulkResult && (
                      <div style={{ marginTop: "12px" }}>
                        {bulkResult.map(r => (
                          <div key={r.email} style={{
                            display: "flex", alignItems: "center", gap: "8px",
                            padding: "5px 0", fontSize: "11px",
                            borderBottom: "1px solid #f8fafc",
                          }}>
                            <span style={{
                              width: 16, height: 16, borderRadius: "50%",
                              background: r.ok ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)",
                              color: r.ok ? "#059669" : "#dc2626",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: "9px", fontWeight: 800, flexShrink: 0,
                            }}>{r.ok ? "[ok]" : "x"}</span>
                            <span style={{ flex: 1, color: "#334155" }}>{r.email}</span>
                            {r.error && <span style={{ color: "#dc2626" }}>{r.error}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </form>
                )}
              </div>

              {/* How invites work */}
              <div style={{
                borderTop: "1.5px solid #f1f5f9", padding: "14px 20px",
                background: "#fafafa",
              }}>
                <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                              textTransform: "uppercase", letterSpacing: "0.06em",
                              marginBottom: "8px" }}>
                  How it works
                </div>
                {[
                  "Invitee receives a branded ResForce email",
                  "They click the link to create or log in",
                  "They're added to the org automatically",
                  "Invites expire after 7 days",
                ].map((step, i) => (
                  <div key={i} style={{
                    display: "flex", gap: "8px", alignItems: "flex-start",
                    marginBottom: "5px",
                  }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: "50%",
                      background: "#e2e8f0", color: "#64748b",
                      fontSize: "9px", fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0, marginTop: "1px",
                    }}>{i + 1}</span>
                    <span style={{ fontSize: "11px", color: "#64748b" }}>{step}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* ── Right: invite list ── */}
            <div>
              {/* Filter tabs */}
              <div style={{
                display: "flex", gap: "4px", marginBottom: "12px",
              }}>
                {(["all", "pending", "accepted", "revoked"] as const).map(f => {
                  const count = f === "all"
                    ? invites.length
                    : invites.filter(i => effectiveStatus(i) === f).length;
                  return (
                    <button key={f} type="button" onClick={() => setFilterSt(f)} style={{
                      padding: "5px 12px", borderRadius: "6px", border: "1.5px solid",
                      borderColor: filterSt === f ? "#0e7490" : "#e2e8f0",
                      background: filterSt === f ? "rgba(14,116,144,0.08)" : "white",
                      color: filterSt === f ? "#0e7490" : "#64748b",
                      fontSize: "11px", fontWeight: 700, cursor: "pointer",
                      textTransform: "capitalize",
                    }}>
                      {f === "all" ? "All" : f}
                      {count > 0 && (
                        <span style={{
                          marginLeft: "5px", background: filterSt === f ? "#0e7490" : "#e2e8f0",
                          color: filterSt === f ? "white" : "#64748b",
                          borderRadius: "10px", padding: "0 5px", fontSize: "9px", fontWeight: 800,
                        }}>{count}</span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* List */}
              <div style={{
                background: "white", borderRadius: "14px",
                border: "1.5px solid #e2e8f0", overflow: "hidden",
              }}>
                {visibleInvites.length === 0 ? (
                  <div style={{
                    padding: "48px 0", textAlign: "center",
                    fontSize: "13px", color: "#94a3b8",
                  }}>
                    <div style={{ fontSize: "28px", marginBottom: "8px" }}>
                      {filterSt === "all" ? "[email]" : "[ok]"}
                    </div>
                    {filterSt === "all"
                      ? "No invites yet. Send your first one."
                      : `No ${filterSt} invites.`}
                  </div>
                ) : (
                  visibleInvites.map(invite => (
                    <InviteRow
                      key={invite.id}
                      invite={invite}
                      organisationId={organisationId}
                      onRevoke={handleRevoke}
                      onResend={handleResend}
                    />
                  ))
                )}
              </div>

              {/* Expiry note for pending invites */}
              {invites.some(i => isExpired(i)) && (
                <p style={{
                  fontSize: "11px", color: "#f59e0b", margin: "8px 0 0",
                  fontWeight: 600,
                }}>
                  Some invites have expired. Use Resend to refresh them.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}