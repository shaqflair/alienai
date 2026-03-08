"use client";
// FILE: src/components/nav/SidebarShell.tsx

import React from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";

async function safeSyncNow() {
  try {
    const mod = await import("@/lib/offline/sync");
    if (typeof mod.syncNow === "function") await mod.syncNow();
  } catch {
    // ignore if offline layer not present yet
  }
}

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
  projectCount = 0,
}: {
  children: React.ReactNode;
  userName: string | null;
  orgName: string | null;
  projectCount?: number;
}) {
  const pathname = usePathname();
  const showSidebar = shouldShowSidebar(pathname);

  const [isOffline, setIsOffline] = React.useState(false);
  const [syncing, setSyncing] = React.useState(false);
  const [queuedCount, setQueuedCount] = React.useState<number | null>(null);

  // Keep offline state in sync with browser connectivity
  React.useEffect(() => {
    if (!showSidebar) return;

    const setFromNavigator = () => setIsOffline(typeof navigator !== "undefined" ? !navigator.onLine : false);
    setFromNavigator();

    const onOnline = async () => {
      setIsOffline(false);
      setSyncing(true);
      try {
        await safeSyncNow();
      } finally {
        setSyncing(false);
      }
    };

    const onOffline = () => setIsOffline(true);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [showSidebar]);

  // Best-effort: read queued count (if offline queue exists).
  //
  // FIX: Previously this ran setInterval every 5s and always called
  // setQueuedCount(null) in the catch block (because @/lib/offline/queue
  // doesn't exist). Every setQueuedCount call re-rendered SidebarShell →
  // re-rendered Sidebar → re-rendered all <Link> components → Next.js
  // App Router re-triggered RSC prefetch for every visible nav link
  // (projects, heatmap, governance, people, etc.) every 5 seconds.
  // This is what caused the ?_rsc= waterfall in the network tab.
  //
  // Fix: try once; if the module is absent, never poll again.
  // If present, only update state when the value actually changes.
  React.useEffect(() => {
    if (!showSidebar) return;

    let alive = true;
    let moduleConfirmedAbsent = false;

    async function loadQueued() {
      if (moduleConfirmedAbsent) return;
      try {
        const qmod = await import("@/lib/offline/queue");
        if (typeof qmod.getQueue !== "function") {
          moduleConfirmedAbsent = true;
          return;
        }
        const q = await qmod.getQueue();
        if (!alive) return;
        const next = Array.isArray(q) ? q.length : null;
        // Only call setState if value changed — avoids triggering a re-render
        // (and downstream Link prefetch cascade) when nothing has changed
        setQueuedCount((prev) => (prev === next ? prev : next));
      } catch {
        // Module not present — mark absent so interval becomes a no-op
        moduleConfirmedAbsent = true;
      }
    }

    loadQueued();
    const id = window.setInterval(loadQueued, 5000);

    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [showSidebar, isOffline, syncing]);

  if (!showSidebar) {
    return <>{children}</>;
  }

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar userName={userName} orgName={orgName} projectCount={projectCount} />

      <main
        style={{
          flex: 1,
          overflowY: "auto",
          overflowX: "hidden",
          background: "#f8fafc",
          minWidth: 0,
          position: "relative",
        }}
      >
        {(isOffline || syncing) && (
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 40,
              padding: "10px 14px",
              borderBottom: "1px solid rgba(226,232,240,0.9)",
              background: isOffline
                ? "linear-gradient(90deg, rgba(15,23,42,0.96), rgba(2,132,199,0.20))"
                : "linear-gradient(90deg, rgba(2,132,199,0.18), rgba(99,102,241,0.12))",
              color: isOffline ? "rgba(241,245,249,0.95)" : "rgba(15,23,42,0.90)",
              backdropFilter: "blur(10px)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 999,
                    background: isOffline ? "#f59e0b" : "#06b6d4",
                    boxShadow: isOffline ? "0 0 10px rgba(245,158,11,0.45)" : "0 0 10px rgba(6,182,212,0.45)",
                    flex: "0 0 auto",
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}>
                    {isOffline ? "Offline mode" : "Syncing queued changes"}
                  </div>
                  <div style={{ fontSize: 12, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {isOffline
                      ? `You can keep working — changes will sync automatically when you're back online${
                          typeof queuedCount === "number" ? ` (${queuedCount} queued)` : ""
                        }.`
                      : "Updating ΛLIΞNΛ with your offline edits…"}
                  </div>
                </div>
              </div>

              {!isOffline && (
                <button
                  type="button"
                  onClick={async () => {
                    setSyncing(true);
                    try {
                      await safeSyncNow();
                    } finally {
                      setSyncing(false);
                    }
                  }}
                  style={{
                    border: "1px solid rgba(148,163,184,0.55)",
                    background: "rgba(255,255,255,0.75)",
                    padding: "8px 10px",
                    borderRadius: 12,
                    fontSize: 12,
                    fontWeight: 800,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                  aria-label="Sync now"
                >
                  Sync now
                </button>
              )}
            </div>
          </div>
        )}

        {children}
      </main>
    </div>
  );
}