import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { createOrganisation } from "@/app/actions/org-admin";

type Role = "owner" | "admin" | "member";

type OrgRow = {
  organisation_id: string;
  role: string;
  organisations: { id: string; name: string } | null;
};

function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function normalizeRole(x: any): Role {
  const v = String(x || "").trim().toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

const ROLE_STYLES: Record<Role, { label: string; bg: string; color: string; border: string }> = {
  owner: { label: "Owner", bg: "#faf5ff", color: "#7c3aed", border: "#e9d5ff" },
  admin: { label: "Admin", bg: "#eff6ff", color: "#1d4ed8", border: "#bfdbfe" },
  member: { label: "Member", bg: "#f8fafc", color: "#64748b", border: "#e2e8f0" },
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AVATAR_COLS = ["#06b6d4", "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#ef4444"];
function avatarCol(name: string) {
  return AVATAR_COLS[(name?.charCodeAt(0) ?? 0) % AVATAR_COLS.length];
}
function orgInitial(name: string) {
  return (name ?? "?")[0].toUpperCase();
}

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr) throw new Error(sbErrText(authErr));
  if (!user) redirect("/login");

  const { data, error: memErr } = await supabase
    .from("organisation_members")
    .select(`organisation_id, role, organisations:organisations ( id, name )`)
    .eq("user_id", user.id)
    .is("removed_at", null);

  if (memErr) throw new Error(sbErrText(memErr));

  const memberships = ((data ?? []) as unknown as OrgRow[])
    .map((r) => {
      if (!r.organisations?.id) return null;
      return {
        orgId: r.organisations.id,
        orgName: r.organisations.name,
        role: normalizeRole(r.role),
      };
    })
    .filter(Boolean) as Array<{ orgId: string; orgName: string; role: Role }>;

  let activeOrgId: string | null = null;
  try {
    activeOrgId = await getActiveOrgId();
  } catch {
    activeOrgId = null;
  }

  const active =
    memberships.find((m) => m.orgId === activeOrgId) ??
    memberships.find((m) => m.role === "owner") ??
    memberships[0] ??
    null;

  const myRole = active?.role ?? null;
  const isAdmin = myRole === "admin" || myRole === "owner";

  const page: React.CSSProperties = {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
    padding: "36px 24px 60px",
  };
  const wrap: React.CSSProperties = { maxWidth: 680, margin: "0 auto" };

  const pageTitle: React.CSSProperties = {
    fontSize: 26,
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.5px",
    margin: "0 0 28px",
  };

  const card: React.CSSProperties = {
    background: "white",
    borderRadius: 16,
    border: "1.5px solid #e2e8f0",
    boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
    padding: "24px 24px 20px",
    marginBottom: 16,
  };

  const sectionLabel: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 800,
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    marginBottom: 16,
  };

  const orgCard = (isActive: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 12,
    border: `1.5px solid ${isActive ? "#a5f3fc" : "#e2e8f0"}`,
    background: isActive ? "#ecfeff" : "#fafbfc",
    marginBottom: 8,
    transition: "border-color 0.15s",
  });

  const actionBtn: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 8,
    border: "1.5px solid #e2e8f0",
    background: "white",
    fontSize: 12,
    fontWeight: 600,
    color: "#475569",
    textDecoration: "none",
    whiteSpace: "nowrap",
    cursor: "pointer",
  };

  const primaryBtn: React.CSSProperties = {
    ...actionBtn,
    background: "#06b6d4",
    border: "none",
    color: "white",
    fontWeight: 700,
  };

  const setActiveBtn: React.CSSProperties = {
    ...actionBtn,
    borderColor: "#a5f3fc",
    color: "#0891b2",
    background: "white",
  };

  function RoleBadge({ role }: { role: Role }) {
    const s = ROLE_STYLES[role];
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          padding: "2px 7px",
          borderRadius: 6,
          border: `1px solid ${s.border}`,
          background: s.bg,
          color: s.color,
          letterSpacing: "0.03em",
        }}
      >
        {s.label}
      </span>
    );
  }

  function ActiveBadge() {
    return (
      <span
        style={{
          fontSize: 10,
          fontWeight: 700,
          padding: "2px 7px",
          borderRadius: 6,
          border: "1px solid #a5f3fc",
          background: "#ecfeff",
          color: "#0891b2",
          letterSpacing: "0.03em",
        }}
      >
        Active
      </span>
    );
  }

  function AdminChip() {
    return (
      <span
        style={{
          fontSize: 9,
          fontWeight: 800,
          padding: "2px 5px",
          borderRadius: 4,
          background: "#eff6ff",
          color: "#1d4ed8",
          border: "1px solid #bfdbfe",
          marginLeft: 4,
          letterSpacing: "0.04em",
        }}
      >
        Admin
      </span>
    );
  }

  return (
    <main style={page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        .settings-action-btn:hover { background: #f1f5f9 !important; border-color: #cbd5e1 !important; }
        .settings-set-active:hover { background: #ecfeff !important; }
        .settings-input:focus { border-color: #06b6d4 !important; outline: none; box-shadow: 0 0 0 3px rgba(6,182,212,0.12); }
        .settings-create-btn:hover { background: #0891b2 !important; }
        .settings-org-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
      `}</style>

      <div style={wrap}>
        <h1 style={pageTitle}>Settings</h1>

        <div style={card}>
          <div style={sectionLabel}>Your organisations</div>

          {memberships.length === 0 ? (
            <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>
              You are not a member of any organisation yet.
            </p>
          ) : (
            <>
              {memberships.map((m) => {
                const isActiveOrg = active?.orgId === m.orgId;
                const memberIsAdmin = m.role === "admin" || m.role === "owner";

                return (
                  <div key={m.orgId} className="settings-org-card" style={orgCard(isActiveOrg)}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                      <div
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 10,
                          flexShrink: 0,
                          background: avatarCol(m.orgName),
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 15,
                          fontWeight: 800,
                          color: "white",
                        }}
                      >
                        {orgInitial(m.orgName)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                            {m.orgName}
                          </span>
                          <RoleBadge role={m.role} />
                          {isActiveOrg && <ActiveBadge />}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: "#94a3b8",
                            marginTop: 2,
                            fontFamily: "'DM Mono', monospace",
                          }}
                        >
                          {m.orgId}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flexShrink: 0 }}>
                      {!isActiveOrg && (
                        <form method="post" action="/api/active-org" style={{ display: "contents" }}>
                          <input type="hidden" name="org_id" value={m.orgId} />
                          <input type="hidden" name="next" value="/settings" />
                          <button type="submit" className="settings-set-active" style={setActiveBtn}>
                            Set active
                          </button>
                        </form>
                      )}
                      <Link href={`/organisations/${m.orgId}/members`} className="settings-action-btn" style={actionBtn}>
                        Members
                      </Link>
                      <Link href={`/organisations/${m.orgId}/settings?tab=settings`} className="settings-action-btn" style={actionBtn}>
                        Settings
                      </Link>
                      <Link href={`/organisations/${m.orgId}/settings?tab=approvals`} className="settings-action-btn" style={actionBtn}>
                        Approvals
                      </Link>
                      <Link href={`/organisations/${m.orgId}/settings?tab=rate-cards`} className="settings-action-btn" style={actionBtn}>
                        Rate Cards
                        {memberIsAdmin && <AdminChip />}
                      </Link>
                    </div>
                  </div>
                );
              })}

              <p style={{ fontSize: 11, color: "#94a3b8", margin: "10px 0 0" }}>
                Governance actions (transfer ownership / leave org) live in{" "}
                <strong style={{ color: "#64748b" }}>Organisation settings</strong>.
              </p>
            </>
          )}
        </div>

        <div style={card}>
          <div style={sectionLabel}>Active organisation</div>

          {active ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    flexShrink: 0,
                    background: avatarCol(active.orgName),
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 18,
                    fontWeight: 800,
                    color: "white",
                  }}
                >
                  {orgInitial(active.orgName)}
                </div>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: "#0f172a" }}>
                      {active.orgName}
                    </span>
                    {myRole && <RoleBadge role={myRole} />}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: "#94a3b8",
                      marginTop: 3,
                      fontFamily: "'DM Mono', monospace",
                    }}
                  >
                    {active.orgId}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <Link href={`/organisations/${active.orgId}/members`} className="settings-action-btn" style={actionBtn}>
                  Members
                </Link>
                <Link href={`/organisations/${active.orgId}/settings?tab=settings`} className="settings-action-btn" style={actionBtn}>
                  Organisation settings
                </Link>
                <Link href={`/organisations/${active.orgId}/settings?tab=approvals`} className="settings-action-btn" style={actionBtn}>
                  Approvals
                </Link>
                <Link href={`/organisations/${active.orgId}/settings?tab=rate-cards`} className="settings-action-btn" style={actionBtn}>
                  Rate Cards
                  {isAdmin && <AdminChip />}
                </Link>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "#64748b", margin: 0 }}>No organisation selected.</p>
          )}
        </div>

        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 9,
                background: "#ecfeff",
                border: "1px solid #a5f3fc",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            />
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Create organisation</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 1 }}>
                Set up a new workspace for your team
              </div>
            </div>
          </div>

          <form action={createOrganisation}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                name="name"
                placeholder="e.g. Vodafone UK"
                required
                className="settings-input"
                style={{
                  flex: 1,
                  padding: "9px 13px",
                  borderRadius: 10,
                  border: "1.5px solid #e2e8f0",
                  fontSize: 13,
                  color: "#0f172a",
                  background: "white",
                  fontFamily: "inherit",
                  outline: "none",
                  transition: "border-color 0.15s",
                }}
              />
              <button type="submit" className="settings-create-btn" style={primaryBtn}>
                Create
              </button>
            </div>
          </form>

          <p style={{ fontSize: 11, color: "#94a3b8", margin: "10px 0 0" }}>
            After creating, use the org&apos;s <strong style={{ color: "#64748b" }}>Settings</strong> page for governance and membership management.
          </p>
        </div>
      </div>
    </main>
  );
}