"use client";
// FILE: src/components/nav/SidebarShell.tsx

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
  return !NO_SIDEBAR_PREFIXES.some(
    p => pathname === p || pathname.startsWith(p + "/")
  );
}

export default function SidebarShell({
  children,
  userName,
  orgName,
}: {
  children:  React.ReactNode;
  userName:  string | null;
  orgName:   string | null;
}) {
  const pathname    = usePathname();
  const showSidebar = shouldShowSidebar(pathname);

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <div style={{
      display: "flex",
      // Takes remaining height after AppHeader.
      // If your AppHeader is h-14 (56px), set this to calc(100vh - 56px).
      // Adjust the value to match your actual header height.
      height: "calc(100vh - 56px)",
      overflow: "hidden",
    }}>
      {/* Sidebar — sticky, fills remaining height */}
      <Sidebar userName={userName} orgName={orgName} />

      {/* Main content — scrollable */}
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