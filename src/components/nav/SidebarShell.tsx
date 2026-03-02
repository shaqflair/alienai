"use client";
// FILE: src/components/nav/SidebarShell.tsx
//
// Client wrapper that reads the current pathname and decides whether
// to show the sidebar. This keeps layout.tsx a server component.

import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

const NO_SIDEBAR_PREFIXES = [
  "/login",
  "/signup",
  "/auth",
  "/invite",
  "/reset-password",
  "/verify",
];

function shouldShowSidebar(pathname: string): boolean {
  return !NO_SIDEBAR_PREFIXES.some(p => pathname === p || pathname.startsWith(p + "/"));
}

export default function SidebarShell({
  children,
  userName,
  orgName,
  projectCount = 0,
}: {
  children:      React.ReactNode;
  userName:      string | null;
  orgName:       string | null;
  projectCount?: number;
}) {
  const pathname    = usePathname();
  const showSidebar = shouldShowSidebar(pathname);

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar userName={userName} orgName={orgName} projectCount={projectCount} />
      <main style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "hidden",
        background: "#f8fafc",
        minWidth: 0,
      }}>
        {children}
      </main>
    </div>
  );
}