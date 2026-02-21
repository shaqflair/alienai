// src/app/projects/[id]/artifacts/ArtifactsSidebarClient.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { 
  ChevronLeft, 
  ChevronRight, 
  LayoutGrid, 
  Plus, 
  FileText,
  FolderOpen,
  CheckCircle2
} from "lucide-react";

/* =======================
   Types
======================= */

type SidebarItem = {
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

type Role = "owner" | "editor" | "viewer" | "unknown";

/* =======================
   Utils
======================= */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeUpper(x: unknown) {
  return safeStr(x).trim().toUpperCase();
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function normStatus(s: string | null | undefined) {
  return safeLower(s);
}

function badge(status: string | null | undefined) {
  const s = normStatus(status);
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border";

  if (!s || s === "draft")
    return { text: "Draft", cls: `${base} border-neutral-200 text-neutral-700 bg-white` };
  if (s === "submitted")
    return { text: "Submitted", cls: `${base} border-blue-200 text-blue-700 bg-blue-50` };
  if (s === "approved")
    return { text: "Approved", cls: `${base} border-green-200 text-green-700 bg-green-50` };
  if (s === "rejected")
    return { text: "Rejected", cls: `${base} border-red-200 text-red-700 bg-red-50` };
  if (s === "changes_requested")
    return { text: "Changes", cls: `${base} border-amber-200 text-amber-800 bg-amber-50` };
  if (s === "on_hold")
    return { text: "On hold", cls: `${base} border-neutral-300 text-neutral-700 bg-neutral-50` };

  return { text: s, cls: `${base} border-neutral-200 text-neutral-700 bg-white` };
}

function safeArtifactIdFromPath(pathname: string | null | undefined) {
  const m = String(pathname ?? "").match(/\/artifacts\/([^\/\?#]+)/);
  return m?.[1] ?? null;
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function pickProjectKey(projectHumanId?: string | null, projectId?: string | null) {
  const human = String(projectHumanId ?? "").trim();
  if (human && !looksLikeUuid(human)) return human;

  const pid = String(projectId ?? "").trim();
  return pid || human || "";
}

/**
 * Canonical key for comparisons/grouping.
 * Prefer ui_kind (usually canonical system type), fallback to key.
 */
function canonicalKeyUpper(it: Pick<SidebarItem, "ui_kind" | "key">) {
  return safeUpper(it.ui_kind || it.key);
}

/**
 * ✅ Align sidebar grouping with your Board's sections:
 * - Initiating + Planning => Plan
 * - Monitoring & Controlling => Control
 * - Closing => Close
 */
function groupForKey(keyUpper: string) {
  const k = String(keyUpper || "").toUpperCase().trim();

  if (
    [
      "PROJECT_CHARTER",
      "STAKEHOLDER_REGISTER",
      "WBS",
      "SCHEDULE",
      "DESIGN",
      "REQUIREMENTS",
      "WEEKLY_REPORT",
    ].includes(k)
  )
    return "Plan";

  if (["RAID", "CHANGE", "CHANGE_REQUESTS"].includes(k)) return "Control";

  if (["LESSONS_LEARNED", "PROJECT_CLOSURE_REPORT"].includes(k)) return "Close";

  return "Close";
}

/**
 * ✅ Ensure all links use the human route id, even if server accidentally
 * sends UUID-based links.
 */
function normalizeProjectHref(href: string, projectId: string, projectRouteId: string) {
  const raw = safeStr(href).trim();
  if (!raw) return raw;
  if (!projectId || !projectRouteId) return raw;

  const needle = `/projects/${projectId}/`;
  const repl = `/projects/${projectRouteId}/`;
  if (raw.includes(needle)) return raw.replace(needle, repl);

  return raw;
}

/* =======================
   Component
======================= */

export default function ArtifactsSidebarClient({
  items,
  role,
  projectId,
  projectHumanId,
  projectName,
  projectCode,
}: {
  items: SidebarItem[];
  role: Role;
  projectId: string;
  projectHumanId?: string | null;
  projectName?: string | null;
  projectCode?: string | null;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const newTypeRaw = search.get("type");

  const [collapsed, setCollapsed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const projectKey = useMemo(() => pickProjectKey(projectHumanId, projectId), [projectHumanId, projectId]);
  const projectRouteId = useMemo(() => {
    const h = String(projectHumanId ?? "").trim();
    const c = String(projectCode ?? "").trim();
    return (h && !looksLikeUuid(h) ? h : "") || (c && !looksLikeUuid(c) ? c : "") || projectKey;
  }, [projectHumanId, projectCode, projectKey]);

  const storageKey = `alienai:lastArtifact:${projectKey}`;
  const [storedArtifactId, setStoredArtifactId] = useState<string | null>(null);

  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);

  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!mounted) return;
    try {
      const v = localStorage.getItem(storageKey);
      if (v) setStoredArtifactId(v);
    } catch {}
  }, [mounted, storageKey]);

  useEffect(() => {
    const id = safeArtifactIdFromPath(pathname);
    if (!id || !mounted) return;
    try {
      localStorage.setItem(storageKey, id);
      setStoredArtifactId(id);
    } catch {}
  }, [mounted, pathname, storageKey]);

  function boardHref(view: "create" | "draft" | "submitted") {
    return `/projects/${projectRouteId}/board?view=${view}`;
  }

  const enhanced = useMemo(() => {
    const urlArtifactId = safeArtifactIdFromPath(pathname);
    const activeId = urlArtifactId ?? (mounted ? storedArtifactId : null);
    const newType = safeUpper(newTypeRaw);

    return items.map((it) => {
      const itKey = canonicalKeyUpper(it);
      const active =
        (it.current?.id && activeId && it.current.id === activeId) ||
        (!it.current && String(pathname ?? "").includes("/artifacts/new") && newType === itKey);

      const status = normStatus(it.current?.approval_status);
      const b = badge(status);
      const hrefFixed = normalizeProjectHref(it.href, projectId, projectRouteId);

      return {
        ...it,
        href: hrefFixed,
        active,
        status,
        badge: b,
        keyUpper: itKey,
      };
    });
  }, [items, pathname, newTypeRaw, storedArtifactId, mounted, projectId, projectRouteId]);

  const boardCounts = useMemo(() => {
    let create = 0;
    let draft = 0;
    let submitted = 0;

    for (const it of enhanced) {
      if (it.canCreate) create++;

      const s = normStatus(it.current?.approval_status);
      if (it.current?.id) {
        if (!s || s === "draft") draft++;
        else if (s === "submitted" || s === "in_review" || s === "review" || s === "pending") submitted++;
        else if (s === "approved" || s === "rejected" || s === "changes_requested") submitted++;
      }
    }

    return { create, draft, submitted };
  }, [enhanced]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return enhanced;
    return enhanced.filter((it) => {
      const a = String(it.label ?? "").toLowerCase();
      return a.includes(q);
    });
  }, [enhanced, query]);

  const grouped = useMemo(() => {
    const out: Record<"Plan" | "Control" | "Close", any[]> = {
      Plan: [],
      Control: [],
      Close: [],
    };
    for (const it of visible) {
      const g = groupForKey(String((it as any).keyUpper ?? it.key).toUpperCase().trim()) as
        | "Plan"
        | "Control"
        | "Close";
      out[g].push(it);
    }
    return out;
  }, [visible]);

  const groupStorageKey = `alienai:artifactGroups:${projectKey}`;
  const [groupOpen, setGroupOpen] = useState<{ Plan: boolean; Control: boolean; Close: boolean }>({
    Plan: true,
    Control: true,
    Close: true,
  });

  useEffect(() => {
    if (!mounted) return;
    try {
      const raw = localStorage.getItem(groupStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      setGroupOpen((prev) => ({
        Plan: typeof parsed?.Plan === "boolean" ? parsed.Plan : prev.Plan,
        Control: typeof parsed?.Control === "boolean" ? parsed.Control : prev.Control,
        Close: typeof parsed?.Close === "boolean" ? parsed.Close : prev.Close,
      }));
    } catch {}
  }, [mounted, groupStorageKey]);

  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(groupStorageKey, JSON.stringify(groupOpen));
    } catch {}
  }, [mounted, groupStorageKey, groupOpen]);

  const flatForKeys = useMemo(() => {
    const arr: any[] = [];
    (["Plan", "Control", "Close"] as const).forEach((g) => {
      if (!groupOpen[g]) return;
      arr.push(...grouped[g]);
    });
    return arr;
  }, [grouped, groupOpen]);

  useEffect(() => {
    const idx = flatForKeys.findIndex((x) => x.active);
    if (idx >= 0) setFocusedIndex(idx);
  }, [flatForKeys]);

  useEffect(() => {
    const el = refs.current[focusedIndex];
    if (el) el.focus();
  }, [focusedIndex]);

  function toggleGroup(g: "Plan" | "Control" | "Close") {
    setGroupOpen((prev) => ({ ...prev, [g]: !prev[g] }));
  }

  // Keyboard controls
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      const isTyping =
        tag === "input" || tag === "textarea" || (e.target as HTMLElement | null)?.isContentEditable === true;

      if (e.key === "Escape") {
        if (document.activeElement === searchRef.current) {
          e.preventDefault();
          setQuery("");
          searchRef.current?.blur();
          return;
        }
      }

      if (!isTyping && e.key === "/") {
        if (!collapsed) {
          e.preventDefault();
          searchRef.current?.focus();
        }
        return;
      }

      if (isTyping) return;

      if (e.key === "[") {
        setCollapsed(true);
        return;
      }
      if (e.key === "]") {
        setCollapsed(false);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, flatForKeys.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setFocusedIndex(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setFocusedIndex(flatForKeys.length - 1);
        return;
      }

      if (e.key === "Enter") {
        const el = refs.current[focusedIndex];
        if (el) el.click();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapsed, flatForKeys.length, focusedIndex]);

  function Group({
    name,
    itemsInGroup,
    startIndex,
  }: {
    name: "Plan" | "Control" | "Close";
    itemsInGroup: any[];
    startIndex: number;
  }) {
    const open = groupOpen[name];
    const count = itemsInGroup.filter((x) => Boolean(x.current?.id)).length;

    return (
      <div className="mb-2">
        {!collapsed && (
          <button
            type="button"
            onClick={() => toggleGroup(name)}
            className="mb-1 flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs font-semibold text-neutral-600 hover:bg-neutral-100"
            title={open ? "Collapse group" : "Expand group"}
          >
            <span className="flex items-center gap-2">
              <span className="uppercase tracking-wide">{name}</span>
              <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                {count}
              </span>
            </span>
            <span className="text-neutral-400">{open ? "–" : "+"}</span>
          </button>
        )}

        {open && (
          <div className="space-y-1">
            {itemsInGroup.map((it, i) => (
              <Row key={it.key} it={it} idx={startIndex + i} />
            ))}
          </div>
        )}
      </div>
    );
  }

  function Row({ it, idx }: { it: any; idx: number }) {
    const openUrl = it.current?.id ? `/projects/${projectRouteId}/artifacts/${it.current!.id}` : it.href;

    return (
      <div className={[
        "relative rounded-xl transition-all duration-200",
        it.active 
          ? "bg-indigo-50 border border-indigo-200 shadow-sm" 
          : "bg-white border border-transparent hover:border-neutral-200 hover:bg-neutral-50/80"
      ].join(" ")}>
        {/* Current Indicator - Left Border */}
        {it.active && !collapsed && (
          <div className="absolute -left-px top-1/2 -translate-y-1/2 w-1 h-8 bg-indigo-500 rounded-r-full" />
        )}

        <Link
          ref={(el) => {
            refs.current[idx] = el;
          }}
          href={openUrl}
          onClick={() => {
            if (!mounted) return;
            if (it.current?.id) {
              try {
                localStorage.setItem(storageKey, it.current.id);
                setStoredArtifactId(it.current.id);
              } catch {}
            }
          }}
          className={[
            "block rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-300",
            collapsed ? "p-2" : "px-3 py-2.5"
          ].join(" ")}
          aria-current={it.active ? "page" : undefined}
          title={collapsed ? it.label : undefined}
          prefetch={false}
        >
          <div className="flex items-center gap-3">
            {/* Icon */}
            <div className={[
              "shrink-0 rounded-lg flex items-center justify-center transition-colors",
              it.active 
                ? "bg-indigo-100 text-indigo-600" 
                : "bg-neutral-100 text-neutral-500",
              collapsed ? "w-8 h-8" : "w-9 h-9"
            ].join(" ")}>
              {it.active ? (
                <CheckCircle2 className={collapsed ? "w-4 h-4" : "w-5 h-5"} />
              ) : it.current ? (
                <FileText className={collapsed ? "w-4 h-4" : "w-5 h-5"} />
              ) : (
                <Plus className={collapsed ? "w-4 h-4" : "w-5 h-5"} />
              )}
            </div>

            {/* Content */}
            {!collapsed && (
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={[
                    "text-sm font-medium truncate",
                    it.active ? "text-indigo-900" : "text-neutral-900"
                  ].join(" ")}>
                    {it.label}
                  </span>
                  
                  {/* Current Badge */}
                  {it.active && (
                    <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700 uppercase tracking-wider">
                      <CheckCircle2 className="w-3 h-3" />
                      Current
                    </span>
                  )}
                </div>
                
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] text-neutral-500 font-mono">
                    {it.current ? "Current" : it.canCreate ? "Not created" : "View only"}
                  </span>
                  
                  {/* Status Badge */}
                  {it.current && (
                    <span className={it.badge.cls}>
                      {it.badge.text}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Collapsed Current Indicator Dot */}
            {collapsed && it.active && (
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-indigo-500 rounded-full border-2 border-white" />
            )}
          </div>
        </Link>
      </div>
    );
  }

  const groupStarts = useMemo(() => {
    let idx = 0;
    const starts: Record<"Plan" | "Control" | "Close", number> = {
      Plan: 0,
      Control: 0,
      Close: 0,
    };
    (["Plan", "Control", "Close"] as const).forEach((g) => {
      starts[g] = idx;
      if (groupOpen[g]) idx += grouped[g].length;
    });
    return starts;
  }, [grouped, groupOpen]);

  return (
    <aside 
      className={[
        "relative shrink-0 bg-white border-r border-neutral-200/80 transition-all duration-300 ease-in-out h-screen sticky top-0",
        collapsed ? "w-[60px]" : "w-80"
      ].join(" ")} 
      aria-label="Artifacts sidebar"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Collapse Toggle Button - Floating Arrow */}
      <button
        type="button"
        onClick={() => setCollapsed(v => !v)}
        className={[
          "absolute -right-3 top-6 z-50",
          "w-6 h-6 rounded-full bg-white border border-neutral-200",
          "shadow-sm hover:shadow-md hover:border-neutral-300",
          "flex items-center justify-center",
          "transition-all duration-200",
          (isHovered || collapsed) ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"
        ].join(" ")}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={collapsed ? "Expand (])" : "Collapse ([)"}
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-neutral-600" />
        ) : (
          <ChevronLeft className="w-3 h-3 text-neutral-600" />
        )}
      </button>

      {/* Project header */}
      <div className={[
        "border-b border-neutral-200/80 transition-all duration-300",
        collapsed ? "p-3" : "p-4"
      ].join(" ")}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {/* Collapsed: Just Project Initial */}
            <div className={[
              "transition-all duration-300 flex justify-center",
              collapsed ? "opacity-100" : "opacity-0 h-0 overflow-hidden"
            ].join(" ")}>
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm shadow-sm">
                {projectName?.charAt(0).toUpperCase() || "P"}
              </div>
            </div>

            {/* Expanded: Full Project Info */}
            <div className={[
              "transition-all duration-300",
              collapsed ? "opacity-0 h-0 overflow-hidden" : "opacity-100"
            ].join(" ")}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-1">
                Project
              </div>
              
              <Link
                href={`/projects/${projectRouteId}`}
                className="block truncate text-sm font-bold text-neutral-900 hover:text-indigo-600 transition-colors"
                title={projectName ?? ""}
                prefetch={false}
              >
                {projectName?.trim() || "Untitled project"}
              </Link>

              {projectCode && (
                <code className="mt-1 block truncate font-mono text-[11px] text-neutral-500 bg-neutral-100 px-1.5 py-0.5 rounded w-fit">
                  {projectCode}
                </code>
              )}

              <div className="mt-2 text-xs text-neutral-500 capitalize flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                {role}
              </div>

              {/* Action Buttons */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href={`/projects/${projectRouteId}/board`}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 hover:border-neutral-300 transition-all"
                  title="Open Board"
                  prefetch={false}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Board
                </Link>

                <Link
                  href={boardHref("create")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-all"
                  prefetch={false}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Create
                  <span className="ml-1 rounded-full bg-neutral-100 px-1.5 py-0 text-[10px]">
                    {boardCounts.create}
                  </span>
                </Link>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Link
                  href={boardHref("draft")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-all"
                  prefetch={false}
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Draft
                  <span className="ml-1 rounded-full bg-neutral-100 px-1.5 py-0 text-[10px]">
                    {boardCounts.draft}
                  </span>
                </Link>

                <Link
                  href={boardHref("submitted")}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-all"
                  prefetch={false}
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Submitted
                  <span className="ml-1 rounded-full bg-neutral-100 px-1.5 py-0 text-[10px]">
                    {boardCounts.submitted}
                  </span>
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Collapsed Action Icons */}
        <div className={[
          "flex flex-col gap-2 mt-2 transition-all duration-300",
          collapsed ? "opacity-100" : "opacity-0 h-0 overflow-hidden"
        ].join(" ")}>
          <Link
            href={`/projects/${projectRouteId}/board`}
            className="w-10 h-10 mx-auto rounded-lg bg-white border border-neutral-200 flex items-center justify-center text-neutral-600 hover:bg-neutral-50 hover:border-neutral-300 transition-all"
            title="Board"
          >
            <LayoutGrid className="w-4 h-4" />
          </Link>
          <Link
            href={boardHref("create")}
            className="w-10 h-10 mx-auto rounded-lg bg-indigo-50 border border-indigo-200 flex items-center justify-center text-indigo-600 hover:bg-indigo-100 transition-all"
            title="Create"
          >
            <Plus className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="p-4 border-b border-neutral-200/80">
          <div className="relative">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artifacts…  (/)"
              className="w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all"
            />
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className={[
        "overflow-y-auto transition-all duration-300",
        collapsed ? "p-2 h-[calc(100vh-120px)]" : "p-4 h-[calc(100vh-280px)]"
      ].join(" ")}>
        {!collapsed && (
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-neutral-400">
              Artifacts
            </h3>
            <span className="text-[10px] text-neutral-400 bg-neutral-100 px-2 py-0.5 rounded-full">
              {visible.length}
            </span>
          </div>
        )}

        <nav aria-label="Artifact navigation">
          <Group name="Plan" itemsInGroup={grouped.Plan} startIndex={groupStarts.Plan} />
          <Group name="Control" itemsInGroup={grouped.Control} startIndex={groupStarts.Control} />
          <Group name="Close" itemsInGroup={grouped.Close} startIndex={groupStarts.Close} />
        </nav>
      </div>

      {/* Bottom Gradient */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />

      {/* Keyboard Help */}
      {!collapsed && (
        <div className="absolute bottom-2 left-4 right-4 text-[10px] text-neutral-400 text-center">
          <span className="hidden lg:inline">↑↓ navigate · Enter open · / search · [ ] collapse</span>
        </div>
      )}
    </aside>
  );
}