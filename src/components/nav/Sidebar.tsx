"use client";
// FILE: src/components/nav/Sidebar.tsx

import React, { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import GlobalSearch from "@/components/search/GlobalSearch";
import { createClient } from "@/utils/supabase/client";

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

type ArtifactSidebarItem = {
  key: string;
  label: string;
  ui_kind: string;
  current: null | {
    id: string;
    title: string | null;
    approval_status: string;
    is_locked?: boolean | null;
    deleted_at?: string | null;
  };
  href: string;
  canCreate: boolean;
  canEdit: boolean;
};

type ArtifactSidebarPayload = {
  ok: boolean;
  error?: string;
  projectId: string;
  projectHumanId?: string;
  projectName?: string;
  projectCode?: string | null;
  role?: "owner" | "editor" | "viewer" | "unknown";
  items: ArtifactSidebarItem[];
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

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function safeUpper(x: unknown) {
  return safeStr(x).trim().toUpperCase();
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
};

/* =============================================================================
   BRAND
============================================================================= */

const ALIENA_LOGO_URL =
  "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png";

function AlienaWordmarkTop() {
  // ΛLIΞNΛ with ONLY the I (after L) in blue
  return (
    <span className="inline-flex items-baseline leading-none">
      <span>ΛL</span>
      <span className="text-sky-600">I</span>
      <span>ΞNΛ</span>
    </span>
  );
}
/* =============================================================================
   NAV ITEM COMPONENT
============================================================================= */

function SidebarItem({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const active = useIsActive(item.href, item.exact);

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      className={cx(
        "group flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium",
        "transition-all duration-150 relative",
        "ring-1 ring-transparent",
        active
          ? "bg-sky-50 text-sky-700 ring-sky-200 shadow-[0_0_0_1px_rgba(14,165,233,0.18)]"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-50"
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-sky-500 rounded-r-full" />
      )}

      <span
        className={cx(
          "flex-shrink-0 transition-colors",
          active ? "text-sky-600" : "text-slate-400 group-hover:text-slate-600"
        )}
      >
        {item.icon}
      </span>

      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.label}</span>
          {item.badge && (
            <span
              className={cx(
                "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                active ? "bg-sky-100 text-sky-700" : "bg-slate-100 text-slate-600"
              )}
            >
              {item.badge}
            </span>
          )}
        </>
      )}

      {collapsed && (
        <span
          className={cx(
            "absolute left-full ml-3 px-2.5 py-1.5 rounded-lg text-xs font-semibold",
            "bg-white text-slate-900 border border-slate-200",
            "shadow-xl whitespace-nowrap z-50",
            "opacity-0 group-hover:opacity-100 pointer-events-none",
            "translate-x-1 group-hover:translate-x-0 transition-all duration-150"
          )}
        >
          {item.label}
          {item.badge && <span className="ml-1.5 text-sky-600">{item.badge}</span>}
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
        <div className="px-3 pb-1 pt-2">
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
   PROJECT CONTEXT STRIP
============================================================================= */

function ProjectContextStrip({ projectRef, collapsed }: { projectRef: string; collapsed: boolean }) {
  const pathname = usePathname();
  const base = `/projects/${projectRef}`;

  // ✅ Ensure delivery governance is always present
  const subItems = [
    { href: base, label: "Overview" },
    { href: `${base}/artifacts`, label: "Artifacts" },
    { href: `${base}/changes`, label: "Changes" },
    { href: `${base}/approvals`, label: "Approvals" },
    { href: `${base}/members`, label: "Members" },
    { href: `${base}/governance`, label: "Delivery governance" },
  ];

  if (collapsed) return null;

  // ✅ Fix: make links clickable even if some overlay exists above
  return (
    <div className="relative z-20 pointer-events-auto mx-2 mb-2 rounded-xl border border-slate-200 bg-slate-50 p-2">
      <div className="px-1 pb-1.5">
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
                "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                active ? "bg-sky-50 text-sky-700" : "text-slate-600 hover:text-slate-900 hover:bg-white"
              )}
            >
              <span className={cx("w-1 h-1 rounded-full flex-shrink-0", active ? "bg-sky-500" : "bg-slate-300")} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* =============================================================================
   INLINE ARTIFACTS (merged into left sidebar)
============================================================================= */

type GroupName = "Plan" | "Control" | "Close";

function isChangeKey(kUpper: string) {
  const u = safeUpper(kUpper);
  return (
    u === "CHANGE" ||
    u === "CHANGES" ||
    u === "CHANGE_REQUEST" ||
    u === "CHANGE_REQUESTS" ||
    u.includes("CHANGE_REQUEST") ||
    (u.includes("CHANGE") && !u.includes("CHARTER"))
  );
}

function isRaidKey(kUpper: string) {
  const u = safeUpper(kUpper);
  return u === "RAID" || u === "RAID_LOG" || u.includes("RAID");
}

function isGovernanceKey(kUpper: string) {
  const u = safeUpper(kUpper);
  return (
    u === "DELIVERY_GOVERNANCE" ||
    u === "GOVERNANCE" ||
    u === "DELIVERYGOVERNANCE" ||
    u.includes("DELIVERY_GOVERNANCE") ||
    u.includes("DELIVERY GOVERNANCE") ||
    u.includes("GOVERNANCE_HUB")
  );
}

function groupForKey(kUpper: string): GroupName {
  const u = safeUpper(kUpper);
  if (
    ["PROJECT_CHARTER", "STAKEHOLDER_REGISTER", "WBS", "SCHEDULE", "FINANCIAL_PLAN", "WEEKLY_REPORT"].includes(u)
  )
    return "Plan";
  if (isRaidKey(u) || isChangeKey(u) || isGovernanceKey(u)) return "Control";
  return "Close";
}

function badgeForStatus(status: string | null | undefined) {
  const s = safeLower(status);
  if (!s || s === "draft") return { label: "Draft", cls: "border-slate-200 bg-white text-slate-600" };
  if (s === "submitted") return { label: "Submitted", cls: "border-sky-200 bg-sky-50 text-sky-700" };
  if (s === "approved") return { label: "Approved", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" };
  if (s === "rejected") return { label: "Rejected", cls: "border-rose-200 bg-rose-50 text-rose-700" };
  if (s === "changes_requested") return { label: "Revise", cls: "border-amber-200 bg-amber-50 text-amber-800" };
  if (s === "on_hold") return { label: "On Hold", cls: "border-slate-200 bg-slate-50 text-slate-600" };
  return { label: s, cls: "border-slate-200 bg-white text-slate-600" };
}

function ProjectArtifactsInline({ projectRef, collapsed }: { projectRef: string; collapsed: boolean }) {
  const pathname = usePathname();

  const [data, setData] = useState<ArtifactSidebarPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    setData(null);

    fetch(`/api/projects/${encodeURIComponent(projectRef)}/artifacts/sidebar`, { cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as ArtifactSidebarPayload;
        if (!alive) return;
        if (!j?.ok) throw new Error(j?.error || "Failed to load artifacts");
        setData(j);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e?.message || "Failed to load artifacts");
      });

    return () => {
      alive = false;
    };
  }, [projectRef]);

  const items = useMemo(() => (Array.isArray(data?.items) ? data!.items : []), [data]);

  const visible = useMemo(() => items, [items]);

  // Split governance vs normal artifacts
  const artifactItems = useMemo(() => visible.filter((it) => !isGovernanceKey(it.ui_kind || it.key)), [visible]);
  const governanceItems = useMemo(() => visible.filter((it) => isGovernanceKey(it.ui_kind || it.key)), [visible]);

  const grouped = useMemo(() => {
    const out: Record<GroupName, ArtifactSidebarItem[]> = { Plan: [], Control: [], Close: [] };
    for (const it of artifactItems) {
      const kUpper = safeUpper(it.ui_kind || it.key);
      out[groupForKey(kUpper)].push(it);
    }
    return out;
  }, [artifactItems]);

  const activeHref = useMemo(() => String(pathname || ""), [pathname]);

  if (collapsed) {
    return (
      <div className="mx-2 mt-2">
        <Link
          href={`/projects/${projectRef}/artifacts`}
          className="flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 transition px-2 py-2"
          title="Artifacts"
        >
          <span className="text-[11px] font-extrabold text-slate-600">A</span>
        </Link>
      </div>
    );
  }

  const governanceFallbackHref = `/projects/${projectRef}/governance`;
  const showGovernanceFallback = governanceItems.length === 0;

  return (
    <div className="mx-2 mt-2 rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Artifacts</span>
          <Link
            href={`/projects/${projectRef}/artifacts/new`}
            className="text-[10px] font-bold text-sky-700 hover:text-sky-600"
            prefetch={false}
          >
            + New
          </Link>
        </div>

        {data?.projectName && <div className="mt-1 text-xs font-semibold text-slate-900 truncate">{data.projectName}</div>}

        <div className="mt-1 flex items-center gap-2">
          {data?.projectCode && (
            <code className="font-mono text-[10px] text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded">
              {data.projectCode}
            </code>
          )}
          {data?.role && <span className="text-[10px] font-semibold capitalize text-slate-500">{data.role}</span>}
        </div>

        <div className="mt-2 flex items-center gap-2">
          <Link
            href={`/projects/${projectRef}/artifacts`}
            className={cx(
              "text-xs font-medium px-2.5 py-1.5 rounded-lg border transition",
              activeHref.includes(`/projects/${projectRef}/artifacts`)
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
            prefetch={false}
          >
            Board
          </Link>
          <Link
            href={`/projects/${projectRef}/change`}
            className={cx(
              "text-xs font-medium px-2.5 py-1.5 rounded-lg border transition",
              activeHref.includes(`/projects/${projectRef}/change`)
                ? "border-sky-200 bg-sky-50 text-sky-700"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            )}
            prefetch={false}
          >
            Change
          </Link>
        </div>
      </div>

      <div className="px-2 py-2">
        {err && (
          <div className="px-2 py-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg">{err}</div>
        )}

        {!err && items.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-slate-500">No artifacts found</div>
        )}

        {/* Groups */}
        {(["Plan", "Control", "Close"] as const).map((g) => {
          const list = grouped[g];
          if (!list?.length) return null;

          const colour = g === "Plan" ? "text-sky-700" : g === "Control" ? "text-amber-700" : "text-rose-700";

          return (
            <div key={g} className="mb-2">
              <div className="px-2 pt-2 pb-1 flex items-center justify-between">
                <span className={cx("text-[10px] font-bold tracking-widest uppercase", colour)}>{g}</span>
                <span className="text-[10px] font-semibold text-slate-400 tabular-nums">{list.length}</span>
              </div>

              <div className="space-y-1">
                {list.map((it) => {
                  const kUpper = safeUpper(it.ui_kind || it.key);
                  const status = safeLower(it.current?.approval_status);
                  const badge = badgeForStatus(status);

                  const isActive =
                    activeHref === it.href ||
                    (it.current?.id && activeHref.includes(`/artifacts/${it.current.id}`)) ||
                    (isRaidKey(kUpper) && activeHref.includes(`/raid`)) ||
                    (isChangeKey(kUpper) && activeHref.includes(`/change`));

                  return (
                    <Link
                      key={it.key}
                      href={it.href}
                      prefetch={false}
                      className={cx(
                        "block rounded-lg border px-2.5 py-2 transition",
                        isActive ? "border-sky-200 bg-sky-50" : "border-transparent hover:bg-slate-50"
                      )}
                      title={it.label}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div
                            className={cx(
                              "text-xs font-semibold truncate",
                              it.current ? "text-slate-900" : "text-slate-600"
                            )}
                          >
                            {it.label}
                          </div>
                          <div className="mt-0.5 text-[10px] text-slate-500">
                            {it.current ? "Current" : it.canCreate ? "Not created" : "—"}
                            {it.current?.is_locked ? <span className="ml-1.5 text-slate-400">🔒</span> : null}
                          </div>
                        </div>
                        <span
                          className={cx(
                            "shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold",
                            badge.cls
                          )}
                        >
                          {it.current ? badge.label : it.canCreate ? "Create" : "View"}
                        </span>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}

        {/* ✅ Governance (Delivery Governance) — ALWAYS SHOW (fallback to /governance if API doesn't return a governance item) */}
        <div className="mt-2 pt-2 border-t border-slate-200">
          <div className="px-2 pb-1 flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Delivery governance</span>
            <span className="text-[10px] font-semibold text-slate-400 tabular-nums">
              {governanceItems.length ? governanceItems.length : 1}
            </span>
          </div>

          <div className="space-y-1">
            {(showGovernanceFallback
              ? [{ key: "__delivery_governance__", label: "Delivery Governance", href: governanceFallbackHref }]
              : governanceItems
            ).map((it: any) => {
              const href = safeStr(it?.href) || governanceFallbackHref;
              const label = safeStr(it?.label) || "Delivery Governance";
              const isActive = activeHref.includes(`/projects/${projectRef}/governance`);

              return (
                <Link
                  key={it.key}
                  href={href}
                  prefetch={false}
                  className={cx(
                    "block rounded-lg border px-2.5 py-2 transition",
                    isActive ? "border-sky-200 bg-sky-50" : "border-transparent hover:bg-slate-50"
                  )}
                >
                  <div className="text-xs font-semibold text-slate-900">{label}</div>
                  <div className="mt-0.5 text-[10px] text-slate-500">Hub</div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN SIDEBAR
============================================================================= */

const STORAGE_KEY = "aliena-sidebar-collapsed";

export default function Sidebar({
  userName,
  orgName,
  projectCount = 0,
}: {
  userName?: string | null;
  orgName?: string | null;
  projectCount?: number;
}) {
  const pathname = usePathname();
  const projectRef = getActiveProjectRef(pathname);

  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

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

  const projectBadge = projectCount > 0 ? String(projectCount) : undefined;

  const NAV_GROUPS: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { href: "/", label: "Overview", icon: Icons.dashboard, exact: true },
        { href: "/projects", label: "Projects", icon: Icons.projects, badge: projectBadge },
      ],
    },
    {
      label: "Resource",
      items: [
        { href: "/heatmap", label: "Heatmap", icon: Icons.heatmap },
        { href: "/allocations/new", label: "Allocate", icon: Icons.allocations },
        { href: "/capacity", label: "Leave / Cap", icon: Icons.leave },
        { href: "/timesheet", label: "Timesheet", icon: Icons.timesheet },
      ],
    },
    {
      label: "Team",
      items: [
        { href: "/people", label: "People", icon: Icons.people },
        { href: "/scenarios", label: "What-if", icon: Icons.scenarios },
      ],
    },
  ];

  const BOTTOM_ITEMS: NavItem[] = [{ href: "/settings", label: "Settings", icon: Icons.settings }];

  const w = mounted ? (collapsed ? "64px" : "220px") : "220px";

  return (
    <>
      <style>{`
        .sidebar-root {
          width: ${w};
          min-width: ${w};
          transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1),
                      min-width 0.22s cubic-bezier(0.4, 0, 0.2, 1);
        }
      `}</style>

      <aside
        className={cx(
          "sidebar-root h-screen flex flex-col sticky top-0",
          "bg-white border-r border-slate-200",
          "overflow-x-hidden"
        )}
        style={{ width: w, minWidth: w }}
      >
        {/* -- Logo + brand -- */}
        <div className={cx("flex items-center gap-3 px-4 border-b border-slate-200", "h-14 flex-shrink-0")}>
          {/* ✅ Replace old logo with Aliena logo */}
          <div className="flex-shrink-0">
            <div className="w-8 h-8 rounded-xl overflow-hidden ring-1 ring-slate-200 bg-white">
              <Image
                src={ALIENA_LOGO_URL}
                alt="Aliena"
                width={32}
                height={32}
                priority
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          {!collapsed && (
            <div className="min-w-0">
              {/* ✅ Replace any ResForce with ΛLIΞNΛ */}
              <div className="text-sm font-black tracking-tight text-slate-900 truncate">
                <AlienaWordmarkTop />
              </div>

              {orgName && <div className="text-[10px] text-slate-500 truncate font-medium">{orgName}</div>}
            </div>
          )}

          <button
            type="button"
            onClick={toggleCollapse}
            className={cx(
              "ml-auto flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center",
              "text-slate-500 hover:text-slate-900 hover:bg-slate-100",
              "transition-all duration-150"
            )}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? Icons.chevronRight : Icons.chevronLeft}
          </button>
        </div>

        {/* -- Search -- */}
        {!collapsed && <GlobalSearch />}

        {/* -- Scrollable nav -- */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-3 px-2 flex flex-col gap-1">
          {NAV_GROUPS.map((group) => (
            <SidebarGroup key={group.label} group={group} collapsed={collapsed} />
          ))}

          {/* Project context strip */}
          {projectRef && (
            <div className="mt-2">
              <ProjectContextStrip projectRef={projectRef} collapsed={collapsed} />
            </div>
          )}

          {/* ✅ MERGED: Artifacts sidebar content inside left sidebar */}
          {projectRef && <ProjectArtifactsInline projectRef={projectRef} collapsed={collapsed} />}
        </div>

        {/* -- Bottom: settings + user -- */}
        <div className={cx("flex-shrink-0 border-t border-slate-200 px-2 py-3", "flex flex-col gap-1")}>
          {BOTTOM_ITEMS.map((item) => (
            <SidebarItem key={item.href} item={item} collapsed={collapsed} />
          ))}

          <div className={cx("mt-1 flex items-center gap-3 px-3 py-2.5 rounded-xl", "bg-slate-50 border border-slate-200")}>
            <div
              className={cx(
                "flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center",
                "bg-sky-100 text-sky-700 text-xs font-black"
              )}
            >
              {(userName || "U").charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-900 truncate">{userName || "Account"}</div>
                <div className="text-[10px] text-slate-500 truncate">Signed in</div>
              </div>
            )}
            <button
              type="button"
              title="Sign out"
              onClick={async () => {
                const supabase = createClient();
                await supabase.auth.signOut();
                window.location.href = "/login";
              }}
              className={cx(
                "flex-shrink-0 w-6 h-6 rounded-lg flex items-center justify-center",
                "text-slate-400 hover:text-rose-600 hover:bg-rose-50",
                "transition-all duration-150"
              )}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}


