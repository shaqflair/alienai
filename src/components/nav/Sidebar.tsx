"use client";
// FILE: src/components/nav/Sidebar.tsx

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import GlobalSearch from "@/components/search/GlobalSearch";

/* =============================================================================
   TYPES
============================================================================= */

type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  exact?: boolean;
  badge?: string;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

/* =============================================================================
   HELPERS
============================================================================= */

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const RESERVED_PROJECT_IDS = new Set([
  "artifacts",
  "changes",
  "change",
  "approvals",
  "members",
  "lessons",
  "raid",
  "schedule",
  "wbs",
  "settings",
]);

function getActiveProjectRef(pathname: string): string | null {
  const m = /^\/projects\/([^\/?#]+)(?:[\/?#]|$)/.exec(pathname || "");
  if (!m) return null;
  let id = m[1] || "";
  try {
    id = decodeURIComponent(id);
  } catch {}
  id = id.trim();
  if (!id || RESERVED_PROJECT_IDS.has(id.toLowerCase())) return null;
  return id;
}

function useIsActive(href: string, exact = false) {
  const pathname = usePathname();
  if (exact) return pathname === href;
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

/* =============================================================================
   ICONS  (inline SVG -- no dep needed)
============================================================================= */

const Icons = {
  dashboard: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  ),
  projects: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  heatmap: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="4" height="4" rx="1" />
      <rect x="10" y="3" width="4" height="4" rx="1" />
      <rect x="17" y="3" width="4" height="4" rx="1" />
      <rect x="3" y="10" width="4" height="4" rx="1" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <rect x="17" y="10" width="4" height="4" rx="1" />
      <rect x="3" y="17" width="4" height="4" rx="1" />
      <rect x="10" y="17" width="4" height="4" rx="1" />
      <rect x="17" y="17" width="4" height="4" rx="1" />
    </svg>
  ),
  allocations: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  people: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  leave: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  ),
  artifacts: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  ),
  members: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  settings: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M12 2v2M12 20v2M2 12h2M20 12h2" />
    </svg>
  ),
  assistant: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" />
    </svg>
  ),
  timesheet: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  orgChart: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <rect x="1" y="16" width="6" height="4" rx="1" />
      <rect x="9" y="16" width="6" height="4" rx="1" />
      <rect x="17" y="16" width="6" height="4" rx="1" />
      <path d="M12 6v4M4 16v-4h16v4" />
    </svg>
  ),
  scenarios: (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2v-4M9 21H5a2 2 0 0 1-2-2v-4m0 0h18" />
    </svg>
  ),
  chevronLeft: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  chevronRight: (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
  logo: (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="4" height="4" rx="1" />
      <rect x="10" y="3" width="4" height="4" rx="1" opacity="0.6" />
      <rect x="17" y="3" width="4" height="4" rx="1" opacity="0.3" />
      <rect x="3" y="10" width="4" height="4" rx="1" opacity="0.7" />
      <rect x="10" y="10" width="4" height="4" rx="1" />
      <rect x="17" y="10" width="4" height="4" rx="1" opacity="0.5" />
      <rect x="3" y="17" width="4" height="4" rx="1" opacity="0.4" />
      <rect x="10" y="17" width="4" height="4" rx="1" opacity="0.8" />
      <rect x="17" y="17" width="4" height="4" rx="1" />
    </svg>
  ),
};

/* =============================================================================
   NAV ITEM COMPONENT (Light theme redesign)
============================================================================= */

function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const active = useIsActive(item.href, item.exact);

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cx(
        "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
        "transition-colors duration-150",
        active
          ? "bg-blue-50 text-blue-700"
          : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      {/* Active indicator bar (left) */}
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-1 rounded-r-full bg-blue-600" />
      )}

      {/* Icon */}
      <span
        className={cx(
          "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-colors",
          active
            ? "border-blue-100 bg-blue-50 text-blue-600"
            : "border-slate-200 bg-white text-slate-500 group-hover:text-slate-700"
        )}
      >
        {item.icon}
      </span>

      {/* Label + badge */}
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <span
              className={cx(
                "ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold",
                active ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
              )}
            >
              {item.badge}
            </span>
          )}
        </>
      )}

      {/* Tooltip when collapsed */}
      {collapsed && (
        <span
          className={cx(
            "absolute left-full ml-3 whitespace-nowrap rounded-xl border border-slate-200 bg-white px-2.5 py-1.5",
            "text-xs font-semibold text-slate-800 shadow-xl z-50",
            "opacity-0 group-hover:opacity-100 pointer-events-none",
            "translate-x-1 group-hover:translate-x-0 transition-all duration-150"
          )}
        >
          {item.label}
          {item.badge && <span className="ml-1.5 text-blue-600">{item.badge}</span>}
        </span>
      )}
    </Link>
  );
}

/* =============================================================================
   NAV GROUP
============================================================================= */

function SidebarGroup({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      {!collapsed && (
        <div className="px-3 pb-1 pt-3">
          <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">
            {group.label}
          </span>
        </div>
      )}
      {collapsed && <div className="h-3" />}
      {group.items.map((item) => (
        <SidebarItem key={item.href} item={item} collapsed={collapsed} />
      ))}
    </div>
  );
}

/* =============================================================================
   PROJECT CONTEXT STRIP (Light)
============================================================================= */

function ProjectContextStrip({ projectRef, collapsed }: { projectRef: string; collapsed: boolean }) {
  const pathname = usePathname();
  const base = `/projects/${projectRef}`;

  const subItems = [
    { href: base, label: "Overview" },
    { href: `${base}/artifacts`, label: "Artifacts" },
    { href: `${base}/changes`, label: "Changes" },
    { href: `${base}/approvals`, label: "Approvals" },
    { href: `${base}/members`, label: "Members" },
  ];

  if (collapsed) return null;

  return (
    <div className="mx-2 mt-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="px-2 pb-2 pt-1">
        <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">
          Current project
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {subItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "flex items-center gap-2 rounded-xl px-2.5 py-2 text-xs font-semibold transition-colors",
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              )}
            >
              <span
                className={cx(
                  "h-2 w-2 rounded-full",
                  active ? "bg-blue-600" : "bg-slate-300"
                )}
              />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN SIDEBAR
============================================================================= */

const STORAGE_KEY = "resforce-sidebar-collapsed";

export default function Sidebar({
  userName,
  orgName,
}: {
  userName?: string | null;
  orgName?: string | null;
}) {
  const pathname = usePathname();
  const projectRef = getActiveProjectRef(pathname);

  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Persist collapse state
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "1") setCollapsed(true);
    setMounted(true);
  }, []);

  function toggleCollapse() {
    setCollapsed((c) => {
      const next = !c;
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      return next;
    });
  }

  const NAV_GROUPS: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { href: "/", label: "Overview", icon: Icons.dashboard, exact: true },
        { href: "/projects", label: "Projects", icon: Icons.projects, badge: "8" },
        { href: "/portfolio", label: "Portfolio", icon: Icons.heatmap },
      ],
    },
    {
      label: "Team",
      items: [
        { href: "/team", label: "Team", icon: Icons.people },
        { href: "/reports", label: "Reports", icon: Icons.artifacts },
        { href: "/analytics", label: "Analytics", icon: Icons.scenarios },
      ],
    },
    {
      label: "Resource",
      items: [
        { href: "/heatmap", label: "Heatmap", icon: Icons.heatmap },
        { href: "/allocations/new", label: "Allocate", icon: Icons.allocations },
        { href: "/timesheet", label: "Timesheet", icon: Icons.timesheet },
        { href: "/capacity", label: "Leave / Cap", icon: Icons.leave },
      ],
    },
  ];

  const BOTTOM_ITEMS: NavItem[] = [{ href: "/settings", label: "Settings", icon: Icons.settings }];

  // Avoid flash of wrong collapse state during SSR
  const w = mounted ? (collapsed ? "72px" : "260px") : "260px";

  const initials = (userName || "U")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0] || "")
    .join("")
    .toUpperCase();

  return (
    <>
      <style>{`
        .sidebar-root {
          width: ${w};
          min-width: ${w};
          transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                      min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .sidebar-scroll::-webkit-scrollbar { width: 10px; }
        .sidebar-scroll::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.35); border-radius: 999px; border: 3px solid transparent; background-clip: content-box; }
        .sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
      `}</style>

      <aside
        className={cx(
          "sidebar-root sticky top-0 h-screen overflow-hidden",
          "flex flex-col",
          "bg-white border-r border-slate-200"
        )}
        style={{ width: w, minWidth: w }}
      >
        {/* Header / Brand */}
        <div className="flex h-16 flex-shrink-0 items-center gap-3 border-b border-slate-200 px-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-sm">
            {Icons.logo}
          </div>

          {!collapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold tracking-tight text-slate-900">
                Portfolio Manager
              </div>
              <div className="truncate text-[11px] font-semibold text-slate-400">
                {orgName || "Enterprise"}
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={toggleCollapse}
            className={cx(
              "ml-auto flex h-9 w-9 items-center justify-center rounded-xl",
              "border border-slate-200 bg-white",
              "text-slate-500 hover:bg-slate-50 hover:text-slate-800 transition-colors"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? Icons.chevronRight : Icons.chevronLeft}
          </button>
        </div>

        {/* Search */}
        {!collapsed && (
          <div className="px-3 pt-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50">
              <GlobalSearch />
            </div>
          </div>
        )}

        {/* Nav */}
        <div className="sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label} group={group} collapsed={collapsed} />
          ))}

          {/* Project context (only when inside a project) */}
          {projectRef && <ProjectContextStrip projectRef={projectRef} collapsed={collapsed} />}
        </div>

        {/* Bottom */}
        <div className="flex-shrink-0 border-t border-slate-200 px-2 py-3">
          <div className="flex flex-col gap-1">
            {BOTTOM_ITEMS.map((item) => (
              <SidebarItem key={item.href} item={item} collapsed={collapsed} />
            ))}
          </div>

          {/* User card */}
          <div
            className={cx(
              "mt-3 flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3",
              "shadow-[0_1px_3px_rgba(0,0,0,0.05)]"
            )}
          >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-xs font-black text-white">
              {initials || "U"}
            </div>

            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {userName || "Account"}
                </div>
                <div className="truncate text-[11px] font-medium text-slate-400">
                  Signed in
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}