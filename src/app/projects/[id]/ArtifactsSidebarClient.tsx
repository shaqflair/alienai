"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";

type SidebarItem = {
  key: string;
  label: string;
  ui_kind: string;
  current: null | {
    id: string;
    title: string | null;
    approval_status: string;
    is_locked?: boolean | null;
  };
  href: string;
  canCreate: boolean;
  canEdit: boolean;
};

function normStatus(s: string | null | undefined) {
  return String(s ?? "").toLowerCase();
}

function statusDotClass(status: string) {
  if (status === "approved") return "bg-green-500";
  if (status === "submitted") return "bg-blue-500";
  if (status === "rejected") return "bg-red-500";
  if (status === "changes_requested") return "bg-amber-500";
  if (status === "on_hold") return "bg-neutral-400";
  return "bg-neutral-300"; // draft/unknown
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

export default function ArtifactsSidebarClient({
  items,
  role,
  projectId,
}: {
  items: SidebarItem[];
  role: "owner" | "editor" | "viewer" | "unknown";
  projectId: string;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const newType = search.get("type");

  const [collapsed, setCollapsed] = useState(false);

  // Persisted selection (per project)
  const storageKey = `alienai:lastArtifact:${projectId}`;
  const [storedArtifactId, setStoredArtifactId] = useState<string | null>(null);

  // Keyboard navigation state
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const refs = useRef<Array<HTMLAnchorElement | null>>([]);

  // Read persisted selection on mount
  useEffect(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v) setStoredArtifactId(v);
    } catch {
      // ignore
    }
  }, [storageKey]);

  // Persist selection when URL is /artifacts/:artifactId
  useEffect(() => {
    const m = pathname?.match(/\/artifacts\/([^\/\?#]+)/);
    const id = m?.[1] ?? null;
    if (!id) return;

    try {
      localStorage.setItem(storageKey, id);
      setStoredArtifactId(id);
    } catch {
      // ignore
    }
  }, [pathname, storageKey]);

  const enhanced = useMemo(() => {
    const urlArtifactMatch = pathname?.match(/\/artifacts\/([^\/\?#]+)/);
    const urlArtifactId = urlArtifactMatch?.[1] ?? null;

    // If we're not on an artifact page (members/settings), highlight last selected artifact
    const activeId = urlArtifactId ?? storedArtifactId;

    return items.map((it) => {
      const active =
        (it.current?.id && activeId && it.current.id === activeId) ||
        (!it.current && pathname?.includes(`/artifacts/new`) && newType === it.key);

      const status = normStatus(it.current?.approval_status);
      const b = badge(status);
      const dot = statusDotClass(status);

      return { ...it, active, status, badge: b, dot };
    });
  }, [items, pathname, newType, storedArtifactId]);

  // Set initial focus index to active item (if any)
  useEffect(() => {
    const idx = enhanced.findIndex((x) => x.active);
    if (idx >= 0) setFocusedIndex(idx);
  }, [enhanced]);

  // Focus management
  useEffect(() => {
    const el = refs.current[focusedIndex];
    if (el) el.focus();
  }, [focusedIndex]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Only handle when sidebar is present and user isn't typing in an input/textarea
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement | null)?.isContentEditable
      )
        return;

      // Collapse toggle
      if (e.key === "[") {
        setCollapsed(true);
        return;
      }
      if (e.key === "]") {
        setCollapsed(false);
        return;
      }

      // Navigate list
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, enhanced.length - 1));
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
        setFocusedIndex(enhanced.length - 1);
        return;
      }

      // Open focused item
      if (e.key === "Enter") {
        const el = refs.current[focusedIndex];
        if (el) el.click();
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enhanced.length, focusedIndex]);

  return (
    <aside
      className={["border-r border-neutral-200 p-3", collapsed ? "w-16" : "w-72"].join(
        " "
      )}
      aria-label="Artifacts sidebar"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{collapsed ? "A" : "Artifacts"}</div>
          {!collapsed && <div className="text-xs text-neutral-500 capitalize">{role}</div>}
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="rounded-md border border-neutral-200 px-2 py-1 text-xs text-neutral-700 hover:bg-neutral-100"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand (])" : "Collapse ([)"}
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>

      <nav className="space-y-1" aria-label="Artifact navigation">
        {enhanced.map((it, idx) => {
          const rightStatus = it.current ? (
            <span className={it.badge.cls}>{it.badge.text}</span>
          ) : it.canCreate ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border border-neutral-200 text-neutral-700 bg-white">
              Create
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border border-neutral-200 text-neutral-400 bg-white">
              View
            </span>
          );

          const showQuick = !collapsed && it.current?.id && it.canEdit;

          return (
            <div
              key={it.key}
              className={["rounded-md", it.active ? "bg-neutral-100 ring-1 ring-neutral-200" : ""].join(
                " "
              )}
            >
              <Link
                ref={(el) => {
                  refs.current[idx] = el;
                }}
                href={it.href}
                onClick={() => {
                  if (it.current?.id) {
                    try {
                      localStorage.setItem(storageKey, it.current.id);
                      setStoredArtifactId(it.current.id);
                    } catch {
                      // ignore
                    }
                  }
                }}
                className={[
                  "block rounded-md px-2 py-2 hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-300",
                  collapsed ? "px-2 py-3" : "",
                ].join(" ")}
                aria-current={it.active ? "page" : undefined}
                title={collapsed ? it.label : undefined}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex items-center gap-2">
                    <span
                      className={[
                        "inline-block h-2.5 w-2.5 rounded-full border border-neutral-200",
                        it.dot,
                      ].join(" ")}
                      aria-hidden="true"
                    />
                    {!collapsed && (
                      <div className="min-w-0">
                        <div className="truncate text-sm text-neutral-900">{it.label}</div>
                        <div className="truncate text-xs text-neutral-500">
                          {it.ui_kind} • {it.current ? "Current" : it.canCreate ? "Not created" : "—"}
                        </div>
                      </div>
                    )}
                  </div>

                  {!collapsed && <div className="shrink-0">{rightStatus}</div>}
                </div>
              </Link>

              {showQuick && (
                <div className="px-2 pb-2 flex items-center gap-2">
                  <Link
                    href={`/projects/${it.href.split("/projects/")[1].split("/artifacts/")[0]}/artifacts/${it.current!.id}#submit`}
                    className="text-xs rounded-md border border-neutral-200 px-2 py-1 hover:bg-neutral-100 text-neutral-700"
                  >
                    {it.status === "changes_requested" ? "Resubmit" : "Submit"}
                  </Link>

                  <Link
                    href={`/projects/${it.href.split("/projects/")[1].split("/artifacts/")[0]}/artifacts/${it.current!.id}`}
                    className="text-xs rounded-md border border-neutral-200 px-2 py-1 hover:bg-neutral-100 text-neutral-700"
                  >
                    Open
                  </Link>

                  {it.current?.is_locked ? (
                    <span className="text-[11px] text-neutral-500">Locked</span>
                  ) : (
                    <span className="text-[11px] text-neutral-500">Editable</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mt-3 text-[11px] text-neutral-500">
          Keyboard: ↑/↓ to move, Enter to open, [ collapse, ] expand
        </div>
      )}
    </aside>
  );
}
