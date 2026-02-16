// src/app/projects/[id]/artifacts/ArtifactsSidebarClient.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";

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
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border";

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
 * ✅ Align sidebar grouping with your Board’s sections:
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
    ].includes(k)
  )
    return "Plan";

  if (["RAID", "CHANGE_REQUESTS"].includes(k)) return "Control";

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
  projectId, // UUID
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

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Storage key can be human or uuid – used only for localStorage
  const projectKey = useMemo(
    () => pickProjectKey(projectHumanId, projectId),
    [projectHumanId, projectId]
  );

  // ✅ Route id MUST be human id (or code) for URLs
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

  // ✅ Board links (Create / Draft / Submitted) — adjust keys here if needed
  function boardHref(view: "create" | "draft" | "submitted") {
    return `/projects/${projectRouteId}/board?view=${view}`;
  }

  const enhanced = useMemo(() => {
    const urlArtifactId = safeArtifactIdFromPath(pathname);
    const activeId = urlArtifactId ?? (mounted ? storedArtifactId : null);
    const newType = safeUpper(newTypeRaw);

    return items.map((it) => {
      const itKey = safeUpper(it.key);

      const active =
        (it.current?.id && activeId && it.current.id === activeId) ||
        (!it.current && String(pathname ?? "").includes("/artifacts/new") && newType === itKey);

      const status = normStatus(it.current?.approval_status);
      const b = badge(status);

      // ✅ ensure href uses human route id even if server sends UUID route
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

  // ✅ Counts for the Board quick filters
  const boardCounts = useMemo(() => {
    let create = 0;
    let draft = 0;
    let submitted = 0;

    for (const it of enhanced) {
      // Create = "canCreate" (we want this visible regardless of current state)
      if (it.canCreate) create++;

      const s = normStatus(it.current?.approval_status);
      if (it.current?.id) {
        if (!s || s === "draft") draft++;
        else if (s === "submitted" || s === "in_review" || s === "review" || s === "pending")
          submitted++;
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
      const g = groupForKey(String((it as any).keyUpper ?? it.key).toUpperCase()) as
        | "Plan"
        | "Control"
        | "Close";
      out[g].push(it);
    }
    return out;
  }, [visible]);

  const groupStorageKey = `alienai:artifactGroups:${projectKey}`;
  const [groupOpen, setGroupOpen] = useState<{
    Plan: boolean;
    Control: boolean;
    Close: boolean;
  }>({
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
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement | null)?.isContentEditable === true;

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
    const openUrl = it.current?.id
      ? `/projects/${projectRouteId}/artifacts/${it.current!.id}`
      : it.href;

    const rightStatus = it.current ? (
      <span className={it.badge.cls}>{it.badge.text}</span>
    ) : it.canCreate ? (
      <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-700">
        Create
      </span>
    ) : (
      <span className="inline-flex items-center rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-400">
        View
      </span>
    );

    const wrapClass = [
      "rounded-md group",
      it.active ? "bg-neutral-100 ring-1 ring-neutral-200" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <div className={wrapClass}>
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
            "block rounded-md px-2 py-2 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-300",
            collapsed ? "px-2 py-3" : "",
          ].join(" ")}
          aria-current={it.active ? "page" : undefined}
          title={collapsed ? it.label : undefined}
          prefetch={false}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {!collapsed ? (
                <>
                  <div className="truncate text-sm font-medium text-neutral-900">{it.label}</div>
                  <div className="truncate text-xs text-neutral-500">
                    {it.current ? "Current" : it.canCreate ? "Not created" : "—"}
                  </div>
                </>
              ) : (
                <div className="h-6 w-6 rounded-md border border-neutral-200 bg-white" />
              )}
            </div>

            {!collapsed && <div className="shrink-0">{rightStatus}</div>}
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
      className={["border-r border-neutral-200 p-3", collapsed ? "w-16" : "w-80"].join(" ")}
      aria-label="Artifacts sidebar"
    >
      {/* Project header */}
      <div className="mb-3 rounded-xl border border-neutral-200 bg-white p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-neutral-500">
              {collapsed ? "P" : "Project"}
            </div>

            {!collapsed && (
              <>
                <Link
                  href={`/projects/${projectRouteId}`}
                  className="block truncate text-sm font-semibold text-neutral-900 hover:underline"
                  title={projectName ?? ""}
                  prefetch={false}
                >
                  {projectName?.trim() || "Untitled project"}
                </Link>

                {projectCode ? (
                  <div className="mt-0.5 truncate font-mono text-[11px] text-neutral-500">
                    ID: {projectCode}
                  </div>
                ) : null}

                <div className="mt-1 text-xs text-neutral-500 capitalize">Role: {role}</div>

                {/* ✅ Board (correct route) + Create/Draft/Submitted shortcuts */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Link
                    href={`/projects/${projectRouteId}/board`}
                    className="inline-flex items-center rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                    title="Open Board"
                    prefetch={false}
                  >
                    Board
                  </Link>

                  <Link
                    href={boardHref("create")}
                    className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                    prefetch={false}
                  >
                    Create
                    <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                      {boardCounts.create}
                    </span>
                  </Link>

                  <Link
                    href={boardHref("draft")}
                    className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                    prefetch={false}
                  >
                    Draft
                    <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                      {boardCounts.draft}
                    </span>
                  </Link>

                  <Link
                    href={boardHref("submitted")}
                    className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-100"
                    prefetch={false}
                  >
                    Submitted
                    <span className="rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-600">
                      {boardCounts.submitted}
                    </span>
                  </Link>
                </div>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="shrink-0 rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand (])" : "Collapse ([)"}
          >
            {collapsed ? "›" : "‹"}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="mb-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search artifacts…  (/)"
              className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-300"
            />
          </div>
        </div>
      )}

      <nav aria-label="Artifact navigation">
        <Group name="Plan" itemsInGroup={grouped.Plan} startIndex={groupStarts.Plan} />
        <Group name="Control" itemsInGroup={grouped.Control} startIndex={groupStarts.Control} />
        <Group name="Close" itemsInGroup={grouped.Close} startIndex={groupStarts.Close} />
      </nav>

      {!collapsed && (
        <div className="mt-3 text-[11px] text-neutral-500">
          Keyboard: ↑/↓ move, Enter open, / search, Esc close/clear, [ collapse, ] expand
        </div>
      )}
    </aside>
  );
}
