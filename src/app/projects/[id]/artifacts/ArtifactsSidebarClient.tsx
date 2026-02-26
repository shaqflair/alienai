// src/app/projects/[id]/artifacts/ArtifactsSidebarClient.tsx
// ✅ FINANCIAL_PLAN: added to Plan group, isFinancialKey helper
"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";

import { deleteDraftArtifact as deleteDraftArtifactAction } from "@/app/projects/[id]/artifacts/actions";

/* ═══════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════ */

export type SidebarItem = {
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

export type Role = "owner" | "editor" | "viewer" | "unknown";
export type GroupName = "Plan" | "Control" | "Close";

export type ArtifactsSidebarClientProps = {
  items: SidebarItem[];
  role: Role;
  projectId: string;
  projectHumanId?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
};

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeUpper(x: unknown) { return safeStr(x).trim().toUpperCase(); }
function safeLower(x: unknown) { return safeStr(x).trim().toLowerCase(); }
function normStatus(s: string | null | undefined) { return safeLower(s); }

function canonicalKeyUpper(it: Pick<SidebarItem, "ui_kind" | "key">) {
  return safeUpper(it.ui_kind || it.key);
}

function isChangeKey(kUpper: string) {
  const u = safeUpper(kUpper);
  return (
    u === "CHANGE" || u === "CHANGES" || u === "CHANGE_REQUEST" || u === "CHANGE_REQUESTS" ||
    u.includes("CHANGE_REQUEST") || (u.includes("CHANGE") && !u.includes("CHARTER"))
  );
}

function isRaidKey(kUpper: string) {
  const u = safeUpper(kUpper);
  return u === "RAID" || u === "RAID_LOG" || u.includes("RAID");
}

function isGovernanceKey(kUpper: string) {
  const u = safeUpper(kUpper);
  return (
    u === "DELIVERY_GOVERNANCE" || u === "GOVERNANCE" || u === "DELIVERYGOVERNANCE" ||
    u.includes("DELIVERY_GOVERNANCE") || u.includes("DELIVERY GOVERNANCE") || u.includes("GOVERNANCE_HUB")
  );
}

// ✅ NEW: financial plan key helper
function isFinancialKey(kUpper: string) {
  const u = safeUpper(kUpper);
  return u === "FINANCIAL_PLAN" || u === "FINANCIAL" || u.includes("FINANCIAL_PLAN");
}

function groupForKey(k: string): GroupName {
  const u = k.toUpperCase().trim();
  // ✅ FINANCIAL_PLAN in Plan group
  if (["PROJECT_CHARTER", "STAKEHOLDER_REGISTER", "WBS", "SCHEDULE", "FINANCIAL_PLAN", "WEEKLY_REPORT"].includes(u)) return "Plan";
  if (isRaidKey(u) || isChangeKey(u)) return "Control";
  return "Close";
}

function artifactIdFromPath(pathname: string | null | undefined) {
  return String(pathname ?? "").match(/\/artifacts\/([^\/\?#]+)/)?.[1] ?? null;
}

/* ═══════════════════════════════════════════════════════════════
   STATUS BADGE
═══════════════════════════════════════════════════════════════ */

type BadgeCfg = { label: string; cls: string };

function getBadge(status: string | null | undefined): BadgeCfg {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border";
  const s = normStatus(status);
  if (!s || s === "draft")             return { label: "Draft",     cls: `${base} border-neutral-200 text-neutral-600 bg-neutral-50` };
  if (s === "submitted")               return { label: "Submitted", cls: `${base} border-blue-200 text-blue-700 bg-blue-50` };
  if (s === "approved")                return { label: "Approved",  cls: `${base} border-green-200 text-green-700 bg-green-50` };
  if (s === "rejected")                return { label: "Rejected",  cls: `${base} border-red-200 text-red-700 bg-red-50` };
  if (s === "changes_requested")       return { label: "Revise",    cls: `${base} border-amber-200 text-amber-800 bg-amber-50` };
  if (s === "on_hold")                 return { label: "On Hold",   cls: `${base} border-neutral-300 text-neutral-600 bg-neutral-50` };
  return { label: s, cls: `${base} border-neutral-200 text-neutral-600 bg-white` };
}

/* ═══════════════════════════════════════════════════════════════
   ENHANCED ITEM TYPE
═══════════════════════════════════════════════════════════════ */

type EnhancedItem = SidebarItem & {
  openUrl: string;
  active: boolean;
  status: string;
  badge: BadgeCfg;
  keyUpper: string;
  isLocked: boolean;
  isDeleted: boolean;
  canDeleteDraft: boolean;
};

/* ═══════════════════════════════════════════════════════════════
   SUB-COMPONENTS
═══════════════════════════════════════════════════════════════ */

const ArtifactRow = React.memo(function ArtifactRow({
  it, idx, collapsed, rowRefs, onRowClick, onDeleteDraft, deleting,
}: {
  it: EnhancedItem; idx: number; collapsed: boolean;
  rowRefs: React.MutableRefObject<Array<HTMLAnchorElement | null>>;
  onRowClick: (id: string | undefined) => void;
  onDeleteDraft: (artifactId: string) => void;
  deleting: boolean;
}) {
  const rightBadge = it.current ? (
    <span className={it.badge.cls}>{it.badge.label}</span>
  ) : it.canCreate ? (
    <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600">Create</span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-400">View</span>
  );

  return (
    <div className={["rounded-lg", it.active ? "bg-neutral-100 ring-1 ring-neutral-200" : ""].filter(Boolean).join(" ")}>
      <Link
        ref={(el) => { rowRefs.current[idx] = el; }}
        href={it.openUrl}
        prefetch={false}
        onClick={() => onRowClick(it.current?.id)}
        aria-current={it.active ? "page" : undefined}
        title={collapsed ? it.label : undefined}
        className={[
          "block rounded-lg px-3 py-2.5 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-300",
          "transition-colors duration-100",
          collapsed ? "px-2 py-3" : "",
        ].join(" ")}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {!collapsed ? (
              <>
                <div className={["truncate text-sm font-medium", it.current ? "text-neutral-900" : "text-neutral-500"].join(" ")}>
                  {it.label}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-neutral-500">{it.current ? "Current" : it.canCreate ? "Not created" : "—"}</span>
                  {it.isLocked && <span className="text-[10px] text-neutral-400">🔒 Locked</span>}
                </div>
              </>
            ) : (
              <div className="h-7 w-7 rounded-md border border-neutral-200 bg-white flex items-center justify-center text-[10px] font-bold text-neutral-500">
                {it.label.charAt(0)}
              </div>
            )}
          </div>
          {!collapsed && (
            <div className="shrink-0 mt-0.5 flex items-center gap-2">
              {rightBadge}
              {it.canDeleteDraft && it.current?.id && (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDeleteDraft(it.current!.id); }}
                  title="Delete draft"
                  className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-neutral-200 bg-white text-neutral-500 hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50 transition disabled:opacity-50"
                  aria-label="Delete draft"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
        </div>
      </Link>
    </div>
  );
});

const GroupSection = React.memo(function GroupSection({
  name, groupItems, start, collapsed, groupOpen, toggleGroup, rowRefs, onRowClick, onDeleteDraft, deleting,
}: {
  name: GroupName; groupItems: EnhancedItem[]; start: number; collapsed: boolean;
  groupOpen: Record<GroupName, boolean>; toggleGroup: (g: GroupName) => void;
  rowRefs: React.MutableRefObject<Array<HTMLAnchorElement | null>>;
  onRowClick: (id: string | undefined) => void;
  onDeleteDraft: (artifactId: string) => void;
  deleting: boolean;
}) {
  const open = groupOpen[name];
  const count = groupItems.filter((x) => x.current?.id).length;
  if (groupItems.length === 0 && !collapsed) return null;

  const groupColors: Record<GroupName, string> = {
    Plan: "text-blue-600",
    Control: "text-amber-600",
    Close: "text-rose-600",
  };

  return (
    <div className="mb-2">
      {!collapsed && (
        <button type="button" onClick={() => toggleGroup(name)}
          className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs font-semibold text-neutral-600 hover:bg-neutral-100 transition-colors">
          <span className="flex items-center gap-2">
            <span className={`uppercase tracking-wide ${groupColors[name]}`}>{name}</span>
            <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-500 tabular-nums">
              {count}/{groupItems.length}
            </span>
          </span>
          <span className="text-neutral-400 font-mono">{open ? "−" : "+"}</span>
        </button>
      )}
      {open && (
        <div className="space-y-0.5">
          {groupItems.map((it, i) => (
            <ArtifactRow key={it.key} it={it} idx={start + i} collapsed={collapsed}
              rowRefs={rowRefs} onRowClick={onRowClick} onDeleteDraft={onDeleteDraft} deleting={deleting} />
          ))}
        </div>
      )}
      {collapsed && <div className="h-px bg-neutral-200 my-1.5 mx-2" />}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════
   INNER
═══════════════════════════════════════════════════════════════ */

function ArtifactsSidebarInner({ items, role, projectId, projectName, projectCode }: ArtifactsSidebarClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const newTypeRaw = searchParams?.get("type") ?? null;

  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const [storedId, setStoredId] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState<Record<GroupName, boolean>>({ Plan: true, Control: true, Close: true });
  const [isPending, startTransition] = useTransition();

  const rowRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const SKEY = `alienai:lastArtifact:${projectId}`;
  const GKEY = `alienai:artifactGroups:${projectId}`;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!mounted) return;
    try { const v = localStorage.getItem(SKEY); if (v) setStoredId(v); } catch {}
    try {
      const raw = localStorage.getItem(GKEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      setGroupOpen((prev) => ({
        Plan: typeof p?.Plan === "boolean" ? p.Plan : prev.Plan,
        Control: typeof p?.Control === "boolean" ? p.Control : prev.Control,
        Close: typeof p?.Close === "boolean" ? p.Close : prev.Close,
      }));
    } catch {}
  }, [mounted, SKEY, GKEY]);

  useEffect(() => {
    const id = artifactIdFromPath(pathname);
    if (!id || !mounted) return;
    try { localStorage.setItem(SKEY, id); setStoredId(id); } catch {}
  }, [mounted, pathname, SKEY]);

  useEffect(() => {
    if (!mounted) return;
    try { localStorage.setItem(GKEY, JSON.stringify(groupOpen)); } catch {}
  }, [mounted, GKEY, groupOpen]);

  const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  const itemsWithRequired = useMemo(() => {
    const canEdit = role === "owner" || role === "editor";
    const out = [...safeItems];

    const hasChange = out.some((it) => isChangeKey(canonicalKeyUpper(it)));
    if (!hasChange) {
      out.push({ key: "CHANGE", ui_kind: "CHANGE", label: "Change Requests", current: null, href: `/projects/${projectId}/change`, canCreate: canEdit, canEdit });
    }

    const hasGov = out.some((it) => isGovernanceKey(canonicalKeyUpper(it)));
    if (!hasGov) {
      out.push({ key: "DELIVERY_GOVERNANCE", ui_kind: "DELIVERY_GOVERNANCE", label: "Delivery Governance", current: null, href: `/projects/${projectId}/governance`, canCreate: false, canEdit: true });
    }

    return out;
  }, [safeItems, role, projectId]);

  const enhanced: EnhancedItem[] = useMemo(() => {
    const urlId = artifactIdFromPath(pathname);
    const activeId = urlId ?? (mounted ? storedId : null);
    const newType = safeUpper(newTypeRaw);

    return itemsWithRequired.map((it) => {
      const itKey = canonicalKeyUpper(it);
      const isGov = isGovernanceKey(itKey);
      const isFinancial = isFinancialKey(itKey);

      const active =
        (isGov && String(pathname ?? "").includes("/governance")) ||
        (it.current?.id != null && activeId != null && it.current.id === activeId) ||
        (!it.current && String(pathname ?? "").includes("/artifacts/new") && newType === itKey) ||
        (!it.current && isChangeKey(itKey) && String(pathname ?? "").includes("/change")) ||
        (!it.current && isRaidKey(itKey) && String(pathname ?? "").includes("/raid"));

      const status = normStatus(it.current?.approval_status);

      const openUrl =
        isGov
          ? `/projects/${projectId}/governance`
          : it.current?.id
            ? `/projects/${projectId}/artifacts/${it.current.id}`
            : isChangeKey(itKey)
              ? `/projects/${projectId}/change`
              : isRaidKey(itKey)
                ? `/projects/${projectId}/raid`
                : it.href || `/projects/${projectId}/artifacts`;

      const isLocked = Boolean(it.current?.is_locked);
      const isDeleted = Boolean(it.current?.deleted_at);
      const isDraft = !status || status === "draft";

      const canDeleteDraft =
        Boolean(it.current?.id) && it.canEdit && isDraft && !isLocked && !isDeleted &&
        !isChangeKey(itKey) && !isRaidKey(itKey) && !isGov;

      return { ...it, openUrl, active, status, badge: getBadge(status), keyUpper: itKey, isLocked, isDeleted, canDeleteDraft };
    });
  }, [itemsWithRequired, pathname, newTypeRaw, storedId, mounted, projectId]);

  const counts = useMemo(() => {
    let submitted = 0;
    for (const it of enhanced) {
      if (!it.current?.id) continue;
      const s = normStatus(it.current.approval_status);
      if (s && s !== "draft") submitted++;
    }
    return { submitted };
  }, [enhanced]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? enhanced.filter((it) => it.label.toLowerCase().includes(q)) : enhanced;
  }, [enhanced, query]);

  const governanceItems = useMemo(() => visible.filter((it) => isGovernanceKey(it.keyUpper)), [visible]);
  const artifactItems   = useMemo(() => visible.filter((it) => !isGovernanceKey(it.keyUpper)), [visible]);

  const grouped = useMemo(() => {
    const out: Record<GroupName, EnhancedItem[]> = { Plan: [], Control: [], Close: [] };
    for (const it of artifactItems) out[groupForKey(it.keyUpper)].push(it);
    return out;
  }, [artifactItems]);

  const flatArtifacts = useMemo(() => {
    const arr: EnhancedItem[] = [];
    (["Plan", "Control", "Close"] as const).forEach((g) => { if (groupOpen[g]) arr.push(...grouped[g]); });
    return arr;
  }, [grouped, groupOpen]);

  const flat = useMemo(() => [...flatArtifacts, ...governanceItems], [flatArtifacts, governanceItems]);

  const groupStarts = useMemo(() => {
    let i = 0;
    const s: Record<GroupName, number> = { Plan: 0, Control: 0, Close: 0 };
    (["Plan", "Control", "Close"] as const).forEach((g) => { s[g] = i; if (groupOpen[g]) i += grouped[g].length; });
    return s;
  }, [grouped, groupOpen]);

  const governanceStart = useMemo(() => flatArtifacts.length, [flatArtifacts.length]);

  useEffect(() => {
    const idx = flat.findIndex((x) => x.active);
    if (idx >= 0) setFocusIdx(idx);
  }, [flat]);

  useEffect(() => { rowRefs.current[focusIdx]?.focus?.(); }, [focusIdx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || (e.target as HTMLElement | null)?.isContentEditable;

      if (e.key === "Escape" && document.activeElement === searchRef.current) {
        e.preventDefault(); setQuery(""); searchRef.current?.blur(); return;
      }
      if (!typing && e.key === "/" && !collapsed) { e.preventDefault(); searchRef.current?.focus(); return; }
      if (typing) return;
      if (e.key === "[") { setCollapsed(true); return; }
      if (e.key === "]") { setCollapsed(false); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); setFocusIdx((i) => Math.min(i + 1, flat.length - 1)); return; }
      if (e.key === "ArrowUp")   { e.preventDefault(); setFocusIdx((i) => Math.max(i - 1, 0)); return; }
      if (e.key === "Home") { e.preventDefault(); setFocusIdx(0); return; }
      if (e.key === "End")  { e.preventDefault(); setFocusIdx(flat.length - 1); return; }
      if (e.key === "Enter") { rowRefs.current[focusIdx]?.click?.(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, flat.length, focusIdx]);

  const toggleGroup = useCallback((g: GroupName) => setGroupOpen((p) => ({ ...p, [g]: !p[g] })), []);

  const handleRowClick = useCallback((id: string | undefined) => {
    if (!id || !mounted) return;
    try { localStorage.setItem(SKEY, id); setStoredId(id); } catch {}
  }, [mounted, SKEY]);

  const onDeleteDraft = useCallback((artifactId: string) => {
    if (!artifactId) return;
    const ok = window.confirm("Delete this draft artifact? This cannot be undone.");
    if (!ok) return;
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("projectId", projectId);
        fd.set("artifactId", artifactId);
        const res = await deleteDraftArtifactAction(fd);
        if (!res?.ok) throw new Error(res?.error || "Delete failed");
        router.refresh();
      } catch (e: any) { alert(e?.message || "Delete failed"); }
    });
  }, [projectId, router, startTransition]);

  const initial = (safeStr(projectName).trim() || "P").charAt(0).toUpperCase();

  return (
    <aside
      aria-label="Artifact navigation"
      className={[
        "relative shrink-0 flex flex-col",
        "bg-white border-r border-neutral-200",
        "transition-[width] duration-300 ease-in-out",
        "h-screen sticky top-0 overflow-hidden",
      ].join(" ")}
      style={{ width: collapsed ? 64 : 304 }}
    >
      <div className="flex flex-col h-full">
        {/* HEADER */}
        <div className={["shrink-0 border-b border-neutral-200 transition-all duration-300", collapsed ? "px-2 py-3" : "px-4 pt-5 pb-4"].join(" ")}>
          {collapsed ? (
            <div className="flex flex-col items-center gap-2">
              <Link href={`/projects/${projectId}`} title={projectName ?? "Project"}
                className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-900 font-bold text-sm hover:bg-neutral-200 transition-all">
                {initial}
              </Link>
              <Link href={`/projects/${projectId}/artifacts`} title="Artifact Board"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 transition-all text-xs font-bold">
                ☰
              </Link>
              <Link href={`/projects/${projectId}/artifacts/new`} title="New Artifact"
                className="w-9 h-9 rounded-lg bg-neutral-900 text-white flex items-center justify-center hover:bg-neutral-800 transition-all text-sm font-bold">
                +
              </Link>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 mb-4">
                <Link href={`/projects/${projectId}`}
                  className="w-10 h-10 rounded-xl bg-neutral-100 border border-neutral-200 flex items-center justify-center text-neutral-900 font-bold text-sm hover:bg-neutral-200 transition-all shrink-0">
                  {initial}
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/projects/${projectId}`} prefetch={false} title={projectName ?? ""}
                    className="block text-sm font-semibold text-neutral-900 truncate hover:text-blue-600 transition-colors">
                    {safeStr(projectName).trim() || "Untitled Project"}
                  </Link>
                  <div className="flex items-center gap-2 mt-0.5">
                    {projectCode && (
                      <code className="font-mono text-[10px] text-neutral-500 bg-neutral-100 border border-neutral-200 px-1.5 py-0.5 rounded">
                        {projectCode}
                      </code>
                    )}
                    <span className={["text-[10px] font-semibold capitalize", role === "owner" ? "text-amber-600" : role === "editor" ? "text-blue-600" : "text-neutral-500"].join(" ")}>
                      {role}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 mb-2">
                <Link href={`/projects/${projectId}/artifacts`} prefetch={false}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-all">
                  Board
                </Link>
                <Link href={`/projects/${projectId}/artifacts/new`} prefetch={false}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-800 transition-all">
                  + New Artifact
                </Link>
              </div>

              {counts.submitted > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-blue-700">
                  <span>Submitted for review</span>
                  <span className="ml-auto font-bold tabular-nums">{counts.submitted}</span>
                </div>
              )}

              <div className="mt-2">
                <Link href={`/projects/${projectId}/change`}
                  className="inline-flex items-center px-2.5 py-1.5 rounded-lg border border-neutral-200 bg-white text-xs font-medium text-neutral-600 hover:bg-neutral-50 transition-all">
                  Change Requests board
                </Link>
              </div>
            </>
          )}
        </div>

        {/* COLLAPSE TOGGLE */}
        <button type="button" onClick={() => setCollapsed((v) => !v)}
          className="absolute top-4 -right-3 z-50 w-6 h-6 rounded-full bg-white border border-neutral-200 shadow-sm flex items-center justify-center text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 transition-all text-xs"
          aria-label={collapsed ? "Expand sidebar (])" : "Collapse sidebar ([)"}
          title={collapsed ? "Expand ]" : "Collapse ["}>
          {collapsed ? "›" : "‹"}
        </button>

        {/* SEARCH */}
        {!collapsed && (
          <div className="shrink-0 px-3 py-2.5 border-b border-neutral-200">
            <div className="relative">
              <input ref={searchRef} type="text" value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder="Search artifacts…  (/) " aria-label="Search artifacts"
                className="w-full px-3 py-2 rounded-lg border border-neutral-200 bg-white text-sm text-neutral-900 placeholder-neutral-400 outline-none focus:ring-2 focus:ring-neutral-300 focus:border-neutral-300 transition-all" />
              {query && (
                <button type="button" onClick={() => setQuery("")} aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors text-xs">
                  ✕
                </button>
              )}
            </div>
          </div>
        )}

        {/* NAV */}
        <nav aria-label="Artifact list"
          className={["flex-1 overflow-y-auto min-h-0", collapsed ? "px-1.5 py-2" : "px-3 py-3"].join(" ")}
          style={{ scrollbarWidth: "thin", scrollbarColor: "#e5e5e5 transparent" }}>
          {!collapsed && (
            <div className="flex items-center justify-between px-2 mb-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Artifacts</span>
              <span className="text-[10px] font-semibold text-neutral-400 tabular-nums">{artifactItems.length}</span>
            </div>
          )}

          {artifactItems.length === 0 && governanceItems.length === 0 ? (
            !collapsed && (
              <div className="px-2 py-8 text-center">
                <p className="text-sm text-neutral-500">No match</p>
                <button type="button" onClick={() => setQuery("")}
                  className="mt-1 text-xs text-blue-600 hover:text-blue-500 font-medium transition-colors">
                  Clear search
                </button>
              </div>
            )
          ) : (
            <>
              <GroupSection name="Plan" groupItems={grouped.Plan} start={groupStarts.Plan}
                collapsed={collapsed} groupOpen={groupOpen} toggleGroup={toggleGroup}
                rowRefs={rowRefs} onRowClick={handleRowClick} onDeleteDraft={onDeleteDraft} deleting={isPending} />
              <GroupSection name="Control" groupItems={grouped.Control} start={groupStarts.Control}
                collapsed={collapsed} groupOpen={groupOpen} toggleGroup={toggleGroup}
                rowRefs={rowRefs} onRowClick={handleRowClick} onDeleteDraft={onDeleteDraft} deleting={isPending} />
              <GroupSection name="Close" groupItems={grouped.Close} start={groupStarts.Close}
                collapsed={collapsed} groupOpen={groupOpen} toggleGroup={toggleGroup}
                rowRefs={rowRefs} onRowClick={handleRowClick} onDeleteDraft={onDeleteDraft} deleting={isPending} />

              {/* GOVERNANCE */}
              {governanceItems.length > 0 && (
                <div className={collapsed ? "mt-1" : "mt-3"}>
                  {!collapsed && (
                    <div className="px-2 mb-2">
                      <div className="h-px bg-neutral-200 mb-2" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">Governance</span>
                    </div>
                  )}
                  <div className="space-y-0.5">
                    {governanceItems.map((it, i) => (
                      <ArtifactRow key={it.key} it={it} idx={governanceStart + i} collapsed={collapsed}
                        rowRefs={rowRefs} onRowClick={handleRowClick} onDeleteDraft={onDeleteDraft} deleting={isPending} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </nav>

        {/* FOOTER */}
        {!collapsed && (
          <div className="shrink-0 border-t border-neutral-200 px-4 py-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-neutral-400">AlienAI</span>
              <span className="text-[9px] font-mono text-neutral-400 hidden lg:block">↑↓ · / · [ ]</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC WRAPPER
═══════════════════════════════════════════════════════════════ */

function SidebarSkeleton() {
  return (
    <aside aria-label="Loading sidebar"
      className="relative shrink-0 flex flex-col bg-white border-r border-neutral-200 h-screen sticky top-0 overflow-hidden"
      style={{ width: 304 }}>
      <div className="px-4 pt-5 pb-4 border-b border-neutral-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-neutral-100 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 bg-neutral-100 rounded animate-pulse" />
            <div className="h-2 w-16 bg-neutral-100 rounded animate-pulse" />
          </div>
        </div>
      </div>
      <div className="flex-1 px-3 py-3 space-y-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-12 bg-neutral-50 rounded-lg animate-pulse" />
        ))}
      </div>
    </aside>
  );
}

function ArtifactsSidebarClientImpl(props: ArtifactsSidebarClientProps) {
  return (
    <Suspense fallback={<SidebarSkeleton />}>
      <ArtifactsSidebarInner {...props} />
    </Suspense>
  );
}

export default ArtifactsSidebarClientImpl;
export const ArtifactsSidebarClient = ArtifactsSidebarClientImpl;