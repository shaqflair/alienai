// src/components/change/ChangeBoard.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { CHANGE_COLUMNS } from "@/lib/change/columns";
import ChangeColumn from "./ChangeColumn";
import type { ChangeItem, ChangeStatus } from "@/lib/change/types";
import { dbToUiStatus } from "@/lib/change/status-map";

type ApiListResp =
  | { ok: true; items: any[]; role?: string; isApprover?: boolean; approverRole?: string | null }
  | { ok: false; error: string };

type ProjectRow = { id: string; title?: string | null; project_code?: string | number | null };
type ProjectsResp =
  | { ok: true; items: ProjectRow[] }
  | { ok: true; projects: ProjectRow[] }
  | { ok: true; data: ProjectRow[] }
  | { ok: false; error: string };

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function firstParam(v: string | string[] | undefined) {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return "";
}

function cleanId(x: unknown) {
  const s = safeStr(x).trim();
  if (!s) return "";
  const low = s.toLowerCase();
  if (low === "undefined" || low === "null") return "";
  return s;
}

function looksLikeUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x);
}

function normLane(s: any): ChangeStatus {
  const v = String(s ?? "").trim().toLowerCase();
  if (v === "new") return "new";
  if (v === "analysis") return "analysis";
  if (v === "review") return "review";
  if (v === "in_progress") return "in_progress";
  if (v === "implemented") return "implemented";
  if (v === "closed") return "closed";
  return dbToUiStatus(v);
}

function toClientItem(r: any): ChangeItem {
  const lane = normLane(r?.delivery_status ?? r?.deliveryStatus ?? r?.status);
  const uuid = safeStr(r?.id).trim();
  const publicId = safeStr(r?.public_id ?? r?.publicId).trim();
  const requester =
    safeStr(r?.requester_name).trim() ||
    safeStr(r?.requester).trim() ||
    safeStr(r?.profiles?.full_name).trim() ||
    safeStr(r?.profiles?.email).trim() ||
    safeStr(r?.requester_id).trim();

  return {
    id: uuid || "CR-UNKNOWN",
    dbId: uuid || undefined,
    publicId: publicId || undefined,
    title: String(r?.title ?? "Untitled change"),
    requester: requester || "Unknown requester",
    summary: String(r?.description ?? ""),
    status: lane,
    priority: String(r?.priority ?? "Medium") as any,
    tags: Array.isArray(r?.tags) ? r.tags : [],
    aiImpact: {
      days: Number(r?.impact_analysis?.days ?? 0) || 0,
      cost: Number(r?.impact_analysis?.cost ?? 0) || 0,
      risk: String(r?.impact_analysis?.risk ?? "None identified"),
    },
    decision_status: safeStr(r?.decision_status ?? r?.decisionStatus).trim(),
    decision_rationale: safeStr(r?.decision_rationale ?? r?.decisionRationale).trim(),
    decision_at: safeStr(r?.decision_at ?? r?.decisionAt).trim(),
    decision_role: safeStr(r?.decision_role ?? r?.decisionRole).trim(),
    links: r?.links ?? undefined,
    ai_score: r?.ai_score ?? r?.aiScore ?? undefined,
    project_id: r?.project_id ?? r?.projectId ?? undefined,
    project_title: r?.project_title ?? r?.projectTitle ?? undefined,
  } as any;
}

async function apiGet(url: string, signal?: AbortSignal) {
  const res = await fetch(url, {
    method: "GET",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

async function apiPost(url: string, body?: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

async function apiPatch(url: string, body?: any) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

type FilterKey = "all" | "mine" | "high" | "needs_review";
type ScopeMode = "project" | "artifact" | "portfolio";
type ViewMode = "board" | "list";

function normPrioritySet(x: string) {
  const parts = x
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts);
}

function fmtWhen(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString("en-GB");
}

export default function ChangeBoard(props: { artifactId?: string; projectId?: string; projectCode?: string }) {
  const router = useRouter();
  const params = useParams() as Record<string, string | string[] | undefined>;
  const sp = useSearchParams();

  const projectId = useMemo(() => {
    const fromProp = cleanId(props?.projectId);
    const fromRoute = cleanId(firstParam(params?.id));
    const pid = fromProp || fromRoute;
    return pid && looksLikeUuid(pid) ? pid : "";
  }, [props?.projectId, params?.id]);

  const projectCode = useMemo(() => cleanId((props as any)?.projectCode), [props?.projectCode]);
  const artifactId = useMemo(() => cleanId(props?.artifactId), [props?.artifactId]);

  const [items, setItems] = useState<ChangeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const [scopeMode, setScopeMode] = useState<ScopeMode>(() => (projectId ? (artifactId ? "artifact" : "project") : "portfolio"));
  const [isApprover, setIsApprover] = useState(false);
  const [approverRole, setApproverRole] = useState<string>("");

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [view, setView] = useState<ViewMode>(() => (projectId ? "board" : "list"));

  const inflightRef = useRef<Set<string>>(new Set());
  const errTimer = useRef<any>(null);
  const refreshingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  function showError(msg: string) {
    setErr(msg);
    clearTimeout(errTimer.current);
    errTimer.current = setTimeout(() => setErr(""), 4500);
  }

  useEffect(() => {
    const priority = safeStr(sp?.get("priority") || "");
    const stale = safeStr(sp?.get("stale") || "");
    const needsReview = safeStr(sp?.get("needs_review") || "");

    if (priority) {
      const set = normPrioritySet(priority);
      if (set.has("high") || set.has("critical")) setFilter("high");
    } else if (needsReview === "1") {
      setFilter("needs_review");
    }
    if (stale === "1") {
      setQ((prev) => (prev ? prev : "stale"));
    }
  }, [sp]);

  const tryFetchProjects = useCallback(async (signal?: AbortSignal): Promise<ProjectRow[]> => {
    const candidates = ["/api/projects", "/api/projects/list", "/api/projects/mine"];
    let lastErr = "";
    for (const url of candidates) {
      try {
        const j = (await apiGet(url, signal)) as ProjectsResp;
        const arr = (j as any)?.items || (j as any)?.projects || (j as any)?.data || [];
        if (Array.isArray(arr)) return arr;
      } catch (e: any) {
        lastErr = safeStr(e?.message || "");
      }
    }
    throw new Error(lastErr || "Could not load projects for portfolio view");
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setErr("");

    try {
      if (!projectId) {
        setScopeMode("portfolio");
        setIsApprover(false);
        setApproverRole("");

        const projects = await tryFetchProjects(ac.signal);
        const projectMap = new Map<string, ProjectRow>();
        for (const p of projects) projectMap.set(String(p.id), p);

        const projectIds = projects.map((p) => String(p.id)).filter(Boolean);
        if (!projectIds.length) {
          setItems([]);
          return;
        }

        const settled = await Promise.allSettled(
          projectIds.map(async (pid) => {
            const qs = new URLSearchParams();
            qs.set("projectId", pid);
            qs.set("id", pid);
            const j = (await apiGet(`/api/change?${qs.toString()}`, ac.signal)) as ApiListResp;
            if ((j as any)?.ok !== true) throw new Error((j as any)?.error || "Failed to load changes");
            return { projectId: pid, items: (j as any)?.items ?? [] };
          })
        );

        const merged: any[] = [];
        for (const r of settled) {
          if (r.status !== "fulfilled") continue;
          const pid = r.value.projectId;
          const proj = projectMap.get(pid);
          const title = safeStr(proj?.title) || "Project";
          for (const row of r.value.items || []) {
            merged.push({ ...row, project_id: pid, project_title: title });
          }
        }

        setItems(merged.map(toClientItem));
        setView("list");
        return;
      }

      const qs1 = new URLSearchParams();
      qs1.set("projectId", projectId);
      qs1.set("id", projectId);
      if (artifactId) qs1.set("artifactId", artifactId);

      const json1 = (await apiGet(`/api/change?${qs1.toString()}`, ac.signal)) as ApiListResp;
      if ((json1 as any)?.ok !== true) throw new Error((json1 as any)?.error || "Failed to load");

      setIsApprover(Boolean((json1 as any).isApprover));
      setApproverRole(safeStr((json1 as any).approverRole));

      const raw1 = (json1 as any).items ?? [];
      const mapped1 = raw1.map(toClientItem);

      if (artifactId && mapped1.length === 0) {
        const qs2 = new URLSearchParams();
        qs2.set("projectId", projectId);
        qs2.set("id", projectId);
        const json2 = (await apiGet(`/api/change?${qs2.toString()}`, ac.signal)) as ApiListResp;
        if ((json2 as any)?.ok !== true) throw new Error((json2 as any)?.error || "Failed to load");
        setIsApprover(Boolean((json2 as any).isApprover));
        setApproverRole(safeStr((json2 as any).approverRole));
        const raw2 = (json2 as any).items ?? [];
        setScopeMode("project");
        setItems(raw2.map(toClientItem));
        setView("board");
      } else {
        setScopeMode(artifactId ? "artifact" : "project");
        setItems(mapped1);
        setView("board");
      }
    } catch (e: any) {
      const msg = safeStr(e?.message || "");
      if (msg.toLowerCase().includes("aborted")) return;
      setItems([]);
      setErr(msg || "Failed to load change requests");
    } finally {
      refreshingRef.current = false;
      setLoading(false);
    }
  }, [projectId, artifactId, tryFetchProjects]);

  useEffect(() => {
    refresh();
    return () => abortRef.current?.abort();
  }, [refresh]);

  useEffect(() => {
    const onFocus = () => refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  async function persistLane(dbId: string, lane: ChangeStatus) {
    try {
      return await apiPatch(`/api/change/${dbId}/delivery-status`, { delivery_status: lane });
    } catch {
      return apiPatch(`/api/change/${dbId}`, { deliveryStatus: lane });
    }
  }

  async function persistGovernanceStatus(dbId: string, status: string) {
    try {
      return await apiPatch(`/api/change/${dbId}/status`, { status });
    } catch {
      return apiPatch(`/api/change/${dbId}`, { status });
    }
  }

  async function persistGovernanceAndLane(dbId: string, nextLane: ChangeStatus, prevLane: ChangeStatus) {
    if (prevLane === "analysis" && nextLane === "review") {
      try {
        await apiPost(`/api/change/${dbId}/submit`);
      } catch {
        await persistGovernanceStatus(dbId, "review");
      }
      await persistLane(dbId, "review");
      return;
    }
    if (prevLane === "review" && nextLane === "in_progress") {
      try {
        await apiPost(`/api/change/${dbId}/approve`);
      } catch {
        await persistGovernanceStatus(dbId, "approved");
      }
      await persistLane(dbId, "in_progress");
      return;
    }
    if (prevLane === "review" && nextLane === "analysis") {
      try {
        await apiPost(`/api/change/${dbId}/request-changes`, { note: "" });
      } catch {
        await persistGovernanceStatus(dbId, "analysis");
      }
      await persistLane(dbId, "analysis");
      return;
    }
    if (prevLane === "review" && nextLane === "new") {
      try {
        await apiPost(`/api/change/${dbId}/reject`, { note: "" });
      } catch {
        await persistGovernanceStatus(dbId, "rejected");
      }
      await persistLane(dbId, "new");
      return;
    }
    await persistLane(dbId, nextLane);
  }

  async function move(idOrDbId: string, nextLane: ChangeStatus) {
    if (!projectId) return;
    const current = items.find((x) => x.id === idOrDbId || x.dbId === idOrDbId);
    if (!current) return;
    const prevLane = current.status;
    if (prevLane === nextLane) return;
    const dbId = safeStr(current.dbId || current.id).trim();
    if (!dbId) return;
    if (inflightRef.current.has(dbId)) return;
    inflightRef.current.add(dbId);
    setErr("");
    const snapshot = items;
    setItems((cur) => cur.map((x) => (x.id === current.id ? { ...x, status: nextLane } : x)));
    try {
      await persistGovernanceAndLane(dbId, nextLane, prevLane);
      await refresh();
    } catch (e: any) {
      setItems(snapshot);
      showError(safeStr(e?.message) || "Failed to update status");
    } finally {
      inflightRef.current.delete(dbId);
    }
  }

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return items.filter((it) => {
      const pub = safeStr((it as any)?.publicId).trim();
      const hay = [
        pub,
        it.id,
        it.title,
        it.summary,
        it.requester,
        ...(it.tags ?? []),
        it.priority,
        it.status,
        (it as any)?.project_title,
      ]
        .filter(Boolean)
        .join(" • ")
        .toLowerCase();
      if (query && !hay.includes(query)) return false;
      if (filter === "high") {
        const p = String(it.priority ?? "").toLowerCase();
        if (!(p === "high" || p === "critical")) return false;
      }
      if (filter === "needs_review") {
        if (!(it.status === "review" || it.status === "analysis")) return false;
      }
      return true;
    });
  }, [items, q, filter]);

  const grouped = useMemo(() => {
    const map = new Map<ChangeStatus, ChangeItem[]>();
    for (const c of CHANGE_COLUMNS) map.set(c.key, []);
    for (const it of filtered) map.get(it.status)?.push(it);
    for (const k of map.keys()) {
      const arr = map.get(k) ?? [];
      arr.sort((a, b) => String(a.title).localeCompare(String(b.title)));
      map.set(k, arr);
    }
    return map;
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<FilterKey, number> = { all: filtered.length, mine: 0, high: 0, needs_review: 0 };
    for (const it of filtered) {
      const p = String(it.priority ?? "").toLowerCase();
      if (p === "high" || p === "critical") c.high++;
      if (it.status === "review" || it.status === "analysis") c.needs_review++;
    }
    return c;
  }, [filtered]);

  const createHref = projectId ? `/projects/${projectId}/change/new` : "";

  function openRow(it: any) {
    const pid = safeStr(it?.project_id || (it as any)?.projectId || "").trim();
    const id = safeStr(it?.dbId || it?.id || "").trim();
    if (!pid) return;
    const qs = new URLSearchParams();
    if (id) qs.set("focus", id);
    router.push(qs.toString() ? `/projects/${pid}/change?${qs.toString()}` : `/projects/${pid}/change`);
  }

  const listRows = useMemo(() => {
    const rows = filtered.map((it: any) => {
      const pid = safeStr(it?.project_id || it?.projectId || "");
      const ptitle = safeStr(it?.project_title || it?.projectTitle || "");
      const pub = safeStr(it?.publicId || it?.public_id || "");
      const updated = safeStr(it?.updated_at || it?.updatedAt || it?.decision_at || it?.decisionAt || "");
      return {
        pid,
        ptitle: ptitle || "Project",
        pub: pub || (safeStr(it?.id).slice(0, 8) ? `${safeStr(it?.id).slice(0, 8)}…` : "—"),
        title: safeStr(it?.title) || "Untitled change",
        priority: safeStr(it?.priority) || "Medium",
        status: safeStr(it?.status) || "new",
        requester: safeStr(it?.requester) || "—",
        decision: safeStr(it?.decision_status) || "—",
        updated,
        raw: it,
      };
    });
    rows.sort((a, b) => String(b.updated || "").localeCompare(String(a.updated || "")));
    return rows;
  }, [filtered]);

  const priorityBadge = (p: string) => {
    const v = p.toLowerCase();
    if (v === "critical")
      return "bg-rose-50 text-rose-700 ring-1 ring-rose-200";
    if (v === "high")
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
    if (v === "low")
      return "bg-slate-50 text-slate-600 ring-1 ring-slate-200";
    return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
  };

  const statusBadge = (s: string) => {
    const v = String(s || "").toLowerCase();
    if (v === "review" || v === "analysis")
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
    if (v === "in_progress")
      return "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200";
    if (v === "implemented")
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
    if (v === "closed")
      return "bg-gray-100 text-gray-600 ring-1 ring-gray-200";
    return "bg-slate-50 text-slate-600 ring-1 ring-slate-200";
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation Bar */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4 flex-1">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                  <span className="text-white font-bold text-sm">CR</span>
                </div>
                <h1 className="text-lg font-semibold text-gray-900">
                  {!projectId ? "Portfolio Changes" : "Change Requests"}
                </h1>
              </div>

              <div className="hidden md:flex items-center gap-2 ml-6">
                {!projectId ? (
                  <span className="text-sm text-gray-500">
                    {loading ? "Loading…" : `${items.length} requests across projects`}
                  </span>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <span>{loading ? "Loading…" : `${items.length} requests`}</span>
                    {artifactId && (
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 text-xs">
                        {scopeMode === "artifact" ? "Artifact scope" : "Project scope"}
                      </span>
                    )}
                    {isApprover && (
                      <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium">
                        Approver{approverRole ? ` • ${approverRole}` : ""}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <svg className="h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <input
                  type="text"
                  className="pl-10 pr-4 py-2 w-64 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder={projectId ? "Search CR, title, requester…" : "Search across portfolio…"}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                />
              </div>

              <button
                onClick={refresh}
                disabled={loading}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                title="Refresh"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>

              <button
                onClick={() => projectId && router.push(createHref)}
                disabled={!projectId}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Change
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700 mr-2">Filters:</span>
            {[
              { key: "all", label: "All", count: counts.all },
              { key: "high", label: "High/Critical", count: counts.high },
              { key: "needs_review", label: "Needs Review", count: counts.needs_review },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key as FilterKey)}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  filter === f.key
                    ? "bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200"
                    : "bg-gray-50 text-gray-600 hover:bg-gray-100"
                }`}
              >
                {f.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${filter === f.key ? "bg-indigo-100" : "bg-gray-200"}`}>
                  {f.count}
                </span>
              </button>
            ))}

            <div className="ml-auto flex items-center gap-2">
              <span className="text-sm text-gray-500">View:</span>
              <div className="flex bg-gray-100 rounded-lg p-1">
                <button
                  onClick={() => setView("list")}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    view === "list" ? "bg-white text-gray-900 shadow-sm" : "text-gray-600 hover:text-gray-900"
                  }`}
                >
                  List
                </button>
                <button
                  onClick={() => setView("board")}
                  disabled={!projectId}
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                    view === "board"
                      ? "bg-white text-gray-900 shadow-sm"
                      : "text-gray-600 hover:text-gray-900 disabled:opacity-40"
                  }`}
                  title={!projectId ? "Board view requires a project" : "Board"}
                >
                  Board
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Banner */}
      {err && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-4">
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 flex items-center gap-3">
            <svg className="h-5 w-5 text-rose-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-rose-800">{err}</span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {view === "list" ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 font-semibold text-gray-900">Project</th>
                    <th className="px-6 py-4 font-semibold text-gray-900">ID</th>
                    <th className="px-6 py-4 font-semibold text-gray-900">Title</th>
                    <th className="px-6 py-4 font-semibold text-gray-900">Priority</th>
                    <th className="px-6 py-4 font-semibold text-gray-900">Status</th>
                    <th className="px-6 py-4 font-semibold text-gray-900">Decision</th>
                    <th className="px-6 py-4 font-semibold text-gray-900">Updated</th>
                    <th className="px-6 py-4 font-semibold text-gray-900 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                          Loading change requests…
                        </div>
                      </td>
                    </tr>
                  ) : listRows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                        No change requests found.
                      </td>
                    </tr>
                  ) : (
                    listRows.map((r) => (
                      <tr key={`${r.pid}_${r.pub}`} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{r.ptitle}</div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="font-mono text-xs text-gray-600 bg-gray-100 px-2 py-1 rounded">
                            {r.pub}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{r.title}</div>
                          {r.requester && (
                            <div className="text-xs text-gray-500 mt-0.5">by {r.requester}</div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${priorityBadge(r.priority)}`}>
                            {r.priority}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${statusBadge(r.status)}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-gray-600">{r.decision}</td>
                        <td className="px-6 py-4 text-gray-500 text-xs">{fmtWhen(r.updated)}</td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => openRow(r.raw)}
                            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
                          >
                            Open
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex gap-6 overflow-x-auto pb-4">
            {CHANGE_COLUMNS.map((col) => {
              const colItems = grouped.get(col.key) ?? [];
              return (
                <div key={col.key} className="flex-shrink-0 w-80">
                  <div className="bg-gray-100 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-gray-900">{col.title}</h3>
                      <span className="text-xs font-medium text-gray-500 bg-white px-2 py-1 rounded-full">
                        {colItems.length}
                      </span>
                    </div>
                    <ChangeColumn
                      column={col}
                      items={colItems}
                      onMove={move}
                      projectId={projectId}
                      projectCode={projectCode || undefined}
                      isApprover={isApprover}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
