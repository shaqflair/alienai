"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

type RaidType = "Risk" | "Assumption" | "Issue" | "Dependency";
type RaidStatus = "Open" | "In Progress" | "Mitigated" | "Closed" | "Invalid";

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
  return typeof x === "string" ? x : "";
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

const STATUS_ORDER = ["Open", "In Progress", "Mitigated", "Closed", "Invalid"] as const;
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

/* ---------------- styling tokens ---------------- */

const TYPE_STYLES: Record<RaidType, { bg: string; border: string; text: string; icon: string; desc: string }> = {
  Risk: {
    bg: "bg-rose-50",
    border: "border-rose-200",
    text: "text-rose-900",
    icon: "text-rose-600",
    desc: "Events that may happen — mitigate early",
  },
  Assumption: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-900",
    icon: "text-amber-600",
    desc: "Beliefs we hold — validate them",
  },
  Issue: {
    bg: "bg-orange-50",
    border: "border-orange-200",
    text: "text-orange-900",
    icon: "text-orange-600",
    desc: "Active problems — resolve quickly",
  },
  Dependency: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    text: "text-blue-900",
    icon: "text-blue-600",
    desc: "External blockers — track closely",
  },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  open: { bg: "bg-slate-100", text: "text-slate-700", dot: "bg-slate-500" },
  inprogress: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-500" },
  mitigated: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  closed: { bg: "bg-gray-100", text: "text-gray-600", dot: "bg-gray-400" },
  invalid: { bg: "bg-gray-50", text: "text-gray-400", dot: "bg-gray-300" },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string; dot: string }> = {
  "": { bg: "bg-transparent", text: "text-gray-400", dot: "bg-gray-200" },
  low: { bg: "bg-gray-50", text: "text-gray-600", dot: "bg-gray-300" },
  medium: { bg: "bg-blue-50", text: "text-blue-700", dot: "bg-blue-400" },
  high: { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  critical: { bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-600" },
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
  const j = await postJson(`/api/raid/digest?projectId=${encodeURIComponent(projectId)}`, "GET");
  return j.digest as any;
}

async function fetchAiHistory(raidId: string) {
  const res = await fetch(`/api/raid/${encodeURIComponent(raidId)}/ai-history`, { method: "GET" });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`);
  return (j.runs ?? []) as AiRun[];
}

/* ---------------- component ---------------- */

type ColKey = "desc" | "resp";
const DEFAULT_COL_WIDTHS: Record<ColKey, number> = { desc: 340, resp: 300 };

export default function RaidClient({
  projectId,
  projectRouteId,
  projectTitle,
  projectClient,
  projectPublicId,
  initialItems,
}: {
  projectId: string; // UUID (API)
  projectRouteId?: string; // human id (URLs) — optional + safe fallback
  projectTitle?: string;
  projectClient?: string;
  projectPublicId?: string;
  initialItems: RaidItem[];
}) {
  const routeProjectId = useMemo(() => safeStr(projectRouteId).trim() || projectId, [projectRouteId, projectId]);

  const [items, setItems] = useState<RaidItem[]>(initialItems ?? []);
  const [busyId, setBusyId] = useState<string>("");
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string>("");

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

  // Column resize handlers
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const key = resizeRef.current.key;
      if (!key) return;
      const dx = e.clientX - resizeRef.current.startX;
      const next = Math.max(200, Math.min(800, resizeRef.current.startW + dx));
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

  const humanProjectId = useMemo(() => safeStr(projectPublicId).trim() || projectId.slice(0, 8) + "…", [projectPublicId, projectId]);
  const humanProjectTitle = useMemo(() => safeStr(projectTitle).trim() || "Untitled project", [projectTitle]);
  const humanClient = useMemo(() => safeStr(projectClient).trim(), [projectClient]);

  // Actions
  const touch = useCallback((id: string, key: "owner" | "plan") => {
    setTouchedById((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: true } }));
  }, []);

  const requireOwner = useCallback((owner: any) => {
    const o = safeStr(owner).trim();
    if (!o) {
      setErr("Owner is mandatory");
      return null;
    }
    return o;
  }, []);

  const onReloadRow = useCallback(async (id: string) => {
    setErr("");
    setMsg("");
    setBusyId(id);
    try {
      const fresh = await fetchRaidItemById(id);
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...fresh } : x)));
      setStaleById((prev) => {
        const n = { ...prev };
        delete n[id];
        return n;
      });
      setMsg("Reloaded");
    } catch (e: any) {
      setErr(e?.message || "Reload failed");
    } finally {
      setBusyId("");
    }
  }, []);

  const onPatch = useCallback(
    async (id: string, patch: any) => {
      setErr("");
      setMsg("");
      setBusyId(id);
      try {
        const current = items.find((x) => x.id === id);
        const expected = safeStr(current?.updated_at).trim();
        if ("owner_label" in patch) {
          const ok = requireOwner(patch.owner_label);
          if (!ok) return;
          patch.owner_label = ok;
        }
        const updated = await patchRaidItem(id, { ...patch, expected_updated_at: expected || undefined });
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        setStaleById((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        setMsg("Saved");
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
            setMsg("Reloaded with latest changes");
          } catch (re: any) {
            setErr(re?.message || "Stale update");
          }
          return;
        }
        setErr(e?.message || "Update failed");
      } finally {
        setBusyId("");
      }
    },
    [items, requireOwner]
  );

  const onCreate = useCallback(
    async (type: RaidType) => {
      setErr("");
      setMsg("");
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
        setMsg(`${type} created`);
      } catch (e: any) {
        setErr(e?.message || "Create failed");
      } finally {
        setBusyId("");
      }
    },
    [projectId]
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this RAID item?")) return;
      setErr("");
      setMsg("");
      setBusyId(id);
      const current = items.find((x) => x.id === id);
      const expected = safeStr(current?.updated_at).trim() || undefined;
      const prev = items;
      setItems((cur) => cur.filter((x) => x.id !== id));
      if (aiOpenId === id) setAiOpenId("");
      if (aiHistOpenId === id) setAiHistOpenId("");
      try {
        await deleteRaidItem(id, expected);
        setMsg("Deleted");
      } catch (e: any) {
        const status = (e as any)?.status;
        const payload = (e as any)?.payload;
        if (status === 409 || payload?.stale) {
          setItems(prev);
          setStaleById((p) => ({
            ...p,
            [id]: { at: new Date().toISOString(), message: "Delete blocked: item was updated by someone else" },
          }));
          return;
        }
        setItems(prev);
        setErr(e?.message || "Delete failed");
      } finally {
        setBusyId("");
      }
    },
    [items, aiOpenId, aiHistOpenId]
  );

  const onAiRefresh = useCallback(async (id: string) => {
    setErr("");
    setMsg("");
    setBusyId(id);
    try {
      const updated = await aiRefreshRaidItem(id);
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
      setMsg("AI updated");
      setAiOpenId(id);
    } catch (e: any) {
      setErr(e?.message || "AI refresh failed");
      setAiOpenId(id);
    } finally {
      setBusyId("");
    }
  }, []);

  const onWeeklyDigest = useCallback(async () => {
    setErr("");
    setMsg("");
    setDigestBusy(true);
    try {
      const d = await fetchWeeklyDigest(projectId);
      setDigest(d);
      setMsg("Digest generated");
    } catch (e: any) {
      setErr(e?.message || "Digest failed");
    } finally {
      setDigestBusy(false);
    }
  }, [projectId]);

  const onRefreshAll = useCallback(async () => {
    setErr("");
    setMsg("");
    setBusyId("refresh:all");
    try {
      const fresh = await fetchRaidItems(projectId);
      setItems(fresh);
      setMsg("Refreshed");
    } catch (e: any) {
      setErr(e?.message || "Refresh failed");
    } finally {
      setBusyId("");
    }
  }, [projectId]);

  const openHistory = useCallback(
    async (id: string) => {
      setErr("");
      setMsg("");
      setAiHistOpenId((cur) => (cur === id ? "" : id));
      if (aiRunsById[id]?.length) return;
      setAiHistBusyId(id);
      try {
        const runs = await fetchAiHistory(id);
        setAiRunsById((prev) => ({ ...prev, [id]: runs }));
        if (runs.length >= 2) setAiCompareById((prev) => ({ ...prev, [id]: { a: runs[0].id, b: runs[1].id } }));
        else if (runs.length === 1) setAiCompareById((prev) => ({ ...prev, [id]: { a: runs[0].id, b: runs[0].id } }));
      } catch (e: any) {
        setErr(e?.message || "Failed to load AI history");
      } finally {
        setAiHistBusyId("");
      }
    },
    [aiRunsById]
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

  // Auto-AI rules
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

      if (e.ctrlKey && !e.altKey && ["1", "2", "3", "4", "5"].includes(e.key) && !e.shiftKey) {
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

  // Focus on deep-linked row
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
      setMsg(`Copied ${text}`);
    } catch {
      setErr("Copy failed");
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
    setMsg("");
    setErr("");
    const groupItems = items.filter((x) => normalizeType(x.type) === type);
    if (!groupItems.length) {
      setMsg(`No ${type} items to refresh`);
      return;
    }
    setBusyId(`ai:group:${type}`);
    try {
      for (let i = 0; i < groupItems.length; i++) {
        const id = groupItems[i].id;
        try {
          const updated = await aiRefreshRaidItem(id);
          setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      setMsg(`${type}: AI refreshed (${groupItems.length})`);
    } catch (e: any) {
      setErr(e?.message || "Group AI refresh failed");
    } finally {
      setBusyId("");
    }
  }

  async function copyGroupLink(type: RaidType) {
    await copyLinkToClipboard(`/projects/${routeProjectId}/raid#${encodeURIComponent(type.toLowerCase())}`);
    closeMenu();
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <div>
                <h1 className="text-xl font-semibold text-gray-900 tracking-tight">RAID Log</h1>
                <div className="flex items-center gap-2 text-sm text-gray-500 mt-0.5">
                  <span className="font-medium text-gray-700">{humanProjectTitle}</span>
                  {humanClient && <span className="text-gray-400">•</span>}
                  {humanClient && <span>{humanClient}</span>}
                  <span className="text-gray-400">•</span>
                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{humanProjectId}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href={`/projects/${routeProjectId}`}
                className="text-sm text-gray-600 hover:text-gray-900 font-medium px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                Back to Project
              </Link>
              <div className="h-6 w-px bg-gray-200" />
              <button
                onClick={onWeeklyDigest}
                disabled={digestBusy}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {digestBusy ? <span className="animate-pulse">Generating…</span> : "Weekly Digest"}
              </button>
              <button
                onClick={onRefreshAll}
                disabled={busyId === "refresh:all"}
                className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {busyId === "refresh:all" ? "Refreshing…" : "Refresh"}
              </button>

              <div className="relative group">
                <button className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  Export
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button
                    onClick={() => window.open(`/api/raid/export/excel?projectId=${encodeURIComponent(projectId)}`, "_blank")}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 first:rounded-t-lg"
                  >
                    Export Excel
                  </button>
                  <button
                    onClick={() => window.open(`/api/raid/export/pdf?projectId=${encodeURIComponent(projectId)}`, "_blank")}
                    className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 last:rounded-b-lg"
                  >
                    Export PDF
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="flex items-center gap-6 py-3 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{stats.open}</span> Open
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-rose-500" />
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{stats.high}</span> High Exposure
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{stats.mitigated}</span> Mitigated
              </span>
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-sm text-gray-500">{stats.total} total items</span>
            </div>
          </div>
        </div>
      </header>

      {/* Messages */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 mt-4">
        {msg && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            {msg}
          </div>
        )}
        {err && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {err}
          </div>
        )}
      </div>

      {/* Main Content */}
      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20">
        <div className="space-y-6">
          {(Object.keys(grouped) as RaidType[]).map((type) => {
            const typeStyle = TYPE_STYLES[type];
            const groupItems = grouped[type];
            const isOpen = openGroups[type];

            return (
              <section key={type} className={`bg-white rounded-xl border ${typeStyle.border} shadow-sm overflow-hidden transition-all duration-200`}>
                {/* Group Header */}
                <div className={`${typeStyle.bg} px-4 py-3 border-b ${typeStyle.border} flex items-center justify-between`}>
                  <div className="flex items-center gap-3">
                    <button onClick={() => toggleGroup(type)} className={`p-1 rounded hover:bg-white/50 transition-colors ${typeStyle.text}`}>
                      <svg className={`w-5 h-5 transform transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>

                    <div className={`w-8 h-8 rounded-lg bg-white border ${typeStyle.border} flex items-center justify-center ${typeStyle.icon}`}>
                      {type === "Risk" && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                      )}
                      {type === "Assumption" && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      )}
                      {type === "Issue" && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      )}
                      {type === "Dependency" && (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                      )}
                    </div>

                    <div>
                      <h2 className={`font-semibold ${typeStyle.text}`}>{type}s</h2>
                      <p className="text-xs text-gray-500">{typeStyle.desc}</p>
                    </div>

                    <span className="ml-2 px-2.5 py-0.5 bg-white border border-gray-200 rounded-full text-xs font-medium text-gray-600">{groupItems.length}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      ref={(el) => {
                        menuBtnRefs.current[type] = el;
                      }}
                      onClick={() => setMenuOpenFor(menuOpenFor === type ? "" : type)}
                      className="p-2 text-gray-500 hover:text-gray-700 hover:bg-white/50 rounded-lg transition-colors"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>

                    {menuOpenFor === type && (
                      <div ref={menuRef} className="absolute right-8 mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 z-50 py-1">
                        <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">{type} Actions</div>
                        <button onClick={() => exportGroupExcel(type)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          Export to Excel
                        </button>
                        <button onClick={() => exportGroupPdf(type)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          Export to PDF
                        </button>
                        <div className="h-px bg-gray-100 my-1" />
                        <button
                          onClick={() => refreshAiForGroup(type)}
                          disabled={busyId === `ai:group:${type}`}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {busyId === `ai:group:${type}` ? "Refreshing AI…" : "Refresh AI (Group)"}
                        </button>
                        <button onClick={() => copyGroupLink(type)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                          Copy Group Link
                        </button>
                      </div>
                    )}

                    <button
                      onClick={() => onCreate(type)}
                      disabled={busyId === `new:${type}`}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border ${typeStyle.border} ${typeStyle.text} text-sm font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm`}
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      New {type}
                    </button>
                  </div>
                </div>

                {/* Table */}
                {isOpen && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">ID</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider relative group" style={{ width: colW.desc }}>
                            Description
                            <span className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-300 transition-colors" onMouseDown={(e) => startResize("desc", e)} />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-64">Owner *</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-48">Status *</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-44">Priority</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Likelihood</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Severity</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-20">Score</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-32">Due Date</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider relative group" style={{ width: colW.resp }}>
                            Response Plan
                            <span className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-300 transition-colors" onMouseDown={(e) => startResize("resp", e)} />
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-48">AI Rollup</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Updated</th>
                          <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider w-24">Actions</th>
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-gray-100">
                        {groupItems.length === 0 ? (
                          <tr>
                            <td colSpan={13} className="px-4 py-12 text-center text-gray-500">
                              <div className="flex flex-col items-center gap-2">
                                <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-gray-400">
                                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                </div>
                                <p>No {type.toLowerCase()}s yet. Create one to get started.</p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          groupItems.map((it) => {
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
                            const stStyle = STATUS_STYLES[stKey];
                            const priStyle = PRIORITY_STYLES[priKey];

                            const ai = it?.related_refs?.ai || {};
                            const runs = aiRunsById[it.id] || [];
                            const cmp = aiCompareById[it.id] || { a: "", b: "" };
                            const runA = cmp.a ? getRun(runs, cmp.a) : null;
                            const runB = cmp.b ? getRun(runs, cmp.b) : null;
                            const diffSummary = runA && runB ? diffLines(runA.ai?.summary, runB.ai?.summary) : null;
                            const diffRollup = runA && runB ? diffLines(runA.ai?.rollup, runB.ai?.rollup) : null;
                            const diffRecs = runA && runB ? diffList(runA.ai?.recommendations, runB.ai?.recommendations) : null;

                            const stale = staleById[it.id];

                            return (
                              <React.Fragment key={it.id}>
                                <tr
                                  data-raid-id={it.id}
                                  data-raid-public={safeStr(it.public_id || "").trim()}
                                  className={`group hover:bg-gray-50/80 transition-colors ${isBusy ? "opacity-60" : ""} ${stale ? "bg-amber-50/30" : ""}`}
                                  tabIndex={0}
                                  onFocus={() => setHotRowId(it.id)}
                                  onMouseDown={() => setHotRowId(it.id)}
                                >
                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded border border-gray-200">{safeStr(it.public_id) || "—"}</span>
                                      {stale && (
                                        <button onClick={() => onReloadRow(it.id)} title="Reload" className="text-amber-600 hover:text-amber-700">
                                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                          </svg>
                                        </button>
                                      )}
                                    </div>
                                    {stale && <div className="text-xs text-amber-700 mt-1 max-w-[200px]">{stale.message}</div>}
                                  </td>

                                  <td className="px-4 py-3" style={{ width: colW.desc }}>
                                    <textarea
                                      className="w-full min-h-[60px] p-2 text-sm bg-white border border-gray-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 resize-y transition-shadow"
                                      value={safeStr(it.description)}
                                      disabled={isBusy}
                                      placeholder="Describe the item…"
                                      onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, description: e.target.value } : x)))}
                                      onBlur={() => onPatch(it.id, { description: safeStr(it.description).trim() || "Untitled" })}
                                    />
                                  </td>

                                  <td className="px-4 py-3">
                                    <div className="space-y-1">
                                      <input
                                        className={`w-full px-2 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors ${
                                          showOwnerWarn ? "border-rose-500 bg-rose-50" : "border-gray-200"
                                        }`}
                                        value={safeStr(it.owner_label)}
                                        disabled={isBusy}
                                        placeholder="e.g. Alex Adu-Poku"
                                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, owner_label: e.target.value } : x)))}
                                        onBlur={() => {
                                          touch(it.id, "owner");
                                          onPatch(it.id, { owner_label: safeStr(it.owner_label).trim() });
                                        }}
                                      />
                                      {showOwnerWarn && <div className="text-xs text-rose-600 font-medium">Owner required</div>}
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    <div className="relative min-w-[140px]">
                                      <select
                                        className={`w-full appearance-none pl-10 pr-10 py-2 text-sm font-medium rounded-lg border-0 ${stStyle.bg} ${stStyle.text} focus:ring-2 focus:ring-offset-1 focus:ring-gray-200 cursor-pointer`}
                                        value={safeStr(it.status || "Open")}
                                        disabled={isBusy}
                                        onChange={(e) => onPatch(it.id, { status: e.target.value })}
                                      >
                                        <option value="Open">Open</option>
                                        <option value="In Progress">In Progress</option>
                                        <option value="Mitigated">Mitigated</option>
                                        <option value="Closed">Closed</option>
                                        <option value="Invalid">Invalid</option>
                                      </select>
                                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${stStyle.dot}`} />
                                      <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    <div className="relative min-w-[120px]">
                                      <select
                                        className={`w-full appearance-none pl-10 pr-10 py-2 text-sm font-medium rounded-lg border-0 ${priStyle.bg} ${priStyle.text} focus:ring-2 focus:ring-offset-1 focus:ring-gray-200 cursor-pointer`}
                                        value={safeStr(it.priority || "")}
                                        disabled={isBusy}
                                        onChange={(e) => onPatch(it.id, { priority: e.target.value || null })}
                                      >
                                        <option value="">— Select —</option>
                                        <option value="Low">Low</option>
                                        <option value="Medium">Medium</option>
                                        <option value="High">High</option>
                                        <option value="Critical">Critical</option>
                                      </select>
                                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ${priStyle.dot}`} />
                                      <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    <input
                                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={Number.isFinite(Number(it.probability)) ? Number(it.probability) : 0}
                                      disabled={isBusy}
                                      onChange={(e) =>
                                        setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, probability: clampNum(e.target.value, 0, 100) } : x)))
                                      }
                                      onBlur={() => onPatch(it.id, { probability: clampNum(it.probability ?? 0, 0, 100) })}
                                    />
                                  </td>

                                  <td className="px-4 py-3">
                                    <input
                                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                      type="number"
                                      min={0}
                                      max={100}
                                      value={Number.isFinite(Number(it.severity)) ? Number(it.severity) : 0}
                                      disabled={isBusy}
                                      onChange={(e) =>
                                        setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, severity: clampNum(e.target.value, 0, 100) } : x)))
                                      }
                                      onBlur={() => onPatch(it.id, { severity: clampNum(it.severity ?? 0, 0, 100) })}
                                    />
                                  </td>

                                  <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                      <div
                                        className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                                          tone === "r"
                                            ? "bg-rose-100 text-rose-700"
                                            : tone === "a"
                                            ? "bg-amber-100 text-amber-700"
                                            : "bg-emerald-100 text-emerald-700"
                                        }`}
                                      >
                                        {sc}
                                      </div>
                                      <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                          className={`h-full rounded-full ${tone === "r" ? "bg-rose-500" : tone === "a" ? "bg-amber-500" : "bg-emerald-500"}`}
                                          style={{ width: `${sc}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    <input
                                      className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                      type="date"
                                      value={fmtDateOnly(it.due_date)}
                                      disabled={isBusy}
                                      onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, due_date: e.target.value || null } : x)))}
                                      onBlur={() => onPatch(it.id, { due_date: safeStr(it.due_date).trim() || null })}
                                    />
                                  </td>

                                  <td className="px-4 py-3" style={{ width: colW.resp }}>
                                    <div className="space-y-1">
                                      <textarea
                                        className={`w-full min-h-[60px] p-2 text-sm bg-white border rounded-lg resize-y focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors ${
                                          showPlanWarn ? "border-rose-300 bg-rose-50" : "border-gray-200"
                                        }`}
                                        value={safeStr(it.response_plan || "")}
                                        disabled={isBusy}
                                        placeholder="Mitigation plan…"
                                        onChange={(e) => setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, response_plan: e.target.value } : x)))}
                                        onBlur={() => {
                                          touch(it.id, "plan");
                                          onPatch(it.id, { response_plan: safeStr(it.response_plan || "").trim() || null });
                                        }}
                                      />
                                      {showPlanWarn && <div className="text-xs text-rose-600 font-medium">Plan required</div>}
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    <div className="max-w-xs">
                                      {it.ai_rollup ? (
                                        <p className="text-sm text-gray-600 line-clamp-2" title={it.ai_rollup}>
                                          {it.ai_rollup}
                                        </p>
                                      ) : (
                                        <span className="text-sm text-gray-400 italic">No AI analysis yet</span>
                                      )}
                                    </div>
                                  </td>

                                  <td className="px-4 py-3">
                                    <span className="text-xs text-gray-500">{fmtWhen(it.updated_at)}</span>
                                  </td>

                                  <td className="px-4 py-3 text-right">
                                    <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                      <button
                                        onClick={() => setAiOpenId(aiOpenId === it.id ? "" : it.id)}
                                        className="p-1.5 text-indigo-600 hover:bg-indigo-50 rounded-md transition-colors"
                                        title="AI Insights"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                        </svg>
                                      </button>
                                      <button
                                        onClick={() => onAiRefresh(it.id)}
                                        disabled={isBusy}
                                        className="p-1.5 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                                        title="Refresh AI"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                      </button>
                                      <button
                                        onClick={() => onDelete(it.id)}
                                        disabled={isBusy}
                                        className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-md transition-colors"
                                        title="Delete"
                                      >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                      </button>
                                    </div>
                                  </td>
                                </tr>

                                {/* AI Panel */}
                                {aiOpenId === it.id && (
                                  <tr>
                                    <td colSpan={13} className="bg-indigo-50/50 border-b border-indigo-100">
                                      <div className="p-4">
                                        <div className="flex items-center justify-between mb-4">
                                          <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 bg-indigo-100 rounded-lg flex items-center justify-center text-indigo-600">
                                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                              </svg>
                                            </div>
                                            <div>
                                              <h3 className="font-semibold text-gray-900">AI Insights</h3>
                                              <p className="text-xs text-gray-500">
                                                Status: {safeStr(ai.ai_status) || "—"} • Quality:{" "}
                                                {Number.isFinite(ai.ai_quality) ? `${Math.round(ai.ai_quality)}/100` : "—"} •{" "}
                                                {safeStr(ai.last_run_at) ? fmtWhen(ai.last_run_at) : "Never"}
                                              </p>
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-2">
                                            <button
                                              onClick={() => openHistory(it.id)}
                                              disabled={aiHistBusyId === it.id}
                                              className="px-3 py-1.5 text-sm font-medium text-indigo-700 bg-indigo-100 hover:bg-indigo-200 rounded-lg transition-colors"
                                            >
                                              {aiHistBusyId === it.id ? "Loading…" : aiHistOpenId === it.id ? "Hide History" : "View History"}
                                            </button>
                                            <button onClick={() => setAiOpenId("")} className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                                              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                              </svg>
                                            </button>
                                          </div>
                                        </div>

                                        <div className="grid gap-4">
                                          <div className="bg-white rounded-lg p-4 border border-indigo-100 shadow-sm">
                                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Summary</h4>
                                            <p className="text-sm text-gray-700 leading-relaxed">{safeStr(ai.summary || it.ai_rollup || "No summary available.")}</p>
                                          </div>

                                          <div className="bg-white rounded-lg p-4 border border-indigo-100 shadow-sm">
                                            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Recommendations</h4>
                                            <div className="grid gap-2">
                                              {(ai?.recommendations || []).length > 0 ? (
                                                ai.recommendations.map((r: string, idx: number) => (
                                                  <div key={idx} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                                                    <span className="flex-shrink-0 w-6 h-6 bg-indigo-100 text-indigo-700 rounded-full flex items-center justify-center text-xs font-bold">{idx + 1}</span>
                                                    <p className="text-sm text-gray-700">{r}</p>
                                                  </div>
                                                ))
                                              ) : (
                                                <p className="text-sm text-gray-500 italic">No recommendations yet. Click "Refresh AI" to generate.</p>
                                              )}
                                            </div>
                                          </div>

                                          {/* History Comparison */}
                                          {aiHistOpenId === it.id && (
                                            <div className="bg-white rounded-lg p-4 border border-indigo-100 shadow-sm mt-2">
                                              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4">Version History & Diff</h4>

                                              {runs.length === 0 ? (
                                                <p className="text-sm text-gray-500">No history available.</p>
                                              ) : (
                                                <div className="space-y-4">
                                                  <div className="flex items-center gap-4">
                                                    <div className="flex-1">
                                                      <label className="text-xs text-gray-500 mb-1 block">Version A</label>
                                                      <select
                                                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                                                        value={cmp.a}
                                                        onChange={(e) =>
                                                          setAiCompareById((prev) => ({ ...prev, [it.id]: { ...prev[it.id], a: e.target.value } }))
                                                        }
                                                      >
                                                        {runs.map((r) => (
                                                          <option key={r.id} value={r.id}>
                                                            {fmtWhen(r.created_at)} • {safeStr(r.version) || "v?"} • Q{Math.round(r.ai_quality || 0)}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </div>
                                                    <div className="text-gray-400 pt-5">vs</div>
                                                    <div className="flex-1">
                                                      <label className="text-xs text-gray-500 mb-1 block">Version B</label>
                                                      <select
                                                        className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                                                        value={cmp.b}
                                                        onChange={(e) =>
                                                          setAiCompareById((prev) => ({ ...prev, [it.id]: { ...prev[it.id], b: e.target.value } }))
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
                                                    <div className="space-y-3 border-t border-gray-100 pt-4">
                                                      {diffRollup && (
                                                        <div className="grid grid-cols-2 gap-4">
                                                          <div className="p-3 bg-rose-50 rounded-lg border border-rose-100">
                                                            <div className="text-xs font-semibold text-rose-700 mb-1">Previous</div>
                                                            <div className="text-sm text-gray-700">{diffRollup.a}</div>
                                                          </div>
                                                          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                                                            <div className="text-xs font-semibold text-emerald-700 mb-1">Current</div>
                                                            <div className="text-sm text-gray-700">{diffRollup.b}</div>
                                                          </div>
                                                        </div>
                                                      )}

                                                      {diffSummary && (
                                                        <div className="grid grid-cols-2 gap-4">
                                                          <div className="p-3 bg-rose-50 rounded-lg border border-rose-100">
                                                            <div className="text-xs font-semibold text-rose-700 mb-1">Previous Summary</div>
                                                            <div className="text-sm text-gray-700">{diffSummary.a}</div>
                                                          </div>
                                                          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                                                            <div className="text-xs font-semibold text-emerald-700 mb-1">Current Summary</div>
                                                            <div className="text-sm text-gray-700">{diffSummary.b}</div>
                                                          </div>
                                                        </div>
                                                      )}

                                                      {diffRecs && (
                                                        <div className="grid grid-cols-2 gap-4">
                                                          <div className="p-3 bg-rose-50 rounded-lg border border-rose-100">
                                                            <div className="text-xs font-semibold text-rose-700 mb-2">Previous Recommendations</div>
                                                            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">{diffRecs.a.map((x, i) => <li key={i}>{x}</li>)}</ul>
                                                          </div>
                                                          <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100">
                                                            <div className="text-xs font-semibold text-emerald-700 mb-2">Current Recommendations</div>
                                                            <ul className="list-disc list-inside text-sm text-gray-700 space-y-1">{diffRecs.b.map((x, i) => <li key={i}>{x}</li>)}</ul>
                                                          </div>
                                                        </div>
                                                      )}

                                                      {!diffRollup && !diffSummary && !diffRecs && (
                                                        <p className="text-sm text-gray-500 text-center py-4">No differences between selected versions.</p>
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
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </main>

      {/* Digest Modal */}
      {digest && (
        <div
          className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm flex items-start justify-center p-4 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDigest(null);
          }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl my-8 overflow-hidden">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-xl font-bold text-gray-900">{safeStr(digest?.header?.title) || "Weekly RAID Digest"}</h2>
                <p className="text-sm text-gray-500 mt-1">
                  {safeStr(digest?.header?.project_code) || humanProjectId} • {safeStr(digest?.header?.project_name) || humanProjectTitle} •{" "}
                  {fmtWhen(digest?.generated_at)}
                </p>
              </div>
              <button onClick={() => setDigest(null)} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 bg-gray-50/50">
              <div className="grid md:grid-cols-2 gap-4">
                {(Array.isArray(digest?.sections) ? digest.sections : []).map((sec: any) => (
                  <div key={safeStr(sec?.key) || safeStr(sec?.title)} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                      <h3 className="font-semibold text-gray-900">{safeStr(sec?.title) || "Section"}</h3>
                      <span className="px-2.5 py-0.5 bg-gray-200 text-gray-700 text-xs font-bold rounded-full">{sec?.count || sec?.items?.length || 0}</span>
                    </div>
                    <ul className="divide-y divide-gray-100">
                      {Array.isArray(sec?.items) && sec.items.length > 0 ? (
                        sec.items.map((x: any, i: number) => {
                          const link = digestDeepLink(routeProjectId, x);
                          const idTxt = digestId(x);
                          return (
                            <li key={safeStr(x?.id) || i} className="p-3 hover:bg-gray-50 transition-colors flex items-center gap-3">
                              <div className={`w-2 h-2 rounded-full ${STATUS_STYLES[statusToken(x?.status)].dot}`} />
                              <Link
                                href={link}
                                className="font-mono text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 transition-colors"
                              >
                                {digestIdShort(x)}
                              </Link>
                              <div className="flex-1 min-w-0">
                                <Link href={link} className="text-sm font-medium text-gray-900 hover:text-indigo-600 truncate block">
                                  {safeStr(x?.title) || safeStr(x?.description) || "Untitled"}
                                </Link>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => copyToClipboard(idTxt)}
                                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                                  title="Copy ID"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => copyLinkToClipboard(link)}
                                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                                  title="Copy Link"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                  </svg>
                                </button>
                              </div>
                            </li>
                          );
                        })
                      ) : (
                        <li className="p-4 text-sm text-gray-500 text-center">No items</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
