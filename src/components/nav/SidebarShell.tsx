// "use client";
// FILE: src/components/nav/SidebarShell.tsx

import React from "react";
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
  return !NO_SIDEBAR_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default function SidebarShell({
  children,
  userName,
  orgName,
}: {
  children: React.ReactNode;
  userName: string | null;
  orgName: string | null;
}) {
  const pathname = usePathname();
  const showSidebar = shouldShowSidebar(pathname);

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <div
      style={{
        display: "flex",
        height: "calc(100vh - 56px)",
        overflow: "hidden",
        background: "#f8fafc",
      }}
    >
      <Sidebar userName={userName} orgName={orgName} />

      <main
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          background: "#f8fafc",
          minWidth: 0,
        }}
      >
        {children}
      </main>
    </div>
  );
}