"use client";

import { usePathname } from "next/navigation";

type Props = {
  orgName:        string;
  myRole:         string;
  isAdmin:        boolean;
  memberCount:    number;
  pendingInvites: number;
  organisationId: string | null;
  userEmail:      string;
  children:       React.ReactNode;
};

type NavItem = {
  href:       string;
  label:      string;
  icon:       string;
  badge?:     number;
  adminOnly?: boolean;
  exact?:     boolean;
};

const NAV: NavItem[] = [
  { href: "/settings",          label: "General",    icon: "G", exact: true },
  { href: "/settings/profile",  label: "Org profile", icon: "O" },
  { href: "/settings/members",  label: "Members",     icon: "M" },
  { href: "/people/invite",     label: "Invites",     icon: "I", adminOnly: true },
  { href: "/settings/billing",  label: "Billing",     icon: "B", adminOnly: true },
  { href: "/settings/security", label: "Security",    icon: "S" },
];

function NavLink({
  item, isAdmin, pendingInvites,
}: {
  item: NavItem;
  isAdmin: boolean;
  pendingInvites: number;
}) {
  const pathname = usePathname();
  const actualActive = item.exact
    ? pathname === item.href
    : pathname.startsWith(item.href) && item.href !== "/settings";

  const badge = item.href === "/people/invite" && pendingInvites > 0 ? pendingInvites : undefined;

  if (item.adminOnly && !isAdmin) return null;

  return (
    <a href={item.href} style={{
      display:       "flex",
      alignItems:    "center",
      gap:           "10px",
      padding:       "8px 12px",
      borderRadius:  "8px",
      textDecoration: "none",
      background:    actualActive ? "rgba(14,116,144,0.1)" : "transparent",
      color:         actualActive ? "#0e7490" : "#475569",
      fontWeight:    actualActive ? 700 : 500,
      fontSize:      "13px",
      transition:    "all 0.1s",
      borderLeft:    actualActive ? "2px solid #0e7490" : "2px solid transparent",
    }}>
      <span style={{
        width:          24, height: 24,
        borderRadius:   "6px",
        background:     actualActive ? "rgba(14,116,144,0.15)" : "rgba(100,116,139,0.08)",
        display:        "flex",
        alignItems:     "center",
        justifyContent: "center",
        fontSize:       "9px",
        fontWeight:     800,
        color:          actualActive ? "#0e7490" : "#94a3b8",
        flexShrink:     0,
      }}>
        {item.icon}
      </span>
      <span style={{ flex: 1 }}>{item.label}</span>
      {badge != null && (
        <span style={{
          background:   "#f59e0b",
          color:        "white",
          borderRadius: "10px",
          padding:      "1px 6px",
          fontSize:     "9px",
          fontWeight:   800,
        }}>{badge}</span>
      )}
    </a>
  );
}

export default function SettingsLayoutClient({
  orgName, myRole, isAdmin, memberCount, pendingInvites,
  userEmail, children,
}: Props) {
  return (
    <div style={{
      display:    "flex",
      minHeight:  "100vh",
      background: "#f8fafc",
    }}>
      {/* Settings sidebar */}
      <div style={{
        width:      220,
        flexShrink: 0,
        background: "white",
        borderRight: "1.5px solid #e2e8f0",
        display:    "flex",
        flexDirection: "column",
        padding:    "24px 12px",
      }}>
        <div style={{ padding: "0 4px 16px", borderBottom: "1.5px solid #f1f5f9", marginBottom: "12px" }}>
          <div style={{ fontSize: "14px", fontWeight: 900, color: "#0f172a", letterSpacing: "-0.2px" }}>
            Settings
          </div>
          <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>{orgName}</div>
        </div>

        <nav style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1 }}>
          {NAV.map(item => (
            <NavLink
              key={item.href}
              item={item}
              isAdmin={isAdmin}
              pendingInvites={pendingInvites}
            />
          ))}
        </nav>

        <div style={{ borderTop: "1.5px solid #f1f5f9", paddingTop: "12px", marginTop: "8px" }}>
          <div style={{ fontSize: "10px", color: "#cbd5e1", marginBottom: "4px" }}>{userEmail}</div>
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <span style={{
              fontSize: "9px", fontWeight: 800, padding: "2px 7px",
              borderRadius: "5px", textTransform: "capitalize",
              background: myRole === "admin" || myRole === "owner" ? "rgba(124,58,237,0.1)" : "rgba(14,116,144,0.1)",
              color: myRole === "admin" || myRole === "owner" ? "#7c3aed" : "#0e7490",
            }}>{myRole}</span>
            <span style={{
              fontSize: "9px", fontWeight: 700, padding: "2px 7px",
              borderRadius: "5px", background: "rgba(100,116,139,0.08)", color: "#64748b",
            }}>{memberCount} member{memberCount !== 1 ? "s" : ""}</span>
          </div>
        </div>
      </div>

      <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "40px" }}>
        {children}
      </main>
    </div>
  );
}

