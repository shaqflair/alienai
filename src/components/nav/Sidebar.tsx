"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import GlobalSearch from "@/components/search/GlobalSearch";

/* =============================================================================
   TYPES
============================================================================= */
type NavItem = {
  href:    string;
  label:   string;
  icon:    React.ReactNode;
  exact?:  boolean;
  badge?:  string;
};

type NavGroup = {
  label:   string;
  items:   NavItem[];
};

/* =============================================================================
   HELPERS
============================================================================= */
function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

const RESERVED_PROJECT_IDS = new Set([
  "artifacts","changes","change","approvals","members",
  "lessons","raid","schedule","wbs","settings",
]);

function getActiveProjectRef(pathname: string): string | null {
  const m = /^\/projects\/([^\/?#]+)(?:[\/?#]|$)/.exec(pathname || "");
  if (!m) return null;
  let id = m[1] || "";
  try { id = decodeURIComponent(id); } catch {}
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
   ICONS
============================================================================= */
const Icons = {
  dashboard: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
      <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
    </svg>
  ),
  projects: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  heatmap: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="4" height="4" rx="1"/><rect x="10" y="3" width="4" height="4" rx="1"/>
      <rect x="17" y="3" width="4" height="4" rx="1"/><rect x="3" y="10" width="4" height="4" rx="1"/>
      <rect x="10" y="10" width="4" height="4" rx="1"/><rect x="17" y="10" width="4" height="4" rx="1"/>
      <rect x="3" y="17" width="4" height="4" rx="1"/><rect x="10" y="17" width="4" height="4" rx="1"/>
      <rect x="17" y="17" width="4" height="4" rx="1"/>
    </svg>
  ),
  allocations: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  people: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
      <circle cx="12" cy="7" r="4"/>
    </svg>
  ),
  leave: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>
    </svg>
  ),
  artifacts: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
      <polyline points="10 9 9 9 8 9"/>
    </svg>
  ),
  members: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.07 4.93l-1.41 1.41M4.93 4.93l1.41 1.41M4.93 19.07l1.41-1.41M19.07 19.07l-1.41-1.41M12 2v2M12 20v2M2 12h2M20 12h2"/>
    </svg>
  ),
  chevronLeft: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
  ),
  chevronRight: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  ),
  logo: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="4" height="4" rx="1"/>
      <rect x="10" y="3" width="4" height="4" rx="1" opacity="0.6"/>
      <rect x="17" y="3" width="4" height="4" rx="1" opacity="0.3"/>
      <rect x="3" y="10" width="4" height="4" rx="1" opacity="0.7"/>
      <rect x="10" y="10" width="4" height="4" rx="1"/>
      <rect x="17" y="10" width="4" height="4" rx="1" opacity="0.5"/>
      <rect x="3" y="17" width="4" height="4" rx="1" opacity="0.4"/>
      <rect x="10" y="17" width="4" height="4" rx="1" opacity="0.8"/>
      <rect x="17" y="17" width="4" height="4" rx="1"/>
    </svg>
  ),
};

/* =============================================================================
   SUB-COMPONENTS
============================================================================= */
function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean; }) {
  const active = useIsActive(item.href, item.exact);
  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cx(
        "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 relative",
        active ? "bg-cyan-500/12 text-cyan-200 ring-1 ring-cyan-400/25" : "text-slate-400 hover:text-slate-100 hover:bg-white/5"
      )}
    >
      {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-cyan-400 rounded-r-full" />}
      <span className={cx("flex-shrink-0 transition-colors", active ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300")}>
        {item.icon}
      </span>
      {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
    </Link>
  );
}

function SidebarGroup({ group, collapsed }: { group: NavGroup; collapsed: boolean; }) {
  return (
    <div className="flex flex-col gap-0.5">
      {!collapsed && <div className="px-3 pb-1 pt-2 text-[10px] font-bold tracking-widest uppercase text-slate-600">{group.label}</div>}
      {group.items.map(item => <SidebarItem key={item.href} item={item} collapsed={collapsed} />)}
    </div>
  );
}

function ProjectContextStrip({ projectRef, collapsed }: { projectRef: string; collapsed: boolean; }) {
  const pathname = usePathname();
  const base = `/projects/${projectRef}`;
  if (collapsed) return null;
  const subItems = [
    { href: base, label: "Overview" },
    { href: `${base}/artifacts`, label: "Artifacts" },
    { href: `${base}/changes`, label: "Changes" },
    { href: `${base}/members`, label: "Members" },
  ];
  return (
    <div className="mx-2 mb-2 rounded-xl border border-white/8 bg-white/3 p-2">
      <div className="px-1 pb-1.5 text-[10px] font-bold tracking-widest uppercase text-slate-600">Current project</div>
      <div className="flex flex-col gap-0.5">
        {subItems.map(item => (
          <Link key={item.href} href={item.href} className={cx(
            "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
            pathname === item.href ? "bg-cyan-500/10 text-cyan-300" : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
          )}>
            <span className={cx("w-1 h-1 rounded-full", pathname === item.href ? "bg-cyan-400" : "bg-slate-600")} />
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN SIDEBAR
============================================================================= */
const STORAGE_KEY = "resforce-sidebar-collapsed";

export default function Sidebar({ userName, orgName }: { userName?: string | null; orgName?: string | null; }) {
  const pathname = usePathname();
  const projectRef = getActiveProjectRef(pathname);
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "1") setCollapsed(true);
    setMounted(true);
  }, []);

  const toggleCollapse = () => setCollapsed(prev => {
    localStorage.setItem(STORAGE_KEY, !prev ? "1" : "0");
    return !prev;
  });

  const NAV_GROUPS: NavGroup[] = [
    { label: "Overview", items: [ { href: "/", label: "Dashboard", icon: Icons.dashboard, exact: true }, { href: "/projects", label: "Projects", icon: Icons.projects } ] },
    { label: "Resource", items: [ { href: "/heatmap", label: "Heatmap", icon: Icons.heatmap }, { href: "/people", label: "People", icon: Icons.people } ] }
  ];

  const w = mounted ? (collapsed ? "64px" : "220px") : "220px";

  return (
    <aside className="h-screen flex flex-col sticky top-0 bg-[#0a0d14] border-r border-white/6 overflow-hidden transition-all duration-200" style={{ width: w }}>
      <div className="flex items-center gap-3 px-4 border-b border-white/6 h-14 flex-shrink-0">
        <div className="text-cyan-400">{Icons.logo}</div>
        {!collapsed && <div className="text-sm font-black text-white truncate">ResForce</div>}
        <button onClick={toggleCollapse} className="ml-auto w-6 h-6 flex items-center justify-center text-slate-600 hover:text-slate-300">
          {collapsed ? Icons.chevronRight : Icons.chevronLeft}
        </button>
      </div>
      {!collapsed && <GlobalSearch />}
      <div className="flex-1 overflow-y-auto py-3 px-2 flex flex-col gap-1">
        {NAV_GROUPS.map(g => <SidebarGroup key={g.label} group={g} collapsed={collapsed} />)}
        {projectRef && <ProjectContextStrip projectRef={projectRef} collapsed={collapsed} />}
      </div>
      <div className="p-2 border-t border-white/6">
        <div className="flex items-center gap-3 px-3 py-2 bg-white/3 rounded-xl">
           <div className="w-7 h-7 rounded-full bg-cyan-500/20 text-cyan-400 flex items-center justify-center font-bold">{(userName || "U")[0]}</div>
           {!collapsed && <div className="text-xs text-slate-300 truncate">{userName || "User"}</div>}
        </div>
      </div>
    </aside>
  );
}
