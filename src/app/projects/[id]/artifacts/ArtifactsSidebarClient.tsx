// src/app/projects/[id]/artifacts/ArtifactsSidebarClient.tsx
"use client";

import Link from "next/link";
import { usePathname, useSearchParams, useRouter } from "next/navigation";
import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  Plus,
  FileText,
  FolderOpen,
  CheckCircle2,
  Lock,
  AlertTriangle,
  Sparkles,
  Search,
  X,
  Layers,
  Shield,
  BookMarked,
  Zap,
} from "lucide-react";

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

/* ═══════════════════════════════════════════════════════════════
   PROPS — This is the contract the server component must match
═══════════════════════════════════════════════════════════════ */

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
function safeUpper(x: unknown) {
  return safeStr(x).trim().toUpperCase();
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function normStatus(s: string | null | undefined) {
  return safeLower(s);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim(),
  );
}

function pickProjectKey(h?: string | null, id?: string | null) {
  const human = String(h ?? "").trim();
  if (human && !looksLikeUuid(human)) return human;
  return String(id ?? "").trim() || human || "";
}

function canonicalKeyUpper(it: Pick<SidebarItem, "ui_kind" | "key">) {
  return safeUpper(it.ui_kind || it.key);
}

function groupForKey(k: string): GroupName {
  const u = k.toUpperCase().trim();
  if (
    [
      "PROJECT_CHARTER",
      "STAKEHOLDER_REGISTER",
      "WBS",
      "SCHEDULE",
      "WEEKLY_REPORT",
    ].includes(u)
  )
    return "Plan";
  if (["RAID", "CHANGE"].includes(u)) return "Control";
  // Close: LESSONS_LEARNED, PROJECT_CLOSURE_REPORT, and anything else
  return "Close";
}

function normalizeHref(href: string, projectId: string, routeId: string) {
  const raw = safeStr(href).trim();
  if (!raw || !projectId || !routeId) return raw;
  const needle = `/projects/${projectId}/`;
  return raw.includes(needle)
    ? raw.replace(needle, `/projects/${routeId}/`)
    : raw;
}

function artifactIdFromPath(pathname: string | null | undefined) {
  return (
    String(pathname ?? "").match(/\/artifacts\/([^\/\?#]+)/)?.[1] ?? null
  );
}

/* ═══════════════════════════════════════════════════════════════
   STATUS CONFIG
═══════════════════════════════════════════════════════════════ */

type StatusCfg = { label: string; dot: string; text: string };

function getStatusCfg(status: string | null | undefined): StatusCfg {
  const s = normStatus(status);
  if (!s || s === "draft")
    return { label: "Draft", dot: "bg-zinc-500", text: "text-zinc-500" };
  if (s === "submitted")
    return { label: "Submitted", dot: "bg-sky-400", text: "text-sky-400" };
  if (s === "approved")
    return {
      label: "Approved",
      dot: "bg-emerald-400",
      text: "text-emerald-400",
    };
  if (s === "rejected")
    return { label: "Rejected", dot: "bg-red-400", text: "text-red-400" };
  if (s === "changes_requested")
    return { label: "Revise", dot: "bg-amber-400", text: "text-amber-400" };
  if (s === "on_hold")
    return { label: "On Hold", dot: "bg-zinc-500", text: "text-zinc-500" };
  return { label: s || "Unknown", dot: "bg-zinc-600", text: "text-zinc-500" };
}

/* ═══════════════════════════════════════════════════════════════
   GROUP CONFIG
═══════════════════════════════════════════════════════════════ */

const GROUP_CFG: Record<
  GroupName,
  { Icon: React.ElementType; accent: string }
> = {
  Plan: { Icon: Layers, accent: "text-blue-500" },
  Control: { Icon: Shield, accent: "text-amber-500" },
  Close: { Icon: BookMarked, accent: "text-rose-500" },
};

/* ═══════════════════════════════════════════════════════════════
   ENHANCED ITEM TYPE  (derived from SidebarItem at runtime)
═══════════════════════════════════════════════════════════════ */

type EnhancedItem = SidebarItem & {
  openUrl: string;
  active: boolean;
  status: string;
  statusCfg: StatusCfg;
  keyUpper: string;
  isLocked: boolean;
  isDeleted: boolean;
};

/* ═══════════════════════════════════════════════════════════════
   EXTRACTED SUB-COMPONENTS  (stable references — no re-mount)
═══════════════════════════════════════════════════════════════ */

const ArtifactRow = React.memo(function ArtifactRow({
  it,
  idx,
  collapsed,
  rowRefs,
  onRowClick,
}: {
  it: EnhancedItem;
  idx: number;
  collapsed: boolean;
  rowRefs: React.MutableRefObject<Array<HTMLAnchorElement | null>>;
  onRowClick: (id: string | undefined) => void;
}) {
  const router = useRouter();
  const cfg = it.statusCfg;

  const RowIcon = it.isLocked
    ? Lock
    : it.isDeleted
      ? AlertTriangle
      : it.active
        ? Sparkles
        : it.current
          ? FileText
          : Plus;

  const goCurrent = useCallback(() => {
    if (!it.current?.id) return;
    router.push(it.openUrl);
  }, [it.current?.id, it.openUrl, router]);

  return (
    <div className="relative group/row">
      {it.active && (
        <div
          className={[
            "absolute left-0 top-1/2 -translate-y-1/2 rounded-r-full",
            "bg-gradient-to-b from-amber-300 to-amber-500",
            collapsed ? "w-[2px] h-5" : "w-[3px] h-8",
          ].join(" ")}
        />
      )}

      <Link
        ref={(el) => {
          rowRefs.current[idx] = el;
        }}
        href={it.openUrl}
        prefetch={false}
        onClick={() => onRowClick(it.current?.id)}
        aria-current={it.active ? "page" : undefined}
        aria-label={`${it.label}${it.current ? ` — ${cfg.label}` : " — not created"}`}
        title={collapsed ? it.label : undefined}
        className={[
          "relative flex items-center gap-3 rounded-xl",
          "outline-none focus-visible:ring-2 focus-visible:ring-amber-400/40 focus-visible:ring-offset-1 focus-visible:ring-offset-zinc-900",
          "transition-all duration-150",
          collapsed
            ? "justify-center w-10 h-10 mx-auto p-0"
            : "px-3 py-2.5 pl-4",
          it.active
            ? "bg-white/[0.07] hover:bg-white/[0.09]"
            : "hover:bg-white/[0.04] active:bg-white/[0.06]",
        ].join(" ")}
      >
        {/* Icon */}
        <div
          className={[
            "shrink-0 rounded-lg flex items-center justify-center transition-all duration-200 w-8 h-8",
            it.active
              ? "bg-amber-400/15 text-amber-300 ring-1 ring-amber-400/25"
              : it.current
                ? "bg-white/[0.08] text-zinc-400 group-hover/row:bg-white/[0.12] group-hover/row:text-zinc-300"
                : "bg-transparent text-zinc-700 border border-dashed border-zinc-800 group-hover/row:border-zinc-700 group-hover/row:text-zinc-600",
          ].join(" ")}
        >
          <RowIcon className="w-3.5 h-3.5" />
        </div>

        {/* Content (expanded only) */}
        {!collapsed && (
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={[
                  "text-[13px] font-medium truncate leading-tight",
                  it.active
                    ? "text-zinc-100"
                    : it.current
                      ? "text-zinc-300"
                      : "text-zinc-600",
                ].join(" ")}
              >
                {it.label}
              </span>

              {it.active && it.current?.id && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    goCurrent();
                  }}
                  title={`Open ${it.current.title ?? it.label}`}
                  className={[
                    "shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full",
                    "bg-amber-400 hover:bg-amber-300",
                    "text-[9px] font-black text-zinc-900 uppercase tracking-[0.14em]",
                    "shadow-[0_0_10px_rgba(251,191,36,0.35)] hover:shadow-[0_0_14px_rgba(251,191,36,0.5)]",
                    "transition-all duration-150",
                  ].join(" ")}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-900/30 animate-pulse" />
                  Current
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 mt-0.5">
              {it.current ? (
                <>
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`}
                  />
                  <span
                    className={`text-[11px] font-medium ${cfg.text}`}
                  >
                    {cfg.label}
                  </span>
                  {it.isLocked && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-zinc-600">
                      <Lock className="w-2.5 h-2.5" /> Locked
                    </span>
                  )}
                  {it.isDeleted && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-red-500">
                      <AlertTriangle className="w-2.5 h-2.5" /> Deleted
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[11px] text-zinc-700">
                  {it.canCreate ? "Not created yet" : "View only"}
                </span>
              )}
            </div>
          </div>
        )}

        {collapsed && it.active && (
          <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-amber-400 rounded-full border-2 border-zinc-900 shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
        )}
      </Link>
    </div>
  );
});

const GroupSection = React.memo(function GroupSection({
  name,
  groupItems,
  start,
  collapsed,
  groupOpen,
  toggleGroup,
  rowRefs,
  onRowClick,
}: {
  name: GroupName;
  groupItems: EnhancedItem[];
  start: number;
  collapsed: boolean;
  groupOpen: Record<GroupName, boolean>;
  toggleGroup: (g: GroupName) => void;
  rowRefs: React.MutableRefObject<Array<HTMLAnchorElement | null>>;
  onRowClick: (id: string | undefined) => void;
}) {
  const { Icon, accent } = GROUP_CFG[name];
  const open = groupOpen[name];
  const exist = groupItems.filter((x) => x.current?.id).length;
  if (groupItems.length === 0 && !collapsed) return null;

  return (
    <div className="mb-1">
      {!collapsed && (
        <button
          type="button"
          onClick={() => toggleGroup(name)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg group/gh hover:bg-white/[0.04] transition-colors mb-0.5"
        >
          <Icon className={`w-3 h-3 shrink-0 ${accent} opacity-70`} />
          <span className="flex-1 text-left text-[10px] font-black tracking-[0.14em] uppercase text-zinc-700 group-hover/gh:text-zinc-500 transition-colors">
            {name}
          </span>
          <span className="text-[10px] font-medium text-zinc-800 tabular-nums">
            {exist}/{groupItems.length}
          </span>
          <span className="text-[11px] text-zinc-800 group-hover/gh:text-zinc-600 w-3 text-center font-mono transition-colors">
            {open ? "−" : "+"}
          </span>
        </button>
      )}

      {open && (
        <div className="space-y-0.5">
          {groupItems.map((it, i) => (
            <ArtifactRow
              key={it.key}
              it={it}
              idx={start + i}
              collapsed={collapsed}
              rowRefs={rowRefs}
              onRowClick={onRowClick}
            />
          ))}
        </div>
      )}

      {collapsed && <div className="h-px bg-zinc-800/80 my-1.5 mx-3" />}
    </div>
  );
});

/* ═══════════════════════════════════════════════════════════════
   INNER COMPONENT (needs useSearchParams inside Suspense)
═══════════════════════════════════════════════════════════════ */

function ArtifactsSidebarInner({
  items,
  role,
  projectId,
  projectHumanId,
  projectName,
  projectCode,
}: ArtifactsSidebarClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const newTypeRaw = searchParams?.get("type") ?? null;

  const [collapsed, setCollapsed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [focusIdx, setFocusIdx] = useState(0);
  const [storedId, setStoredId] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState<Record<GroupName, boolean>>({
    Plan: true,
    Control: true,
    Close: true,
  });

  const rowRefs = useRef<Array<HTMLAnchorElement | null>>([]);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const projectKey = useMemo(
    () => pickProjectKey(projectHumanId, projectId),
    [projectHumanId, projectId],
  );

  const projectRoute = useMemo(() => {
    const h = String(projectHumanId ?? "").trim();
    const c = String(projectCode ?? "").trim();
    return (
      (h && !looksLikeUuid(h) ? h : "") ||
      (c && !looksLikeUuid(c) ? c : "") ||
      projectKey
    );
  }, [projectHumanId, projectCode, projectKey]);

  const SKEY = `alienai:lastArtifact:${projectKey}`;
  const GKEY = `alienai:artifactGroups:${projectKey}`;

  useEffect(() => setMounted(true), []);

  // Restore localStorage
  useEffect(() => {
    if (!mounted) return;
    try {
      const v = localStorage.getItem(SKEY);
      if (v) setStoredId(v);
    } catch {
      // localStorage unavailable (SSR / privacy mode)
    }
    try {
      const raw = localStorage.getItem(GKEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      setGroupOpen((prev) => ({
        Plan: typeof p?.Plan === "boolean" ? p.Plan : prev.Plan,
        Control: typeof p?.Control === "boolean" ? p.Control : prev.Control,
        Close: typeof p?.Close === "boolean" ? p.Close : prev.Close,
      }));
    } catch {
      // localStorage unavailable
    }
  }, [mounted, SKEY, GKEY]);

  // Persist active artifact
  useEffect(() => {
    const id = artifactIdFromPath(pathname);
    if (!id || !mounted) return;
    try {
      localStorage.setItem(SKEY, id);
      setStoredId(id);
    } catch {
      // localStorage unavailable
    }
  }, [mounted, pathname, SKEY]);

  // Persist group state
  useEffect(() => {
    if (!mounted) return;
    try {
      localStorage.setItem(GKEY, JSON.stringify(groupOpen));
    } catch {
      // localStorage unavailable
    }
  }, [mounted, GKEY, groupOpen]);

  const safeItems = useMemo(() => (Array.isArray(items) ? items : []), [items]);

  const enhanced: EnhancedItem[] = useMemo(() => {
    const urlId = artifactIdFromPath(pathname);
    const activeId = urlId ?? (mounted ? storedId : null);
    const newType = safeUpper(newTypeRaw);

    return safeItems.map((it) => {
      const itKey = canonicalKeyUpper(it);
      const active =
        (it.current?.id != null &&
          activeId != null &&
          it.current.id === activeId) ||
        (!it.current &&
          String(pathname ?? "").includes("/artifacts/new") &&
          newType === itKey);

      const status = normStatus(it.current?.approval_status);
      const href = normalizeHref(it.href, projectId, projectRoute);
      const openUrl = it.current?.id
        ? `/projects/${projectRoute}/artifacts/${it.current.id}`
        : href;

      return {
        ...it,
        href,
        openUrl,
        active,
        status,
        statusCfg: getStatusCfg(status),
        keyUpper: itKey,
        isLocked: Boolean(it.current?.is_locked),
        isDeleted: Boolean(it.current?.deleted_at),
      };
    });
  }, [safeItems, pathname, newTypeRaw, storedId, mounted, projectId, projectRoute]);

  const counts = useMemo(() => {
    let draft = 0,
      submitted = 0,
      creatable = 0;
    for (const it of enhanced) {
      if (it.canCreate) creatable++;
      if (!it.current?.id) continue;
      const s = normStatus(it.current.approval_status);
      if (!s || s === "draft") draft++;
      else submitted++;
    }
    return { draft, submitted, creatable };
  }, [enhanced]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? enhanced.filter((it) => it.label.toLowerCase().includes(q))
      : enhanced;
  }, [enhanced, query]);

  const grouped = useMemo(() => {
    const out: Record<GroupName, EnhancedItem[]> = {
      Plan: [],
      Control: [],
      Close: [],
    };
    for (const it of visible) out[groupForKey(it.keyUpper)].push(it);
    return out;
  }, [visible]);

  const flat = useMemo(() => {
    const arr: EnhancedItem[] = [];
    (["Plan", "Control", "Close"] as const).forEach((g) => {
      if (groupOpen[g]) arr.push(...grouped[g]);
    });
    return arr;
  }, [grouped, groupOpen]);

  const groupStarts = useMemo(() => {
    let i = 0;
    const s: Record<GroupName, number> = { Plan: 0, Control: 0, Close: 0 };
    (["Plan", "Control", "Close"] as const).forEach((g) => {
      s[g] = i;
      if (groupOpen[g]) i += grouped[g].length;
    });
    return s;
  }, [grouped, groupOpen]);

  useEffect(() => {
    const idx = flat.findIndex((x) => x.active);
    if (idx >= 0) setFocusIdx(idx);
  }, [flat]);

  useEffect(() => {
    rowRefs.current[focusIdx]?.focus?.();
  }, [focusIdx]);

  // Keyboard handler
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (
        e.target as HTMLElement | null
      )?.tagName?.toLowerCase();
      const typing =
        tag === "input" ||
        tag === "textarea" ||
        (e.target as HTMLElement | null)?.isContentEditable;

      if (
        e.key === "Escape" &&
        document.activeElement === searchRef.current
      ) {
        e.preventDefault();
        setQuery("");
        searchRef.current?.blur();
        return;
      }
      if (!typing && e.key === "/" && !collapsed) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (typing) return;

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
        setFocusIdx((i) => Math.min(i + 1, flat.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        setFocusIdx(0);
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        setFocusIdx(flat.length - 1);
        return;
      }
      if (e.key === "Enter") {
        rowRefs.current[focusIdx]?.click?.();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsed, flat.length, focusIdx]);

  const toggleGroup = useCallback(
    (g: GroupName) => setGroupOpen((p) => ({ ...p, [g]: !p[g] })),
    [],
  );

  const handleRowClick = useCallback(
    (id: string | undefined) => {
      if (!id || !mounted) return;
      try {
        localStorage.setItem(SKEY, id);
        setStoredId(id);
      } catch {
        // localStorage unavailable
      }
    },
    [mounted, SKEY],
  );

  const boardHref = useCallback(
    (view: string) => `/projects/${projectRoute}/board?view=${view}`,
    [projectRoute],
  );

  const initial = (safeStr(projectName).trim() || "P").charAt(0).toUpperCase();

  return (
    <aside
      aria-label="Artifact navigation"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={[
        "relative shrink-0 flex flex-col",
        "bg-zinc-950 border-r border-zinc-800/80",
        "transition-[width] duration-300 ease-in-out",
        "h-screen sticky top-0 overflow-hidden",
      ].join(" ")}
      style={{ width: collapsed ? 60 : 272 }}
    >
      {/* Subtle noise texture */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")`,
        }}
      />

      <div className="relative z-10 flex flex-col h-full">
        {/* Collapse toggle */}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "Expand sidebar (])" : "Collapse sidebar ([)"}
          title={collapsed ? "Expand ]" : "Collapse ["}
          className={[
            "absolute -right-3.5 top-5 z-50 w-7 h-7 rounded-full",
            "bg-zinc-800 border border-zinc-700",
            "flex items-center justify-center",
            "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 hover:border-zinc-600",
            "shadow-xl transition-all duration-200",
            hovered || collapsed
              ? "opacity-100 scale-100"
              : "opacity-0 scale-75 pointer-events-none",
          ].join(" ")}
        >
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5" />
          )}
        </button>

        {/* HEADER */}
        <div
          className={[
            "shrink-0 border-b border-zinc-800/80 transition-all duration-300",
            collapsed ? "px-2.5 py-3" : "px-4 pt-5 pb-4",
          ].join(" ")}
        >
          {collapsed ? (
            <div className="flex flex-col items-center gap-2.5">
              <Link
                href={`/projects/${projectRoute}`}
                title={projectName ?? "Project"}
                className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-zinc-100 font-black text-[15px] hover:bg-zinc-700 hover:border-zinc-600 transition-all shadow-sm"
              >
                {initial}
              </Link>

              <Link
                href={`/projects/${projectRoute}/board`}
                title="Board"
                className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800/80 transition-all"
              >
                <LayoutGrid className="w-4 h-4" />
              </Link>

              <Link
                href={boardHref("create")}
                title="Create artifact"
                className="w-9 h-9 rounded-lg bg-amber-400/10 border border-amber-400/20 flex items-center justify-center text-amber-400 hover:bg-amber-400/20 hover:border-amber-400/40 transition-all"
              >
                <Plus className="w-4 h-4" />
              </Link>
            </div>
          ) : (
            <>
              {/* Project identity */}
              <div className="flex items-center gap-3 mb-4">
                <Link
                  href={`/projects/${projectRoute}`}
                  className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700/80 flex items-center justify-center text-zinc-100 font-black text-[15px] hover:bg-zinc-700 hover:border-zinc-600 transition-all shrink-0"
                >
                  {initial}
                </Link>

                <div className="flex-1 min-w-0">
                  <Link
                    href={`/projects/${projectRoute}`}
                    prefetch={false}
                    title={projectName ?? ""}
                    className="block text-[13px] font-bold text-zinc-100 truncate hover:text-amber-300 transition-colors leading-tight"
                  >
                    {safeStr(projectName).trim() || "Untitled Project"}
                  </Link>

                  <div className="flex items-center gap-2 mt-0.5">
                    {projectCode && (
                      <code className="font-mono text-[10px] text-zinc-600 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded">
                        {projectCode}
                      </code>
                    )}
                    <span
                      className={[
                        "text-[10px] font-bold capitalize",
                        role === "owner"
                          ? "text-amber-400"
                          : role === "editor"
                            ? "text-sky-400"
                            : "text-zinc-600",
                      ].join(" ")}
                    >
                      {role}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action strip */}
              <div className="flex items-center gap-1.5 mb-2">
                <Link
                  href={`/projects/${projectRoute}/board`}
                  prefetch={false}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-semibold text-zinc-500 hover:text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800/60 transition-all"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Board
                </Link>

                <Link
                  href={boardHref("draft")}
                  prefetch={false}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-[11px] font-semibold text-zinc-500 hover:text-zinc-200 hover:border-zinc-700 hover:bg-zinc-800/60 transition-all"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Drafts
                  {counts.draft > 0 && (
                    <span className="text-[9px] font-black text-zinc-700 tabular-nums ml-0.5">
                      {counts.draft}
                    </span>
                  )}
                </Link>

                <Link
                  href={boardHref("create")}
                  prefetch={false}
                  aria-label="Create new artifact"
                  title="Create new artifact"
                  className="w-9 h-9 shrink-0 inline-flex items-center justify-center rounded-lg bg-amber-400 hover:bg-amber-300 text-zinc-900 transition-all shadow-[0_0_14px_rgba(251,191,36,0.2)] hover:shadow-[0_0_18px_rgba(251,191,36,0.4)]"
                >
                  <Plus className="w-4 h-4" />
                </Link>
              </div>

              {/* Submitted strip */}
              {counts.submitted > 0 && (
                <Link
                  href={boardHref("submitted")}
                  prefetch={false}
                  className="w-full inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-950/30 border border-emerald-900/50 text-[11px] font-semibold text-emerald-500 hover:bg-emerald-950/50 hover:border-emerald-800/60 transition-all"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Submitted for review
                  <span className="ml-auto font-black tabular-nums">
                    {counts.submitted}
                  </span>
                </Link>
              )}
            </>
          )}
        </div>

        {/* SEARCH */}
        {!collapsed && (
          <div className="shrink-0 px-3 py-2.5 border-b border-zinc-800/80">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-700 pointer-events-none" />
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                aria-label="Search artifacts"
                className={[
                  "w-full pl-8 pr-8 py-2 rounded-lg",
                  "bg-zinc-900 border border-zinc-800",
                  "text-[12px] text-zinc-300 placeholder-zinc-700",
                  "focus:outline-none focus:ring-2 focus:ring-amber-400/25 focus:border-zinc-700 focus:bg-zinc-900/80",
                  "transition-all",
                ].join(" ")}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-zinc-700 hover:text-zinc-300 transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* NAV */}
        <nav
          aria-label="Artifact list"
          className={[
            "flex-1 overflow-y-auto min-h-0",
            collapsed ? "px-1.5 py-2" : "px-3 py-3",
          ].join(" ")}
          style={{
            scrollbarWidth: "thin",
            scrollbarColor: "#27272a transparent",
          }}
        >
          {!collapsed && (
            <div className="flex items-center justify-between px-2 mb-2.5">
              <span className="text-[10px] font-black uppercase tracking-[0.14em] text-zinc-800">
                Artifacts
              </span>
              <span className="text-[10px] font-bold text-zinc-800 tabular-nums">
                {visible.length}
              </span>
            </div>
          )}

          {visible.length === 0 ? (
            !collapsed && (
              <div className="px-2 py-8 text-center">
                <p className="text-[12px] text-zinc-600">No match</p>
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="mt-1 text-[11px] text-amber-500 hover:text-amber-300 font-semibold transition-colors"
                >
                  Clear search
                </button>
              </div>
            )
          ) : (
            <>
              <GroupSection
                name="Plan"
                groupItems={grouped.Plan}
                start={groupStarts.Plan}
                collapsed={collapsed}
                groupOpen={groupOpen}
                toggleGroup={toggleGroup}
                rowRefs={rowRefs}
                onRowClick={handleRowClick}
              />
              <GroupSection
                name="Control"
                groupItems={grouped.Control}
                start={groupStarts.Control}
                collapsed={collapsed}
                groupOpen={groupOpen}
                toggleGroup={toggleGroup}
                rowRefs={rowRefs}
                onRowClick={handleRowClick}
              />
              <GroupSection
                name="Close"
                groupItems={grouped.Close}
                start={groupStarts.Close}
                collapsed={collapsed}
                groupOpen={groupOpen}
                toggleGroup={toggleGroup}
                rowRefs={rowRefs}
                onRowClick={handleRowClick}
              />
            </>
          )}
        </nav>

        {/* FOOTER */}
        {!collapsed && (
          <div className="shrink-0 border-t border-zinc-800/80 px-4 py-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Zap className="w-3 h-3 text-amber-500/70" />
                <span className="text-[10px] font-bold text-zinc-800">
                  AlienAI
                </span>
              </div>
              <p className="hidden lg:block text-[9px] font-mono text-zinc-800">
                ↑↓ · / · [ ]
              </p>
            </div>
          </div>
        )}

        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-zinc-950 to-transparent"
        />
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PUBLIC COMPONENT — wraps inner in Suspense for useSearchParams
═══════════════════════════════════════════════════════════════ */

function ArtifactsSidebarClientImpl(props: ArtifactsSidebarClientProps) {
  return (
    <Suspense fallback={<SidebarSkeleton />}>
      <ArtifactsSidebarInner {...props} />
    </Suspense>
  );
}

/** Minimal skeleton shown while useSearchParams resolves on first render */
function SidebarSkeleton() {
  return (
    <aside
      aria-label="Artifact navigation loading"
      className="relative shrink-0 flex flex-col bg-zinc-950 border-r border-zinc-800/80 h-screen sticky top-0 overflow-hidden"
      style={{ width: 272 }}
    >
      <div className="px-4 pt-5 pb-4 border-b border-zinc-800/80">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-zinc-800 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-24 bg-zinc-800 rounded animate-pulse" />
            <div className="h-2 w-16 bg-zinc-800/60 rounded animate-pulse" />
          </div>
        </div>
      </div>
      <div className="flex-1 px-3 py-3 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-10 bg-zinc-900/50 rounded-xl animate-pulse"
          />
        ))}
      </div>
    </aside>
  );
}

/**
 * ✅ Export BOTH:
 * - default export (for any existing default imports)
 * - named export
 */
export default ArtifactsSidebarClientImpl;
export const ArtifactsSidebarClient = ArtifactsSidebarClientImpl;