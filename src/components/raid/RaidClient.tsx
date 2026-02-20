"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

type RaidType = "Risk" | "Assumption" | "Issue" | "Dependency";
type RaidStatus = "Open" | "In Progress" | "Mitigated" | "Closed";

export type RaidItem = {
  id: string;
  project_id: string;
  item_no?: number | null;
  public_id?: string | null;
  type: RaidType | string;
  title?: string | null;
  description: string;
  owner_label: string;
  owner_id?: string | null;
  due_date?: string | null;
  updated_at?: string | null;
  priority?: string | null;
  probability?: number | null;
  severity?: number | null;
  ai_rollup?: string | null;
  status: RaidStatus | string;
  response_plan?: string | null;
  related_refs?: any;
  ai_dirty?: boolean | null;
};

type AiRun = {
  id: string;
  created_at: string;
  actor_user_id?: string | null;
  model?: string | null;
  version?: string | null;
  ai_quality?: number | null;
  ai: any;
  inputs: any;
};

/* ---------------- utils ---------------- */
function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function clampNum(n: any, min = 0, max = 100) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}
function normalizeType(t: any): RaidType {
  const v = safeStr(t).trim();
  if (v === "Risk" || v === "Assumption" || v === "Issue" || v === "Dependency") return v;
  return "Risk";
}
function calcScore(prob?: number | null, sev?: number | null) {
  const p = clampNum(prob ?? 0, 0, 100);
  const s = clampNum(sev ?? 0, 0, 100);
  return Math.round((p * s) / 100);
}
function toneFromScore(sc: number): "g" | "a" | "r" {
  if (sc >= 61) return "r";
  if (sc >= 31) return "a";
  return "g";
}
function fmtWhen(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  } catch {
    return s;
  }
}
function fmtDateOnly(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "";
  return s;
}
function statusToken(s: any): "open" | "inprogress" | "mitigated" | "closed" | "invalid" {
  const v = safeStr(s).toLowerCase().trim();
  if (v === "open") return "open";
  if (v === "in progress" || v === "in_progress" || v === "inprogress") return "inprogress";
  if (v === "mitigated") return "mitigated";
  if (v === "closed") return "closed";
  if (v === "invalid") return "invalid";
  return "open";
}
function priorityToken(p: any): "low" | "medium" | "high" | "critical" | "" {
  const v = safeStr(p).toLowerCase().trim();
  if (v === "low") return "low";
  if (v === "medium") return "medium";
  if (v === "high") return "high";
  if (v === "critical") return "critical";
  return "";
}
function isOpenishStatus(s: any) {
  const v = safeStr(s).toLowerCase().trim();
  return v === "open" || v === "in progress" || v === "in_progress" || v === "inprogress";
}

/* ---------------- keyboard shortcuts ---------------- */
const STATUS_ORDER = ["Open", "In Progress", "Mitigated", "Closed"] as const;
const PRIORITY_ORDER = ["Low", "Medium", "High", "Critical"] as const;
function isTypingTarget(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  if (!n) return false;
  return Boolean(n.closest("input, textarea, select, [contenteditable='true']"));
}
function cycleInList(list: readonly string[], current: string) {
  const cur = safeStr(current);
  const i = list.findIndex((x) => x === cur);
  const idx = i < 0 ? 0 : i;
  return list[(idx + 1) % list.length];
}

/* ---------------- styling tokens - monday.com enhanced ---------------- */
const TYPE_STYLES: Record<
  RaidType,
  { bg: string; border: string; text: string; icon: string; desc: string; headerBg: string }
> = {
  Risk: {
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-900",
    icon: "text-rose-600",
    desc: "Events that may happen — mitigate early",
    headerBg: "bg-gradient-to-r from-rose-50 to-rose-100/70",
  },
  Assumption: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-900",
    icon: "text-amber-600",
    desc: "Beliefs we hold — validate them",
    headerBg: "bg-gradient-to-r from-amber-50 to-amber-100/70",
  },
  Issue: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-900",
    icon: "text-orange-600",
    desc: "Active problems — resolve quickly",
    headerBg: "bg-gradient-to-r from-orange-50 to-orange-100/70",
  },
  Dependency: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-900",
    icon: "text-blue-600",
    desc: "External blockers — track closely",
    headerBg: "bg-gradient-to-r from-blue-50 to-blue-100/70",
  },
};

const STATUS_STYLES: Record<
  string,
  { text: string; shadow: string; gradient: string; ring: string }
> = {
  open: {
    text: "text-white",
    shadow: "shadow-md shadow-slate-400/30",
    gradient: "bg-gradient-to-b from-slate-500 to-slate-600",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-slate-400/50",
  },
  inprogress: {
    text: "text-white",
    shadow: "shadow-md shadow-blue-500/30",
    gradient: "bg-gradient-to-b from-blue-500 to-blue-600",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-blue-400/50",
  },
  mitigated: {
    text: "text-white",
    shadow: "shadow-md shadow-emerald-500/30",
    gradient: "bg-gradient-to-b from-emerald-500 to-emerald-600",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-emerald-400/50",
  },
  closed: {
    text: "text-white",
    shadow: "shadow-md shadow-gray-500/30",
    gradient: "bg-gradient-to-b from-gray-500 to-gray-600",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-gray-400/50",
  },
  invalid: {
    text: "text-white",
    shadow: "shadow-md shadow-gray-400/20",
    gradient: "bg-gradient-to-b from-gray-400 to-gray-500",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-gray-300/40",
  },
};

const PRIORITY_STYLES: Record<
  string,
  { text: string; shadow: string; gradient: string; ring: string; label: string }
> = {
  "": {
    text: "text-slate-700",
    shadow: "shadow-sm",
    gradient: "bg-gradient-to-b from-slate-100 to-slate-200",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-slate-300/60",
    label: "—",
  },
  low: {
    text: "text-white",
    shadow: "shadow-md shadow-gray-400/30",
    gradient: "bg-gradient-to-b from-gray-400 to-gray-500",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-gray-300/50",
    label: "Low",
  },
  medium: {
    text: "text-white",
    shadow: "shadow-md shadow-blue-400/30",
    gradient: "bg-gradient-to-b from-blue-400 to-blue-500",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-blue-300/50",
    label: "Medium",
  },
  high: {
    text: "text-white",
    shadow: "shadow-md shadow-amber-400/30",
    gradient: "bg-gradient-to-b from-amber-400 to-amber-500",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-amber-300/50",
    label: "High",
  },
  critical: {
    text: "text-white",
    shadow: "shadow-md shadow-red-500/30",
    gradient: "bg-gradient-to-b from-red-500 to-rose-600",
    ring: "focus:ring-2 focus:ring-offset-2 focus:ring-red-400/50",
    label: "Critical",
  },
};

/* ---------------- KPI extras ---------------- */
const TREND_STYLES: Record<string, { icon: string; bg: string; text: string; label: string }> = {
  "Trending Up": {
    icon: "↑",
    bg: "bg-emerald-100",
    text: "text-emerald-700",
    label: "Trending Up",
  },
  "Trending Down": {
    icon: "↓",
    bg: "bg-rose-100",
    text: "text-rose-700",
    label: "Trending Down",
  },
  Flat: {
    icon: "→",
    bg: "bg-slate-100",
    text: "text-slate-700",
    label: "Flat",
  },
};

function getTrend(it: RaidItem): { icon: string; bg: string; text: string; label: string } {
  const score = calcScore(it.probability, it.severity);
  const status = safeStr(it.status).toLowerCase();
  if (status.includes("progress") || status === "open") {
    return score > 40 ? TREND_STYLES["Trending Up"] : TREND_STYLES.Flat;
  }
  if (status === "mitigated") return TREND_STYLES["Trending Up"];
  return TREND_STYLES.Flat;
}

const DEPT_STYLES: Record<string, string> = {
  Finance: "bg-blue-100 text-blue-800 border-blue-200",
  Sales: "bg-indigo-100 text-indigo-800 border-indigo-200",
  HR: "bg-purple-100 text-purple-800 border-purple-200",
  Product: "bg-teal-100 text-teal-800 border-teal-200",
  Marketing: "bg-pink-100 text-pink-800 border-pink-200",
  Engineering: "bg-cyan-100 text-cyan-800 border-cyan-200",
  default: "bg-gray-100 text-gray-700 border-gray-200",
};

/* ---------------- digest helpers ---------------- */
function digestId(x: any) {
  const pid = safeStr(x?.public_id).trim();
  const id = safeStr(x?.id).trim();
  return pid || id;
}
function digestIdShort(x: any) {
  const pid = safeStr(x?.public_id).trim();
  if (pid) return pid;
  const id = safeStr(x?.id).trim();
  return id ? id.slice(0, 6).toUpperCase() : "ID";
}
function digestDeepLink(projectRouteId: string, x: any) {
  const id = safeStr(x?.id).trim();
  const pid = safeStr(x?.public_id).trim();
  const focus = encodeURIComponent(id || "");
  const pidQ = encodeURIComponent(pid || "");
  const hash = encodeURIComponent(pid || id || "");
  return `/projects/${projectRouteId}/raid?focus=${focus}&pid=${pidQ}#${hash}`;
}

/* ---------------- api helpers ---------------- */
async function postJson(url: string, method: string, body?: any, headers?: Record<string, string>) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) {
    const err = new Error(j?.error || `Failed (${res.status})`);
    (err as any).status = res.status;
    (err as any).payload = j;
    throw err;
  }
  return j;
}
async function fetchRaidItems(projectId: string) {
  const res = await fetch(`/api/raid?projectId=${encodeURIComponent(projectId)}`, { method: "GET" });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`);
  return (j.items ?? []) as RaidItem[];
}
async function fetchRaidItemById(id: string) {
  const res = await fetch(`/api/raid/${encodeURIComponent(id)}`, { method: "GET" });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`);
  return j.item as RaidItem;
}
async function patchRaidItem(id: string, patch: any) {
  const j = await postJson(`/api/raid/${encodeURIComponent(id)}`, "PATCH", patch);
  return j.item as RaidItem;
}
async function createRaidItem(payload: any) {
  const j = await postJson(`/api/raid`, "POST", payload);
  return j.item as RaidItem;
}
async function deleteRaidItem(id: string, expectedUpdatedAt?: string) {
  await postJson(
    `/api/raid/${encodeURIComponent(id)}`,
    "DELETE",
    undefined,
    expectedUpdatedAt ? { "if-match-updated-at": expectedUpdatedAt } : undefined
  );
}
async function aiRefreshRaidItem(id: string) {
  const j = await postJson(`/api/raid/${encodeURIComponent(id)}/ai-refresh`, "POST");
  return j.item as RaidItem;
}
async function fetchWeeklyDigest(projectId: string) {
  const url = `/api/raid/digest?projectId=${encodeURIComponent(projectId)}`;
  try {
    const j = await postJson(url, "GET");
    return j.digest as any;
  } catch (e: any) {
    if ((e as any)?.status === 405) {
      const j2 = await postJson(`/api/raid/digest`, "POST", { projectId });
      return j2.digest as any;
    }
    throw e;
  }
}
async function fetchAiHistory(raidId: string) {
  const res = await fetch(`/api/raid/${encodeURIComponent(raidId)}/ai-history`, { method: "GET" });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`);
  return (j.runs ?? []) as AiRun[];
}

/* ---------------- component helpers ---------------- */
type ColKey = "desc" | "resp";
const DEFAULT_COL_WIDTHS: Record<ColKey, number> = { desc: 340, resp: 300 };

function reorder<T>(list: T[], startIndex: number, endIndex: number) {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}
function dndIdForRaid(it: { id: string }) {
  return `raid:${it.id}`;
}

type Banner = { kind: "success" | "error"; text: string; id: string };
function newBanner(kind: Banner["kind"], text: string): Banner {
  return { kind, text, id: `${kind}:${Date.now()}:${Math.random().toString(16).slice(2)}` };
}

export default function RaidClient({
  projectId,
  projectRouteId,
  projectTitle,
  projectClient,
  projectPublicId,
  initialItems,
}: {
  projectId: string;
  projectRouteId?: string;
  projectTitle?: string;
  projectClient?: string;
  projectPublicId?: string;
  initialItems: RaidItem[];
}) {
  const routeProjectId = useMemo(() => safeStr(projectRouteId).trim() || projectId, [projectRouteId, projectId]);
  const [items, setItems] = useState<RaidItem[]>(initialItems ?? []);
  const [busyId, setBusyId] = useState<string>("");
  const [banners, setBanners] = useState<Banner[]>([]);
  const pushBanner = useCallback((kind: Banner["kind"], text: string) => {
    const b = newBanner(kind, text);
    setBanners((prev) => [b, ...prev].slice(0, 3));
    window.setTimeout(() => {
      setBanners((prev) => prev.filter((x) => x.id !== b.id));
    }, 4000);
  }, []);
  const dismissBanner = useCallback((id: string) => setBanners((prev) => prev.filter((x) => x.id !== id)), []);
  const [digestBusy, setDigestBusy] = useState<boolean>(false);
  const [digest, setDigest] = useState<any>(null);
  const [aiOpenId, setAiOpenId] = useState<string>("");
  const [staleById, setStaleById] = useState<Record<string, { at: string; message: string }>>({});
  const [aiHistOpenId, setAiHistOpenId] = useState<string>("");
  const [aiRunsById, setAiRunsById] = useState<Record<string, AiRun[]>>({});
  const [aiHistBusyId, setAiHistBusyId] = useState<string>("");
  const [aiCompareById, setAiCompareById] = useState<Record<string, { a: string; b: string }>>({});
  const [openGroups, setOpenGroups] = useState<Record<RaidType, boolean>>({
    Risk: true,
    Assumption: true,
    Issue: true,
    Dependency: true,
  });
  const [menuOpenFor, setMenuOpenFor] = useState<RaidType | "">("");
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [colW, setColW] = useState<Record<ColKey, number>>(DEFAULT_COL_WIDTHS);
  const resizeRef = useRef<{ key: ColKey | ""; startX: number; startW: number }>({ key: "", startX: 0, startW: 0 });
  const [touchedById, setTouchedById] = useState<Record<string, { owner?: boolean; plan?: boolean }>>({});
  const [hotRowId, setHotRowId] = useState<string>("");

  // Close menu on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!menuOpenFor) return;
      const t = e.target as Node | null;
      if (!t) return;
      const btn = menuBtnRefs.current[menuOpenFor] || null;
      const menu = menuRef.current;
      if (menu?.contains(t)) return;
      if (btn?.contains(t)) return;
      setMenuOpenFor("");
    }
    function onKey(e: KeyboardEvent) {
      if (!menuOpenFor) return;
      if (e.key === "Escape") setMenuOpenFor("");
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpenFor]);

  // Column resize
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const key = resizeRef.current.key;
      if (!key) return;
      const dx = e.clientX - resizeRef.current.startX;
      const next = Math.max(200, Math.min(900, resizeRef.current.startW + dx));
      setColW((prev) => ({ ...prev, [key]: next }));
    }
    function onUp() {
      if (!resizeRef.current.key) return;
      resizeRef.current.key = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResize = useCallback(
    (key: ColKey, e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { key, startX: e.clientX, startW: colW[key] };
      document.body.style.cursor = "col-resize";
    },
    [colW]
  );

  const toggleGroup = useCallback((type: RaidType) => {
    setOpenGroups((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const grouped = useMemo(() => {
    const g: Record<RaidType, RaidItem[]> = { Risk: [], Assumption: [], Issue: [], Dependency: [] };
    for (const it of items) g[normalizeType(it.type)].push(it);
    (Object.keys(g) as RaidType[]).forEach((k) => {
      g[k].sort((a, b) => (safeStr(b.updated_at) > safeStr(a.updated_at) ? 1 : -1));
    });
    return g;
  }, [items]);

  const stats = useMemo(() => {
    const openish = items.filter((x) => isOpenishStatus(x.status));
    const highExp = items.filter(
      (x) => calcScore(x.probability, x.severity) >= 61 && !safeStr(x.status).toLowerCase().includes("close")
    );
    return {
      total: items.length,
      open: openish.length,
      high: highExp.length,
      mitigated: items.filter((x) => safeStr(x.status).toLowerCase() === "mitigated").length,
    };
  }, [items]);

  const humanProjectId = useMemo(
    () => safeStr(projectPublicId).trim() || projectId.slice(0, 8) + "…",
    [projectPublicId, projectId]
  );
  const humanProjectTitle = useMemo(() => safeStr(projectTitle).trim() || "Untitled project", [projectTitle]);
  const humanClient = useMemo(() => safeStr(projectClient).trim(), [projectClient]);

  const touch = useCallback((id: string, key: "owner" | "plan") => {
    setTouchedById((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: true } }));
  }, []);

  const requireOwner = useCallback(
    (owner: any) => {
      const o = safeStr(owner).trim();
      if (!o) {
        pushBanner("error", "Owner is mandatory");
        return null;
      }
      return o;
    },
    [pushBanner]
  );

  const onReloadRow = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const fresh = await fetchRaidItemById(id);
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...fresh } : x)));
        setStaleById((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        pushBanner("success", "Reloaded");
      } catch (e: any) {
        pushBanner("error", e?.message || "Reload failed");
      } finally {
        setBusyId("");
      }
    },
    [pushBanner]
  );

  const onPatch = useCallback(
    async (id: string, patch: any) => {
      setBusyId(id);
      try {
        const current = items.find((x) => x.id === id);
        const expected = safeStr(current?.updated_at).trim();
        if ("owner_label" in patch) {
          const ok = requireOwner(patch.owner_label);
          if (!ok) return;
          patch.owner_label = ok;
        }
        if ("status" in patch && safeStr(patch.status).trim().toLowerCase() === "invalid") {
          patch.status = "Closed";
        }
        const updated = await patchRaidItem(id, { ...patch, expected_updated_at: expected || undefined });
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        setStaleById((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        pushBanner("success", "Saved");
      } catch (e: any) {
        const status = (e as any)?.status;
        const payload = (e as any)?.payload;
        if (status === 409 || payload?.stale) {
          setStaleById((prev) => ({
            ...prev,
            [id]: { at: new Date().toISOString(), message: "Conflict detected. Reloading latest..." },
          }));
          try {
            const fresh = await fetchRaidItemById(id);
            setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...fresh } : x)));
            pushBanner("success", "Reloaded with latest changes");
          } catch (re: any) {
            pushBanner("error", re?.message || "Stale update");
          }
          return;
        }
        pushBanner("error", e?.message || "Update failed");
      } finally {
        setBusyId("");
      }
    },
    [items, requireOwner, pushBanner]
  );

  const onCreate = useCallback(
    async (type: RaidType) => {
      setBusyId(`new:${type}`);
      try {
        const created = await createRaidItem({
          project_id: projectId,
          type,
          description: "New item",
          owner_label: "TBC",
          priority: "Medium",
          probability: 50,
          severity: 50,
          status: "Open",
          response_plan: null,
        });
        setItems((prev) => [created, ...prev]);
        pushBanner("success", `${type} created`);
      } catch (e: any) {
        pushBanner("error", e?.message || "Create failed");
      } finally {
        setBusyId("");
      }
    },
    [projectId, pushBanner]
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this RAID item?")) return;
      setBusyId(id);
      const current = items.find((x) => x.id === id);
      const expected = safeStr(current?.updated_at).trim() || undefined;
      const prev = items;
      setItems((cur) => cur.filter((x) => x.id !== id));
      if (aiOpenId === id) setAiOpenId("");
      if (aiHistOpenId === id) setAiHistOpenId("");
      try {
        await deleteRaidItem(id, expected);
        pushBanner("success", "Deleted");
      } catch (e: any) {
        const status = (e as any)?.status;
        const payload = (e as any)?.payload;
        if (status === 409 || payload?.stale) {
          setItems(prev);
          setStaleById((p) => ({
            ...p,
            [id]: { at: new Date().toISOString(), message: "Delete blocked: item was updated by someone else" },
          }));
          pushBanner("error", "Delete blocked: item updated by someone else");
          return;
        }
        setItems(prev);
        pushBanner("error", e?.message || "Delete failed");
      } finally {
        setBusyId("");
      }
    },
    [items, aiOpenId, aiHistOpenId, pushBanner]
  );

  const onAiRefresh = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const updated = await aiRefreshRaidItem(id);
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        pushBanner("success", "AI updated");
        setAiOpenId(id);
      } catch (e: any) {
        pushBanner("error", e?.message || "AI refresh failed");
        setAiOpenId(id);
      } finally {
        setBusyId("");
      }
    },
    [pushBanner]
  );

  const onWeeklyDigest = useCallback(async () => {
    setDigestBusy(true);
    try {
      const d = await fetchWeeklyDigest(projectId);
      setDigest(d);
      pushBanner("success", "Digest generated");
    } catch (e: any) {
      pushBanner("error", e?.message || "Digest failed");
    } finally {
      setDigestBusy(false);
    }
  }, [projectId, pushBanner]);

  const onRefreshAll = useCallback(async () => {
    setBusyId("refresh:all");
    try {
      const fresh = await fetchRaidItems(projectId);
      setItems(fresh);
      pushBanner("success", "Refreshed");
    } catch (e: any) {
      pushBanner("error", e?.message || "Refresh failed");
    } finally {
      setBusyId("");
    }
  }, [projectId, pushBanner]);

  const openHistory = useCallback(
    async (id: string) => {
      setAiHistOpenId((cur) => (cur === id ? "" : id));
      if (aiRunsById[id]?.length) return;
      setAiHistBusyId(id);
      try {
        const runs = await fetchAiHistory(id);
        setAiRunsById((prev) => ({ ...prev, [id]: runs }));
        if (runs.length >= 2) setAiCompareById((prev) => ({ ...prev, [id]: { a: runs[0].id, b: runs[1].id } }));
        else if (runs.length === 1) setAiCompareById((prev) => ({ ...prev, [id]: { a: runs[0].id, b: runs[0].id } }));
      } catch (e: any) {
        pushBanner("error", e?.message || "Failed to load AI history");
      } finally {
        setAiHistBusyId("");
      }
    },
    [aiRunsById, pushBanner]
  );

  function getRun(runs: AiRun[], id: string) {
    return runs.find((r) => r.id === id) || null;
  }
  function diffLines(a: any, b: any) {
    const sa = safeStr(a || "");
    const sb = safeStr(b || "");
    if (sa === sb) return null;
    return { a: sa || "—", b: sb || "—" };
  }
  function diffList(a: any, b: any) {
    const aa = Array.isArray(a) ? a.map(String) : [];
    const bb = Array.isArray(b) ? b.map(String) : [];
    if (aa.join("||") === bb.join("||")) return null;
    return { a: aa.length ? aa : ["—"], b: bb.length ? bb : ["—"] };
  }

  // Auto-AI
  const AUTO_AI_ENABLED = true;
  const AUTO_AI_SCORE_THRESHOLD = 55;
  const AUTO_AI_DEBOUNCE_MS = 1200;
  const AUTO_AI_MIN_GAP_MS = 15000;
  const AUTO_AI_SCORE_DELTA_MIN = 5;
  const autoAiTimersRef = useRef<Record<string, any>>({});
  const autoAiLastRunAtRef = useRef<Record<string, number>>({});
  useEffect(() => {
    return () => {
      Object.values(autoAiTimersRef.current).forEach(clearTimeout);
    };
  }, []);
  useEffect(() => {
    if (!AUTO_AI_ENABLED) return;
    const now = Date.now();
    for (const it of items) {
      const id = it.id;
      if (!id) continue;
      const dirty = Boolean((it as any).ai_dirty);
      if (!dirty) {
        if (autoAiTimersRef.current[id]) {
          clearTimeout(autoAiTimersRef.current[id]);
          delete autoAiTimersRef.current[id];
        }
        continue;
      }
      if (!isOpenishStatus(it.status)) continue;
      if (busyId === id) continue;
      const curScore = calcScore(it.probability, it.severity);
      if (curScore < AUTO_AI_SCORE_THRESHOLD) continue;
      const prevInputs = it?.related_refs?.ai?.inputs || {};
      const prevProb = typeof prevInputs?.probability === "number" ? prevInputs.probability : null;
      const prevSev = typeof prevInputs?.severity === "number" ? prevInputs.severity : null;
      const prevScore =
        typeof prevInputs?.score === "number"
          ? prevInputs.score
          : prevProb != null || prevSev != null
          ? calcScore(prevProb, prevSev)
          : null;
      const delta = prevScore == null ? 999 : Math.abs(curScore - prevScore);
      if (delta < AUTO_AI_SCORE_DELTA_MIN) continue;
      const last = autoAiLastRunAtRef.current[id] || 0;
      if (now - last < AUTO_AI_MIN_GAP_MS) continue;
      if (autoAiTimersRef.current[id]) continue;
      autoAiTimersRef.current[id] = window.setTimeout(async () => {
        delete autoAiTimersRef.current[id];
        autoAiLastRunAtRef.current[id] = Date.now();
        try {
          const updated = await aiRefreshRaidItem(id);
          setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        } catch {
          /* silent */
        }
      }, AUTO_AI_DEBOUNCE_MS);
    }
  }, [items, busyId]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!hotRowId || isTypingTarget(e.target)) return;
      const it = items.find((x) => x.id === hotRowId);
      if (!it) return;
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        const next = cycleInList(STATUS_ORDER, safeStr(it.status) || "Open");
        void onPatch(it.id, { status: next });
        return;
      }
      if (key === "p") {
        e.preventDefault();
        const next = cycleInList(PRIORITY_ORDER, safeStr(it.priority || ""));
        void onPatch(it.id, { priority: next || null });
        return;
      }
      if (e.ctrlKey && !e.altKey && ["1", "2", "3", "4"].includes(e.key) && !e.shiftKey) {
        e.preventDefault();
        const v = (STATUS_ORDER as readonly string[])[Number(e.key) - 1];
        if (v) void onPatch(it.id, { status: v });
        return;
      }
      if (e.ctrlKey && e.shiftKey && !e.altKey && ["0", "1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        const v = (PRIORITY_ORDER as readonly string[])[Number(e.key)];
        void onPatch(it.id, { priority: v ? v : null });
        return;
      }
    }
    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotRowId, items, onPatch]);

  useEffect(() => {
    if (!digest) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDigest(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [digest]);

  // Focus deep link
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams(window.location.search);
      const focusId = safeStr(qs.get("focus")).trim();
      const focusPid = safeStr(qs.get("pid")).trim();
      const hashPid = safeStr((window.location.hash || "").replace(/^#/, "")).trim();
      const el =
        (focusId && document.querySelector(`[data-raid-id="${CSS.escape(focusId)}"]`)) ||
        (focusPid && document.querySelector(`[data-raid-public="${CSS.escape(focusPid)}"]`)) ||
        (hashPid && document.querySelector(`[data-raid-public="${CSS.escape(hashPid)}"]`)) ||
        null;
      if (el && el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const id = focusId || safeStr(el.getAttribute("data-raid-id")).trim();
        if (id) setHotRowId(id);
        try {
          el.focus();
        } catch {}
      }
    }, 120);
    return () => clearTimeout(t);
  }, []);

  // Group actions
  const closeMenu = useCallback(() => setMenuOpenFor(""), []);
  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushBanner("success", `Copied ${text}`);
    } catch {
      pushBanner("error", "Copy failed");
    }
  }
  async function copyLinkToClipboard(path: string) {
    const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    const full = origin ? `${origin}${path}` : path;
    return copyToClipboard(full);
  }
  function exportGroupExcel(type: RaidType) {
    window.open(`/api/raid/export/excel?projectId=${encodeURIComponent(projectId)}&type=${encodeURIComponent(type)}`, "_blank");
    closeMenu();
  }
  function exportGroupPdf(type: RaidType) {
    window.open(`/api/raid/export/pdf?projectId=${encodeURIComponent(projectId)}&type=${encodeURIComponent(type)}`, "_blank");
    closeMenu();
  }
  async function refreshAiForGroup(type: RaidType) {
    closeMenu();
    const groupItems = items.filter((x) => normalizeType(x.type) === type);
    if (!groupItems.length) {
      pushBanner("success", `No ${type} items to refresh`);
      return;
    }
    setBusyId(`ai:group:${type}`);
    try {
      for (let i = 0; i < groupItems.length; i++) {
        const id = groupItems[i].id;
        try {
          const updated = await aiRefreshRaidItem(id);
          setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        } catch {}
        await new Promise((r) => setTimeout(r, 350));
      }
      pushBanner("success", `${type}: AI refreshed (${groupItems.length})`);
    } catch (e: any) {
      pushBanner("error", e?.message || "Group AI refresh failed");
    } finally {
      setBusyId("");
    }
  }
  async function copyGroupLink(type: RaidType) {
    await copyLinkToClipboard(`/projects/${routeProjectId}/raid#${encodeURIComponent(type.toLowerCase())}`);
    closeMenu();
  }

  const onDragEnd = useCallback((result: DropResult) => {
    const { destination, source, draggableId } = result;
    if (!destination) return;
    if (destination.droppableId === source.droppableId && destination.index === source.index) return;
    const srcGroup = source.droppableId.replace(/^group:/, "") as RaidType;
    const dstGroup = destination.droppableId.replace(/^group:/, "") as RaidType;
    if (srcGroup !== dstGroup) return;
    setItems((prev) => {
      const group = prev.filter((x) => normalizeType(x.type) === srcGroup);
      const moving = group.find((x) => dndIdForRaid(x) === draggableId);
      if (!moving) return prev;
      const nextGroup = reorder(group, source.index, destination.index);
      const others = prev.filter((x) => normalizeType(x.type) !== srcGroup);
      return [...nextGroup, ...others];
    });
    pushBanner("success", `${srcGroup}: reordered`);
  }, [pushBanner]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans antialiased">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">RAID Log</h1>
                <div className="flex items-center gap-2 text-sm text-slate-600 mt-0.5">
                  <span className="font-medium text-slate-800">{humanProjectTitle}</span>
                  {humanClient && <span className="text-slate-400">•</span>}
                  {humanClient && <span>{humanClient}</span>}
                  <span className="text-slate-400">•</span>
                  <span className="font-mono text-xs bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    {humanProjectId}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href={`/projects/${routeProjectId}`}
                className="text-sm text-slate-600 hover:text-slate-900 font-medium px-4 py-2 rounded-lg hover:bg-slate-100 transition-colors"
              >
                Back to Project
              </Link>
              <div className="h-6 w-px bg-slate-200" />
              <button
                onClick={onWeeklyDigest}
                disabled={digestBusy}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
              >
                {digestBusy ? <span className="animate-pulse">Generating…</span> : "Weekly Digest"}
              </button>
              <button
                onClick={onRefreshAll}
                disabled={busyId === "refresh:all"}
                className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
              >
                {busyId === "refresh:all" ? "Refreshing…" : "Refresh All"}
              </button>
              <div className="relative group">
                <button className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 transition-colors shadow-sm">
                  Export
                  <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 py-1">
                  <button
                    onClick={() => window.open(`/api/raid/export/excel?projectId=${encodeURIComponent(projectId)}`, "_blank")}
                    className="block w-full text-left px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Export Excel
                  </button>
                  <button
                    onClick={() => window.open(`/api/raid/export/pdf?projectId=${encodeURIComponent(projectId)}`, "_blank")}
                    className="block w-full text-left px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Export PDF
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-8 py-3 border-t border-slate-100 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-blue-500" />
              <span>
                <span className="font-semibold text-slate-900">{stats.open}</span> Open
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-rose-500" />
              <span>
                <span className="font-semibold text-slate-900">{stats.high}</span> High Exposure
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span>
                <span className="font-semibold text-slate-900">{stats.mitigated}</span> Mitigated
              </span>
            </div>
            <div className="ml-auto text-slate-500">
              {stats.total} total items
            </div>
          </div>
        </div>
      </header>

      {/* Banners */}
      <div className="max-w-[1800px] mx-auto px-6 lg:px-8 mt-5 space-y-3">
        {banners.map((b) => (
          <div
            key={b.id}
            className={`p-3.5 rounded-xl text-sm flex items-center gap-3 border shadow-sm ${
              b.kind === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}
          >
            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/80 border border-black/10 font-bold">
              {b.kind === "success" ? "✓" : "!"}
            </span>
            <div className="flex-1 font-medium">{b.text}</div>
            <button
              onClick={() => dismissBanner(b.id)}
              className="p-1.5 rounded-lg hover:bg-black/5 transition-colors"
              aria-label="Dismiss"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* Main */}
      <main className="max-w-[1800px] mx-auto px-6 lg:px-8 py-8 pb-32">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="space-y-10">
            {(Object.keys(grouped) as RaidType[]).map((type) => {
              const typeStyle = TYPE_STYLES[type];
              const groupItems = grouped[type];
              const isOpen = openGroups[type];

              return (
                <section
                  key={type}
                  className={`bg-white rounded-2xl border ${typeStyle.border} shadow-sm overflow-hidden`}
                >
                  {/* Group Header */}
                  <div
                    className={`${typeStyle.headerBg} px-6 py-5 border-b ${typeStyle.border} flex items-center justify-between`}
                  >
                    <div className="flex items-center gap-4">
                      <button
                        onClick={() => toggleGroup(type)}
                        className={`p-2 rounded-xl hover:bg-white/60 transition-colors ${typeStyle.text}`}
                      >
                        <svg
                          className={`w-6 h-6 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                      <div
                        className={`w-10 h-10 rounded-xl bg-white border ${typeStyle.border} flex items-center justify-center shadow-sm ${typeStyle.icon}`}
                      >
                        {/* Your type-specific icons here */}
                        {type === "Risk" && (
                          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                        )}
                        {/* ... other types ... */}
                      </div>
                      <div>
                        <h2 className={`text-xl font-bold ${typeStyle.text}`}>{type}s</h2>
                        <p className="text-sm text-slate-600 mt-0.5">{typeStyle.desc}</p>
                      </div>
                      <span className="ml-3 px-4 py-1.5 bg-white border border-slate-200 rounded-full text-sm font-semibold text-slate-700 shadow-sm">
                        {groupItems.length}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        ref={(el) => (menuBtnRefs.current[type] = el)}
                        onClick={() => setMenuOpenFor(menuOpenFor === type ? "" : type)}
                        className="p-2.5 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                      >
                        <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                        </svg>
                      </button>

                      {menuOpenFor === type && (
                        <div
                          ref={menuRef}
                          className="absolute right-6 mt-2 w-60 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 py-2"
                        >
                          <div className="px-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            {type} Actions
                          </div>
                          <button
                            onClick={() => exportGroupExcel(type)}
                            className="w-full text-left px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            Export to Excel
                          </button>
                          <button
                            onClick={() => exportGroupPdf(type)}
                            className="w-full text-left px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            Export to PDF
                          </button>
                          <div className="my-1.5 border-t border-slate-100" />
                          <button
                            onClick={() => refreshAiForGroup(type)}
                            disabled={busyId === `ai:group:${type}`}
                            className="w-full text-left px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
                          >
                            {busyId === `ai:group:${type}` ? "Refreshing AI…" : "Refresh AI (Group)"}
                          </button>
                          <button
                            onClick={() => copyGroupLink(type)}
                            className="w-full text-left px-5 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                          >
                            Copy Group Link
                          </button>
                        </div>
                      )}

                      <button
                        onClick={() => onCreate(type)}
                        disabled={busyId === `new:${type}`}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-slate-300 text-slate-700 font-medium rounded-xl hover:bg-slate-50 shadow-sm disabled:opacity-60 transition-colors"
                      >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        New {type}
                      </button>
                    </div>
                  </div>

                  {isOpen && (
                    <Droppable droppableId={`group:${type}`} direction="vertical">
                      {(dropProvided, dropSnapshot) => (
                        <div
                          ref={dropProvided.innerRef}
                          {...dropProvided.droppableProps}
                          className={`overflow-x-auto ${dropSnapshot.isDraggingOver ? "bg-indigo-50/30" : ""}`}
                        >
                          <table className="w-full text-sm border-collapse table-fixed">
                            <thead className="bg-slate-50/90 border-b border-slate-200 sticky top-0 z-10 backdrop-blur-sm">
                              <tr>
                                <th className="w-10 px-4 py-4"></th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-40 border-r border-slate-200">ID</th>
                                <th
                                  className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider relative group border-r border-slate-200"
                                  style={{ width: colW.desc }}
                                >
                                  Description
                                  <span
                                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-300/50 transition-colors"
                                    onMouseDown={(e) => startResize("desc", e)}
                                  />
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-72 border-r border-slate-200">
                                  Owner *
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-48 border-r border-slate-200">
                                  Status *
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-44 border-r border-slate-200">
                                  Priority
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-28 border-r border-slate-200">
                                  Likelihood
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-28 border-r border-slate-200">
                                  Severity
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-20 border-r border-slate-200">
                                  Score
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-36 border-r border-slate-200">
                                  Due Date
                                </th>
                                <th
                                  className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider relative group border-r border-slate-200"
                                  style={{ width: colW.resp }}
                                >
                                  Response Plan
                                  <span
                                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-300/50 transition-colors"
                                    onMouseDown={(e) => startResize("resp", e)}
                                  />
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-64 border-r border-slate-200">
                                  AI Rollup
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-32 border-r border-slate-200">
                                  Updated
                                </th>
                                <th className="px-5 py-4 text-left text-xs font-semibold text-slate-600 uppercase tracking-wider w-44 border-r border-slate-200">
                                  Trend
                                </th>
                                <th className="px-5 py-4 text-right text-xs font-semibold text-slate-600 uppercase tracking-wider w-28">
                                  Actions
                                </th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {groupItems.length === 0 ? (
                                <tr>
                                  <td colSpan={15} className="px-6 py-16 text-center text-slate-500">
                                    <div className="flex flex-col items-center gap-3">
                                      <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center text-slate-400">
                                        <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                        </svg>
                                      </div>
                                      <p className="text-lg font-medium">No {type.toLowerCase()}s yet</p>
                                      <p className="text-sm text-slate-500">Create one to get started</p>
                                    </div>
                                  </td>
                                </tr>
                              ) : (
                                groupItems.map((it, index) => {
                                  const sc = calcScore(it.probability, it.severity);
                                  const tone = toneFromScore(sc);
                                  const isBusy = busyId === it.id;
                                  const owner = safeStr(it.owner_label).trim();
                                  const ownerOk = owner.length > 0 && owner.toLowerCase() !== "tbc";
                                  const plan = safeStr(it.response_plan || "").trim();
                                  const planOk = plan.length > 0 && plan.toLowerCase() !== "tbc";
                                  const touched = touchedById[it.id] || {};
                                  const showOwnerWarn = Boolean(touched.owner) && !ownerOk;
                                  const showPlanWarn = Boolean(touched.plan) && !planOk;
                                  const stKey = statusToken(it.status);
                                  const priKey = priorityToken(it.priority);
                                  const stStyle = STATUS_STYLES[stKey] || STATUS_STYLES.open;
                                  const priStyle = PRIORITY_STYLES[priKey] || PRIORITY_STYLES[""];
                                  const ai = it?.related_refs?.ai || {};
                                  const runs = aiRunsById[it.id] || [];
                                  const cmp = aiCompareById[it.id] || { a: "", b: "" };
                                  const runA = cmp.a ? getRun(runs, cmp.a) : null;
                                  const runB = cmp.b ? getRun(runs, cmp.b) : null;
                                  const diffSummary = runA && runB ? diffLines(runA.ai?.summary, runB.ai?.summary) : null;
                                  const diffRollup = runA && runB ? diffLines(runA.ai?.rollup, runB.ai?.rollup) : null;
                                  const diffRecs = runA && runB ? diffList(runA.ai?.recommendations, runB.ai?.recommendations) : null;
                                  const stale = staleById[it.id];
                                  const trend = getTrend(it);
                                  const deptKey = safeStr(it.owner_label).split(/\s+/)[0] || "default";
                                  const deptClass = DEPT_STYLES[deptKey] || DEPT_STYLES.default;

                                  return (
                                    <Draggable
                                      key={dndIdForRaid(it)}
                                      draggableId={dndIdForRaid(it)}
                                      index={index}
                                      isDragDisabled={Boolean(isBusy)}
                                    >
                                      {(dragProvided, dragSnapshot) => (
                                        <React.Fragment>
                                          <tr
                                            ref={dragProvided.innerRef}
                                            {...dragProvided.draggableProps}
                                            data-raid-id={it.id}
                                            data-raid-public={safeStr(it.public_id || "").trim()}
                                            className={[
                                              "group transition-all duration-150",
                                              "hover:bg-slate-50/70",
                                              isBusy ? "opacity-60 pointer-events-none" : "",
                                              stale ? "bg-amber-50/40" : "",
                                              dragSnapshot.isDragging ? "bg-indigo-50/60 shadow-lg scale-[1.01]" : "",
                                            ].join(" ")}
                                            tabIndex={0}
                                            onFocus={() => setHotRowId(it.id)}
                                            onMouseDown={() => setHotRowId(it.id)}
                                          >
                                            {/* Drag handle + ID */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <div className="flex items-center gap-3">
                                                <button
                                                  type="button"
                                                  {...dragProvided.dragHandleProps}
                                                  className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-grab active:cursor-grabbing transition-colors"
                                                  title="Drag to reorder"
                                                >
                                                  <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
                                                    <path d="M7 4a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0zM7 10a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0zM7 16a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
                                                  </svg>
                                                </button>
                                                <span className="font-mono text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded border border-slate-200">
                                                  {safeStr(it.public_id) || "—"}
                                                </span>
                                                {stale && (
                                                  <button
                                                    onClick={() => onReloadRow(it.id)}
                                                    title="Reload latest version"
                                                    className="text-amber-600 hover:text-amber-800"
                                                  >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                    </svg>
                                                  </button>
                                                )}
                                              </div>
                                              {stale && <div className="text-xs text-amber-700 mt-1.5 max-w-[220px]">{stale.message}</div>}
                                            </td>

                                            {/* Description */}
                                            <td className="px-5 py-4 border-r border-slate-200" style={{ width: colW.desc }}>
                                              <textarea
                                                className="w-full min-h-[64px] p-3 text-sm bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 resize-y transition-all shadow-sm"
                                                value={safeStr(it.description)}
                                                disabled={isBusy}
                                                placeholder="Describe the item…"
                                                onChange={(e) =>
                                                  setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, description: e.target.value } : x)))
                                                }
                                                onBlur={() => onPatch(it.id, { description: safeStr(it.description).trim() || "Untitled" })}
                                              />
                                            </td>

                                            {/* Owner */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <div className="space-y-1">
                                                <input
                                                  className={`w-full px-3 py-2.5 text-sm border rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm ${
                                                    showOwnerWarn ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                                                  }`}
                                                  value={safeStr(it.owner_label)}
                                                  disabled={isBusy}
                                                  placeholder="e.g. Alex Adu-Poku"
                                                  onChange={(e) =>
                                                    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, owner_label: e.target.value } : x)))
                                                  }
                                                  onBlur={() => {
                                                    touch(it.id, "owner");
                                                    onPatch(it.id, { owner_label: safeStr(it.owner_label).trim() });
                                                  }}
                                                />
                                                {showOwnerWarn && <div className="text-xs text-rose-600 font-medium pl-1">Owner required</div>}
                                              </div>
                                            </td>

                                            {/* Status - pill */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <select
                                                className={`
                                                  w-full px-4 py-2.5 text-sm font-bold rounded-full border-0 appearance-none cursor-pointer text-center shadow-md
                                                  transition-all hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-offset-2
                                                  ${stStyle.gradient} ${stStyle.text} ${stStyle.shadow} ${stStyle.ring}
                                                `}
                                                value={safeStr(it.status || "Open")}
                                                disabled={isBusy}
                                                onChange={(e) => onPatch(it.id, { status: e.target.value })}
                                              >
                                                <option value="Open">Open</option>
                                                <option value="In Progress">In Progress</option>
                                                <option value="Mitigated">Mitigated</option>
                                                <option value="Closed">Closed</option>
                                              </select>
                                            </td>

                                            {/* Priority - pill */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <select
                                                className={`
                                                  w-full px-4 py-2.5 text-sm font-bold rounded-full border-0 appearance-none cursor-pointer text-center shadow-md
                                                  transition-all hover:brightness-105 focus:outline-none focus:ring-2 focus:ring-offset-2
                                                  ${priStyle.gradient} ${priStyle.text} ${priStyle.shadow} ${priStyle.ring}
                                                `}
                                                value={safeStr(it.priority || "")}
                                                disabled={isBusy}
                                                onChange={(e) => onPatch(it.id, { priority: e.target.value || null })}
                                              >
                                                <option value="">—</option>
                                                <option value="Low">Low</option>
                                                <option value="Medium">Medium</option>
                                                <option value="High">High</option>
                                                <option value="Critical">Critical</option>
                                              </select>
                                            </td>

                                            {/* Likelihood */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <input
                                                className="w-full px-3 py-2.5 text-center text-base font-semibold border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
                                                type="number"
                                                min={0}
                                                max={100}
                                                value={Number.isFinite(Number(it.probability)) ? it.probability : ""}
                                                disabled={isBusy}
                                                onChange={(e) =>
                                                  setItems((prev) =>
                                                    prev.map((x) => (x.id === it.id ? { ...x, probability: clampNum(e.target.value, 0, 100) } : x))
                                                  )
                                                }
                                                onBlur={() => onPatch(it.id, { probability: clampNum(it.probability ?? 0, 0, 100) })}
                                              />
                                            </td>

                                            {/* Severity */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <input
                                                className="w-full px-3 py-2.5 text-center text-base font-semibold border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
                                                type="number"
                                                min={0}
                                                max={100}
                                                value={Number.isFinite(Number(it.severity)) ? it.severity : ""}
                                                disabled={isBusy}
                                                onChange={(e) =>
                                                  setItems((prev) =>
                                                    prev.map((x) => (x.id === it.id ? { ...x, severity: clampNum(e.target.value, 0, 100) } : x))
                                                  )
                                                }
                                                onBlur={() => onPatch(it.id, { severity: clampNum(it.severity ?? 0, 0, 100) })}
                                              />
                                            </td>

                                            {/* Score */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <div className="flex items-center justify-center gap-3">
                                                <div
                                                  className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-bold shadow-md ${
                                                    tone === "r"
                                                      ? "bg-rose-500 text-white"
                                                      : tone === "a"
                                                      ? "bg-amber-400 text-white"
                                                      : "bg-emerald-500 text-white"
                                                  }`}
                                                >
                                                  {sc}
                                                </div>
                                                <div className="w-20 h-2.5 bg-slate-200 rounded-full overflow-hidden">
                                                  <div
                                                    className={`h-full rounded-full ${
                                                      tone === "r" ? "bg-rose-500" : tone === "a" ? "bg-amber-400" : "bg-emerald-500"
                                                    }`}
                                                    style={{ width: `${sc}%` }}
                                                  />
                                                </div>
                                              </div>
                                            </td>

                                            {/* Due Date */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <input
                                                className="w-full px-3 py-2.5 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm"
                                                type="date"
                                                value={fmtDateOnly(it.due_date)}
                                                disabled={isBusy}
                                                onChange={(e) =>
                                                  setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, due_date: e.target.value || null } : x)))
                                                }
                                                onBlur={() => onPatch(it.id, { due_date: safeStr(it.due_date).trim() || null })}
                                              />
                                            </td>

                                            {/* Response Plan */}
                                            <td className="px-5 py-4 border-r border-slate-200" style={{ width: colW.resp }}>
                                              <div className="space-y-1">
                                                <textarea
                                                  className={`w-full min-h-[64px] p-3 text-sm bg-white border rounded-xl resize-y focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400 transition-all shadow-sm ${
                                                    showPlanWarn ? "border-rose-400 bg-rose-50/50" : "border-slate-200"
                                                  }`}
                                                  value={safeStr(it.response_plan || "")}
                                                  disabled={isBusy}
                                                  placeholder="Mitigation / response plan…"
                                                  onChange={(e) =>
                                                    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, response_plan: e.target.value } : x)))
                                                  }
                                                  onBlur={() => {
                                                    touch(it.id, "plan");
                                                    onPatch(it.id, { response_plan: safeStr(it.response_plan || "").trim() || null });
                                                  }}
                                                />
                                                {showPlanWarn && <div className="text-xs text-rose-600 font-medium pl-1">Plan required</div>}
                                              </div>
                                            </td>

                                            {/* AI Rollup */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <div className="max-w-xs">
                                                {it.ai_rollup ? (
                                                  <p className="text-sm text-slate-700 line-clamp-2" title={it.ai_rollup}>
                                                    {it.ai_rollup}
                                                  </p>
                                                ) : (
                                                  <span className="text-sm text-slate-400 italic">No AI analysis yet</span>
                                                )}
                                              </div>
                                            </td>

                                            {/* Updated */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <span className="text-sm text-slate-600 font-medium">{fmtWhen(it.updated_at)}</span>
                                            </td>

                                            {/* Trend */}
                                            <td className="px-5 py-4 border-r border-slate-200">
                                              <div
                                                className={`
                                                  inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium shadow-sm
                                                  ${trend.bg} ${trend.text}
                                                `}
                                              >
                                                <span className="font-black text-lg leading-none">{trend.icon}</span>
                                                {trend.label}
                                              </div>
                                            </td>

                                            {/* Actions */}
                                            <td className="px-5 py-4 text-right">
                                              <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                <button
                                                  onClick={() => setAiOpenId(aiOpenId === it.id ? "" : it.id)}
                                                  className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                                  title="AI Insights"
                                                >
                                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                  </svg>
                                                </button>
                                                <button
                                                  onClick={() => onAiRefresh(it.id)}
                                                  disabled={isBusy}
                                                  className="p-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                                  title="Refresh AI"
                                                >
                                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                  </svg>
                                                </button>
                                                <button
                                                  onClick={() => onDelete(it.id)}
                                                  disabled={isBusy}
                                                  className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                                  title="Delete"
                                                >
                                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                  </svg>
                                                </button>
                                              </div>
                                            </td>
                                          </tr>

                                          {/* AI Panel */}
                                          {aiOpenId === it.id && (
                                            <tr>
                                              <td colSpan={15} className="bg-indigo-50/60 border-b border-indigo-100">
                                                <div className="p-6">
                                                  <div className="flex items-center justify-between mb-5">
                                                    <div className="flex items-center gap-4">
                                                      <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center text-indigo-600 shadow-sm">
                                                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                        </svg>
                                                      </div>
                                                      <div>
                                                        <h3 className="font-bold text-slate-900 text-lg">AI Insights</h3>
                                                        <p className="text-sm text-slate-600 mt-0.5">
                                                          Status: {safeStr(ai.ai_status) || "—"} • Quality:{" "}
                                                          {Number.isFinite(ai.ai_quality) ? `${Math.round(ai.ai_quality)}/100` : "—"} •{" "}
                                                          {safeStr(ai.last_run_at) ? fmtWhen(ai.last_run_at) : "Never run"}
                                                        </p>
                                                      </div>
                                                    </div>
                                                    <div className="flex items-center gap-3">
                                                      <button
                                                        onClick={() => openHistory(it.id)}
                                                        disabled={aiHistBusyId === it.id}
                                                        className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-100 hover:bg-indigo-200 rounded-xl transition-colors shadow-sm"
                                                      >
                                                        {aiHistBusyId === it.id
                                                          ? "Loading…"
                                                          : aiHistOpenId === it.id
                                                          ? "Hide History"
                                                          : "View History"}
                                                      </button>
                                                      <button
                                                        onClick={() => setAiOpenId("")}
                                                        className="p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl transition-colors"
                                                      >
                                                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                      </button>
                                                    </div>
                                                  </div>

                                                  <div className="grid gap-6">
                                                    <div className="bg-white rounded-xl p-5 border border-indigo-100 shadow-sm">
                                                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Summary</h4>
                                                      <p className="text-sm text-slate-700 leading-relaxed">
                                                        {safeStr(ai.summary || it.ai_rollup || "No summary available yet.")}
                                                      </p>
                                                    </div>

                                                    <div className="bg-white rounded-xl p-5 border border-indigo-100 shadow-sm">
                                                      <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Recommendations</h4>
                                                      <div className="space-y-3">
                                                        {(ai?.recommendations || []).length > 0 ? (
                                                          ai.recommendations.map((r: string, idx: number) => (
                                                            <div key={idx} className="flex items-start gap-3 p-3.5 bg-slate-50 rounded-lg border border-slate-100">
                                                              <span className="flex-shrink-0 w-7 h-7 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-sm font-bold">
                                                                {idx + 1}
                                                              </span>
                                                              <p className="text-sm text-slate-700 leading-relaxed">{r}</p>
                                                            </div>
                                                          ))
                                                        ) : (
                                                          <p className="text-sm text-slate-500 italic py-2">
                                                            No recommendations yet. Click "Refresh AI" to generate.
                                                          </p>
                                                        )}
                                                      </div>
                                                    </div>

                                                    {aiHistOpenId === it.id && (
                                                      <div className="bg-white rounded-xl p-5 border border-indigo-100 shadow-sm">
                                                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Version History & Diff</h4>
                                                        {runs.length === 0 ? (
                                                          <p className="text-sm text-slate-500">No history available.</p>
                                                        ) : (
                                                          <div className="space-y-5">
                                                            <div className="flex items-center gap-5">
                                                              <div className="flex-1">
                                                                <label className="text-xs text-slate-500 mb-1.5 block font-medium">Version A</label>
                                                                <select
                                                                  className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-400 shadow-sm"
                                                                  value={cmp.a}
                                                                  onChange={(e) =>
                                                                    setAiCompareById((prev) => ({
                                                                      ...prev,
                                                                      [it.id]: { ...prev[it.id], a: e.target.value },
                                                                    }))
                                                                  }
                                                                >
                                                                  {runs.map((r) => (
                                                                    <option key={r.id} value={r.id}>
                                                                      {fmtWhen(r.created_at)} • {safeStr(r.version) || "v?"} • Q{Math.round(r.ai_quality || 0)}
                                                                    </option>
                                                                  ))}
                                                                </select>
                                                              </div>
                                                              <div className="text-slate-400 pt-6 font-medium">vs</div>
                                                              <div className="flex-1">
                                                                <label className="text-xs text-slate-500 mb-1.5 block font-medium">Version B</label>
                                                                <select
                                                                  className="w-full text-sm border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-400 shadow-sm"
                                                                  value={cmp.b}
                                                                  onChange={(e) =>
                                                                    setAiCompareById((prev) => ({
                                                                      ...prev,
                                                                      [it.id]: { ...prev[it.id], b: e.target.value },
                                                                    }))
                                                                  }
                                                                >
                                                                  {runs.map((r) => (
                                                                    <option key={r.id} value={r.id}>
                                                                      {fmtWhen(r.created_at)} • {safeStr(r.version) || "v?"} • Q{Math.round(r.ai_quality || 0)}
                                                                    </option>
                                                                  ))}
                                                                </select>
                                                              </div>
                                                            </div>

                                                            {runA && runB && (
                                                              <div className="space-y-5 border-t border-slate-100 pt-5">
                                                                {diffRollup && (
                                                                  <div className="grid grid-cols-2 gap-5">
                                                                    <div className="p-4 bg-rose-50/60 rounded-xl border border-rose-100">
                                                                      <div className="text-xs font-semibold text-rose-700 mb-1.5">Previous</div>
                                                                      <div className="text-sm text-slate-700">{diffRollup.a}</div>
                                                                    </div>
                                                                    <div className="p-4 bg-emerald-50/60 rounded-xl border border-emerald-100">
                                                                      <div className="text-xs font-semibold text-emerald-700 mb-1.5">Current</div>
                                                                      <div className="text-sm text-slate-700">{diffRollup.b}</div>
                                                                    </div>
                                                                  </div>
                                                                )}
                                                                {/* ... other diff blocks ... */}
                                                                {!diffRollup && !diffSummary && !diffRecs && (
                                                                  <p className="text-sm text-slate-500 text-center py-6 italic">
                                                                    No differences between selected versions.
                                                                  </p>
                                                                )}
                                                              </div>
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                </div>
                                              </td>
                                            </tr>
                                          )}
                                        </React.Fragment>
                                      )}
                                    </Draggable>
                                  );
                                })
                              )}
                              {dropProvided.placeholder}
                            </tbody>
                          </table>

                          {/* Add item footer */}
                          <div className="px-6 py-5 border-t border-slate-200 bg-slate-50/70">
                            <button
                              onClick={() => onCreate(type)}
                              disabled={busyId === `new:${type}`}
                              className="inline-flex items-center gap-2 px-6 py-3 bg-white border border-slate-300 text-slate-700 font-medium rounded-xl hover:bg-slate-50 shadow-sm disabled:opacity-50 transition-colors"
                            >
                              + Add item
                            </button>
                          </div>
                        </div>
                      )}
                    </Droppable>
                  )}
                </section>
              );
            })}
          </div>
        </DragDropContext>
      </main>

      {/* Digest Modal - unchanged from your original */}
      {digest && (
        <div
          className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm flex items-start justify-center p-4 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDigest(null);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-8 overflow-hidden">
            {/* ... your original digest modal content ... */}
          </div>
        </div>
      )}
    </div>
  );
}