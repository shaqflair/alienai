"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

/* ---------------- types ---------------- */

type Lesson = {
  id: string;
  project_id: string;
  category: "what_went_well" | "improvements" | "issues" | string;
  description: string;
  action_for_future?: string | null;
  created_at: string;
  status?: string | null;
  impact?: string | null;
  severity?: string | null;
  project_stage?: string | null;
  ai_generated?: boolean | null;
  ai_summary?: string | null;
  action_owner_label?: string | null;
  is_published?: boolean | null;
  published_at?: string | null;
  library_tags?: string[] | null;
};

type ProjectMeta = {
  title: string;
  project_code: string;
};

type TabType = "lessons" | "insights" | "library" | "export";
type ExportScope = "lessons" | "library";

/* ---------------- helpers ---------------- */

function pillForCategory(c: string) {
  if (c === "what_went_well") return "bg-emerald-100 text-emerald-800 border-emerald-200";
  if (c === "improvements") return "bg-violet-100 text-violet-800 border-violet-200";
  if (c === "issues") return "bg-rose-100 text-rose-800 border-rose-200";
  return "bg-gray-100 text-gray-800 border-gray-200";
}

function pillForStatus(s: string) {
  const v = String(s || "").trim();
  if (v === "Closed") return "bg-slate-100 text-slate-600 border-slate-200";
  if (v === "In Progress") return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-amber-100 text-amber-700 border-amber-200";
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function parseTagsCsv(input: string): string[] {
  return String(input || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function slugify(x: string) {
  return String(x || "Project")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .slice(0, 60);
}

function isUuidClient(x: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function formatUKDate(dateString: string) {
  if (!dateString) return "—";
  try {
    return new Date(dateString).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
}

function safeExcelCell(v: any) {
  const s = String(v ?? "");
  // prevent Excel formula injection
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

/* ---------------- component ---------------- */

export default function LessonsPage() {
  const router = useRouter();
  const params = useParams();

  // NOTE: your route param can be project_code (e.g. 100011) OR uuid
  const projectRef = String((params as any)?.id || "").trim();

  // Tabs
  const [activeTab, setActiveTab] = useState<TabType>("lessons");

  // Export scope (remembers where user came from)
  const [exportScope, setExportScope] = useState<ExportScope>("lessons");

  // Data
  const [items, setItems] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<ProjectMeta>({
    title: "Project",
    project_code: projectRef || "—",
  });

  // Modal state
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Lesson | null>(null);

  // Form state
  const [category, setCategory] = useState("what_went_well");
  const [description, setDescription] = useState("");
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("Open");
  const [impact, setImpact] = useState("");
  const [severity, setSeverity] = useState("");
  const [stage, setStage] = useState("");
  const [actionOwnerName, setActionOwnerName] = useState("");

  // Filters
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  function resetForm() {
    setCategory("what_went_well");
    setDescription("");
    setAction("");
    setStatus("Open");
    setImpact("");
    setSeverity("");
    setStage("");
    setActionOwnerName("");
    setEditing(null);
    setMode("create");
  }

  function openCreate() {
    resetForm();
    setMode("create");
    setOpen(true);
  }

  function openEdit(l: Lesson) {
    setMode("edit");
    setEditing(l);
    setCategory(safeStr(l.category) || "what_went_well");
    setDescription(safeStr(l.description) || "");
    setAction(safeStr(l.action_for_future) || "");
    setStatus(safeStr(l.status) || "Open");
    setImpact(safeStr(l.impact) || "");
    setSeverity(safeStr(l.severity) || "");
    setStage(safeStr(l.project_stage) || "");
    setActionOwnerName(safeStr(l.action_owner_label) || "");
    setOpen(true);
  }

  async function refresh() {
    if (!projectRef) return;
    setLoading(true);

    // Keep backward compatibility with your existing API query param.
    // Server should resolve whether this is UUID or project_code.
    const url = `/api/lessons?projectId=${encodeURIComponent(projectRef)}`;

    try {
      const r = await fetch(url, { cache: "no-store" });
      const raw = await r.clone().text();
      let j: any = null;
      try {
        j = raw && raw.trim() ? JSON.parse(raw) : null;
      } catch {
        j = null;
      }
      if (!r.ok || (j && j.ok === false)) {
        const msg = j?.error || `Failed to load lessons (${r.status})`;
        throw new Error(msg);
      }
      const next: Lesson[] = Array.isArray(j?.items) ? j.items : [];
      setItems(next);
    } catch (e: any) {
      alert(e?.message || "Failed to load lessons");
    } finally {
      setLoading(false);
    }
  }

  async function fetchMeta() {
    if (!projectRef) return;

    try {
      // ✅ FIX: correct route path
      const r = await fetch(`/api/projects/${encodeURIComponent(projectRef)}/meta`, { cache: "no-store" });
      const raw = await r.clone().text();
      let j: any = null;
      try {
        j = raw && raw.trim() ? JSON.parse(raw) : null;
      } catch {
        j = null;
      }

      if (r.ok && j?.ok && j?.project) {
        const code = safeStr(j.project.project_code || j.project.code || projectRef).trim() || projectRef;
        setMeta({
          title: safeStr(j.project.title) || "Project",
          project_code: code,
        });
      } else {
        setMeta((m) => ({ ...m, project_code: projectRef || m.project_code }));
      }
    } catch {
      setMeta((m) => ({ ...m, project_code: projectRef || m.project_code }));
    }
  }

  useEffect(() => {
    if (!projectRef) return;
    refresh();
    fetchMeta();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRef]);

  // When user switches between Lessons/Library, remember export scope
  function goTab(t: TabType) {
    setActiveTab(t);
    if (t === "lessons") setExportScope("lessons");
    if (t === "library") setExportScope("library");
  }

  // Filtered rows for Lessons tab
  const filteredRows = useMemo(() => {
    return items.filter((l) => {
      const matchesCategory = filterCategory === "all" || l.category === filterCategory;
      const matchesStatus = filterStatus === "all" || l.status === filterStatus;
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        safeStr(l.description).toLowerCase().includes(q) ||
        safeStr(l.action_owner_label).toLowerCase().includes(q) ||
        (Array.isArray(l.library_tags) ? l.library_tags.join(", ").toLowerCase().includes(q) : false);
      return matchesCategory && matchesStatus && matchesSearch;
    });
  }, [items, filterCategory, filterStatus, searchQuery]);

  // Library rows (published only)
  const libraryRows = useMemo(() => items.filter((l) => Boolean(l.is_published)), [items]);

  // Export rows depend on export scope (lessons view vs library view)
  const exportRows = useMemo(() => {
    return exportScope === "library" ? libraryRows : filteredRows;
  }, [exportScope, libraryRows, filteredRows]);

  async function exportExcel() {
    try {
      const data =
        exportRows.length > 0
          ? exportRows.map((l, idx) => ({
              Status: safeExcelCell(l.status || "Open"),
              No: idx + 1,
              "Date Raised": safeExcelCell(formatUKDate(l.created_at)),
              Description: safeExcelCell(l.description),
              Impact: safeExcelCell(l.impact || ""),
              Severity: safeExcelCell(l.severity || ""),
              Category: safeExcelCell(l.category || ""),
              "Project Stage": safeExcelCell(l.project_stage || ""),
              "Action Owner": safeExcelCell(l.action_owner_label || ""),
              "Next Action": safeExcelCell(l.action_for_future || ""),
              Library: safeExcelCell(l.is_published ? "Published" : "Private"),
              Tags: safeExcelCell((l.library_tags || []).join(", ")),
            }))
          : [{}];

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, exportScope === "library" ? "Org Library" : "Lessons");

      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

      const scopeLabel = exportScope === "library" ? "Org_Library" : "Lessons_Learned";
      const fileBase = `${scopeLabel}_${meta.project_code}_${slugify(meta.title)}`;

      saveAs(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${fileBase}.xlsx`
      );
    } catch (e: any) {
      alert(e?.message || "Excel export failed");
    }
  }

  async function createLesson() {
    if (!description.trim()) return;
    setSaving(true);

    try {
      const payload = {
        // ✅ send both; API can resolve either UUID or code
        project_id: projectRef,
        project_code: projectRef,

        category,
        description: description.trim(),
        action_for_future: action.trim() || null,
        status,
        impact: impact.trim() || null,
        severity: severity.trim() || null,
        project_stage: stage.trim() || null,
        action_owner_label: actionOwnerName.trim() || null,
      };

      const r = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || "Failed to create");

      setOpen(false);
      resetForm();
      await refresh();
    } catch (e: any) {
      alert(e?.message || "Create failed");
    } finally {
      setSaving(false);
    }
  }

  async function updateLesson() {
    if (!editing) return;
    const id = String(editing.id || "").trim();
    if (!isUuidClient(id)) {
      alert("Cannot update: invalid id");
      return;
    }
    if (!description.trim()) return;

    setSaving(true);
    try {
      const r = await fetch(`/api/lessons/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          description: description.trim(),
          action_for_future: action.trim() || null,
          status,
          impact: impact.trim() || null,
          severity: severity.trim() || null,
          project_stage: stage.trim() || null,
          action_owner_label: actionOwnerName.trim() || null,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || "Failed to update");

      setOpen(false);
      resetForm();
      await refresh();
    } catch (e: any) {
      alert(e?.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLesson(l: Lesson) {
    if (!confirm("Delete this lesson? This cannot be undone.")) return;
    const id = String(l.id || "").trim();
    if (!isUuidClient(id)) {
      alert("Cannot delete: invalid id");
      return;
    }
    try {
      const r = await fetch(`/api/lessons/${encodeURIComponent(id)}`, { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || "Failed to delete");
      await refresh();
    } catch (e: any) {
      alert(e?.message || "Delete failed");
    }
  }

  async function runAi() {
    try {
      const r = await fetch("/api/lessons/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectRef, project_code: projectRef }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || "AI generate failed");

      await refresh();
      alert(`AI created ${j.created_count ?? 0} lessons`);
    } catch (e: any) {
      alert(e?.message || "AI generate failed");
    }
  }

  async function publishToggle(l: Lesson, publish: boolean) {
    const existing = (l.library_tags || []).join(", ");
    const rawInput = prompt(publish ? "Publish to Org Library.\nEnter tags:" : "Unpublish.\nUpdate tags:", existing);
    if (rawInput === null) return;

    const library_tags = parseTagsCsv(rawInput);
    const id = String(l.id || "").trim();
    if (!isUuidClient(id)) {
      alert("Invalid ID");
      return;
    }

    try {
      const r = await fetch(`/api/lessons/${encodeURIComponent(id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish, library_tags }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || "Toggle failed");

      await refresh();
    } catch (e: any) {
      alert(e?.message || "Toggle failed");
    }
  }

  const submitLabel = mode === "edit" ? (saving ? "Saving…" : "Save changes") : saving ? "Saving…" : "Create Lesson";

  // ✅ PDF route exports based on exportScope
  const scopeLabel = exportScope === "library" ? "Org_Library" : "Lessons_Learned";
  const fileBase = `${scopeLabel}_${meta.project_code}_${slugify(meta.title)}`;
  const pdfHref =
    exportScope === "library"
      ? `/projects/${projectRef}/lessons/export/pdf?filename=${encodeURIComponent(fileBase)}&publishedOnly=1`
      : `/projects/${projectRef}/lessons/export/pdf?filename=${encodeURIComponent(fileBase)}`;

  // Stats
  const stats = useMemo(() => {
    const total = items.length;
    const openCount = items.filter((i) => i.status === "Open").length;
    const closedCount = items.filter((i) => i.status === "Closed").length;
    const inProgressCount = items.filter((i) => i.status === "In Progress").length;
    const publishedCount = items.filter((i) => i.is_published).length;
    const aiGeneratedCount = items.filter((i) => i.ai_generated).length;
    const issues = items.filter((i) => i.category === "issues").length;
    const improvements = items.filter((i) => i.category === "improvements").length;
    const successes = items.filter((i) => i.category === "what_went_well").length;

    return {
      total,
      open: openCount,
      closed: closedCount,
      inProgress: inProgressCount,
      published: publishedCount,
      aiGenerated: aiGeneratedCount,
      issues,
      improvements,
      successes,
    };
  }, [items]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans pb-20">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-colors"
              aria-label="Back"
              title="Back"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>

            <div>
              <h1 className="text-xl font-bold text-slate-800">Lessons Learned</h1>
              <p className="text-xs text-slate-500 font-medium">
                {meta.project_code} • {meta.title}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === "lessons" && (
              <button
                onClick={openCreate}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 font-medium text-sm shadow-sm transition-all hover:shadow-md"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Lesson
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-8" aria-label="Tabs">
            <button
              onClick={() => goTab("lessons")}
              className={`${
                activeTab === "lessons"
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
              All Lessons
              <span className="bg-slate-100 text-slate-600 py-0.5 px-2 rounded-full text-xs">{stats.total}</span>
            </button>

            <button
              onClick={() => goTab("insights")}
              className={`${
                activeTab === "insights"
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              Insights
            </button>

            <button
              onClick={() => goTab("library")}
              className={`${
                activeTab === "library"
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              Org Library
              <span className="bg-slate-100 text-slate-600 py-0.5 px-2 rounded-full text-xs">{stats.published}</span>
            </button>

            <button
              onClick={() => setActiveTab("export")}
              className={`${
                activeTab === "export"
                  ? "border-indigo-500 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
              } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export
            </button>
          </nav>
        </div>
      </div>

      {/* Main */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* LESSONS TAB */}
        {activeTab === "lessons" && (
          <>
            {/* Filters Bar */}
            <div className="mb-6 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
                <div className="relative">
                  <svg
                    className="w-5 h-5 absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search lessons..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 w-full sm:w-64"
                  />
                </div>

                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="all">All Categories</option>
                  <option value="what_went_well">What Went Well</option>
                  <option value="improvements">Improvements</option>
                  <option value="issues">Issues</option>
                </select>

                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="all">All Statuses</option>
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Closed">Closed</option>
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={runAi}
                  disabled={loading}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-lg hover:bg-indigo-100 transition-colors disabled:opacity-60"
                >
                  <span>✨</span> AI Generate
                </button>

                <button
                  onClick={exportExcel}
                  disabled={loading || exportRows.length === 0}
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  Excel
                </button>

                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  PDF
                </a>
              </div>
            </div>

            {/* Content */}
            {loading && items.length === 0 ? (
              <div className="flex justify-center py-20">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-slate-900"></div>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-2xl border border-dashed border-slate-300">
                <div className="mx-auto h-12 w-12 text-slate-400 mb-4">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-slate-900">No lessons found</h3>
                <p className="mt-1 text-slate-500">Try adjusting your filters or create a new lesson.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4">
                {filteredRows.map((l, idx) => {
                  const published = Boolean(l.is_published);
                  const tags = (l.library_tags || []).filter(Boolean);
                  const idOk = isUuidClient(l?.id);

                  return (
                    <div
                      key={String(l.id || idx)}
                      className="group bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden flex flex-col sm:flex-row"
                    >
                      <div
                        className={`w-1.5 flex-shrink-0 ${
                          l.category === "issues" ? "bg-rose-500" : l.category === "improvements" ? "bg-violet-500" : "bg-emerald-500"
                        }`}
                      />

                      <div className="flex-1 p-5 sm:p-6">
                        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                          <div className="flex-1 space-y-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${pillForCategory(
                                  l.category
                                )}`}
                              >
                                {String(l.category || "").replace(/_/g, " ")}
                              </span>

                              <span
                                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${pillForStatus(
                                  l.status || "Open"
                                )}`}
                              >
                                {l.status || "Open"}
                              </span>

                              {l.ai_generated && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                                  🤖 AI
                                </span>
                              )}

                              {!idOk && (
                                <span
                                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800 border border-red-200"
                                  title={`ID: ${String(l.id)}`}
                                >
                                  ⚠️ Invalid ID
                                </span>
                              )}
                            </div>

                            <div>
                              <h3
                                className="text-lg font-semibold text-slate-900 leading-tight cursor-pointer hover:text-indigo-600 transition-colors"
                                onClick={() => openEdit(l)}
                              >
                                {l.description}
                              </h3>

                              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600">
                                <div className="flex items-center gap-1.5">
                                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                  </svg>
                                  <span>{formatUKDate(l.created_at)}</span>
                                </div>

                                {l.project_stage && (
                                  <div className="flex items-center gap-1.5">
                                    <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                                      />
                                    </svg>
                                    <span>{l.project_stage}</span>
                                  </div>
                                )}

                                {l.impact && (
                                  <div className="flex items-center gap-1.5">
                                    <span className={`w-2 h-2 rounded-full ${l.impact === "Positive" ? "bg-emerald-500" : "bg-rose-500"}`} />
                                    <span>{l.impact} Impact</span>
                                  </div>
                                )}

                                {l.severity && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-slate-400 font-medium">Severity:</span>
                                    <span className={l.severity === "High" ? "text-rose-600 font-medium" : "text-slate-600"}>{l.severity}</span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {(l.action_owner_label || l.action_for_future) && (
                              <div className="mt-4 p-3 bg-slate-50 rounded-lg border border-slate-100 text-sm">
                                {l.action_owner_label && (
                                  <div className="flex items-center gap-2 mb-1">
                                    <span className="text-slate-500 font-medium">Owner:</span>
                                    <span className="text-slate-900 font-semibold">{l.action_owner_label}</span>
                                  </div>
                                )}
                                {l.action_for_future && (
                                  <div className="flex items-start gap-2">
                                    <span className="text-slate-500 font-medium shrink-0">Action:</span>
                                    <span className="text-slate-700 italic">{l.action_for_future}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>

                          <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-4 min-w-[140px]">
                            <div className="flex flex-col items-end gap-2">
                              {published ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-100">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path
                                      fillRule="evenodd"
                                      d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                  Published
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 text-xs font-semibold border border-slate-200">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path
                                      fillRule="evenodd"
                                      d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                                      clipRule="evenodd"
                                    />
                                  </svg>
                                  Private
                                </span>
                              )}

                              <div className="flex flex-wrap justify-end gap-1 max-w-[150px]">
                                {tags.slice(0, 3).map((t) => (
                                  <span key={t} className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[10px] rounded-full border border-slate-200">
                                    {t}
                                  </span>
                                ))}
                                {tags.length > 3 && <span className="text-[10px] text-slate-400 px-1">+{tags.length - 3}</span>}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 mt-auto">
                              <button
                                onClick={() => publishToggle(l, !published)}
                                className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title={published ? "Unpublish" : "Publish"}
                              >
                                {published ? (
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                                  </svg>
                                ) : (
                                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                    />
                                  </svg>
                                )}
                              </button>

                              <button
                                onClick={() => openEdit(l)}
                                className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                title="Edit"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                                  />
                                </svg>
                              </button>

                              <button
                                onClick={() => deleteLesson(l)}
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="Delete"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                  />
                                </svg>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* INSIGHTS TAB */}
        {activeTab === "insights" && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Total Lessons</p>
                    <p className="text-3xl font-bold text-slate-900 mt-1">{stats.total}</p>
                  </div>
                  <div className="p-3 bg-indigo-50 rounded-lg">
                    <svg className="w-6 h-6 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                      />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Open</p>
                    <p className="text-3xl font-bold text-amber-600 mt-1">{stats.open}</p>
                  </div>
                  <div className="p-3 bg-amber-50 rounded-lg">
                    <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">In Progress</p>
                    <p className="text-3xl font-bold text-blue-600 mt-1">{stats.inProgress}</p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-600">Closed</p>
                    <p className="text-3xl font-bold text-emerald-600 mt-1">{stats.closed}</p>
                  </div>
                  <div className="p-3 bg-emerald-50 rounded-lg">
                    <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">By Category</h3>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600">Successes (What Went Well)</span>
                      <span className="font-semibold text-slate-900">{stats.successes}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div style={{ width: `${stats.total ? (stats.successes / stats.total) * 100 : 0}%` }} className="bg-emerald-500 h-2 rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600">Improvements</span>
                      <span className="font-semibold text-slate-900">{stats.improvements}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div style={{ width: `${stats.total ? (stats.improvements / stats.total) * 100 : 0}%` }} className="bg-violet-500 h-2 rounded-full" />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="text-slate-600">Issues</span>
                      <span className="font-semibold text-slate-900">{stats.issues}</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2">
                      <div style={{ width: `${stats.total ? (stats.issues / stats.total) * 100 : 0}%` }} className="bg-rose-500 h-2 rounded-full" />
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Library Status</h3>
                <div className="flex items-center justify-center h-48">
                  <div className="text-center">
                    <div className="text-5xl font-bold text-indigo-600 mb-2">{stats.published}</div>
                    <div className="text-slate-500">Published to Org Library</div>
                    <div className="mt-4 text-sm text-slate-400">{stats.aiGenerated} AI-generated lessons</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* LIBRARY TAB */}
        {activeTab === "library" && (
          <div className="space-y-6">
            <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-6">
              <h3 className="text-lg font-semibold text-indigo-900 mb-2">Organization Library</h3>
              <p className="text-indigo-700 mb-4">Published lessons are shared across your organization for knowledge transfer.</p>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => setActiveTab("export")}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium text-sm transition-colors"
                  title="Go to Export (will export Org Library only)"
                >
                  Export Org Library
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>

                <button
                  onClick={exportExcel}
                  disabled={loading || exportRows.length === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 font-medium text-sm transition-colors disabled:opacity-50"
                >
                  Export Excel
                </button>

                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-indigo-200 text-indigo-700 rounded-lg hover:bg-indigo-50 font-medium text-sm transition-colors"
                >
                  Export PDF
                </a>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {libraryRows.length === 0 ? (
                <div className="text-center py-16 bg-white rounded-xl border border-dashed border-slate-300">
                  <p className="text-slate-500">No lessons published to the library yet.</p>
                  <button onClick={() => goTab("lessons")} className="mt-4 text-indigo-600 hover:text-indigo-700 font-medium text-sm">
                    Go to Lessons to publish →
                  </button>
                </div>
              ) : (
                libraryRows.map((l, idx) => (
                  <div key={String(l.id || idx)} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${pillForCategory(l.category)}`}>
                            {String(l.category || "").replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-slate-400">Published {formatUKDate(l.published_at || l.created_at)}</span>
                        </div>

                        <h3 className="text-lg font-semibold text-slate-900">{l.description}</h3>

                        {(l.library_tags || []).length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {(l.library_tags || []).map((tag) => (
                              <span key={tag} className="px-2 py-1 bg-slate-100 text-slate-600 text-xs rounded-md">
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <button onClick={() => publishToggle(l, false)} className="text-sm text-rose-600 hover:text-rose-700 font-medium">
                        Unpublish
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* EXPORT TAB */}
        {activeTab === "export" && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-6 border-b border-slate-100">
                <h3 className="text-lg font-semibold text-slate-900">Export Lessons</h3>
                <p className="text-sm text-slate-500 mt-1">Download your lessons in various formats</p>

                <div className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                  <button
                    onClick={() => setExportScope("lessons")}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                      exportScope === "lessons" ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Lessons (current filters)
                  </button>
                  <button
                    onClick={() => setExportScope("library")}
                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                      exportScope === "library" ? "bg-white shadow-sm text-slate-900" : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Org Library (published)
                  </button>
                </div>
              </div>

              <div className="p-6 space-y-4">
                <div
                  className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer group"
                  onClick={exportExcel}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-emerald-100 text-emerald-600 rounded-lg group-hover:bg-emerald-200">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900">Excel Spreadsheet</h4>
                      <p className="text-sm text-slate-500">Download as .xlsx for analysis</p>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-slate-400 group-hover:text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>

                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-rose-300 hover:bg-rose-50 transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-rose-100 text-rose-600 rounded-lg group-hover:bg-rose-200">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="font-semibold text-slate-900">PDF Report</h4>
                      <p className="text-sm text-slate-500">Formatted document for sharing</p>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-slate-400 group-hover:text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>

              <div className="bg-slate-50 p-4 text-xs text-slate-500 border-t border-slate-100">
                Export includes {exportRows.length} lessons • Scope: {exportScope === "library" ? "Org Library (Published)" : "Lessons (Filtered)"} • Last updated{" "}
                {formatUKDate(new Date().toISOString())}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            onClick={() => {
              setOpen(false);
              resetForm();
            }}
          />

          <div className="fixed inset-0 overflow-y-auto">
            <div className="min-h-full flex items-end sm:items-center justify-center p-4 sm:p-6">
              <div className="w-full sm:max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                <div className="bg-slate-50 px-6 py-4 border-b border-slate-100 flex justify-between items-center">
                  <h3 className="text-lg font-bold text-slate-900">{mode === "edit" ? "Edit Lesson" : "Record New Lesson"}</h3>
                  <button
                    onClick={() => {
                      setOpen(false);
                      resetForm();
                    }}
                    className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200 transition-colors"
                    aria-label="Close"
                    title="Close"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="px-6 py-6 space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Category</label>
                      <select
                        className="w-full bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        <option value="what_went_well">✅ What Went Well</option>
                        <option value="improvements">💡 Improvement</option>
                        <option value="issues">⚠️ Issue</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Status</label>
                      <select
                        className="w-full bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        <option value="Open">🔴 Open</option>
                        <option value="In Progress">🔵 In Progress</option>
                        <option value="Closed">⚫ Closed</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Description</label>
                    <textarea
                      className="block p-3 w-full text-sm text-slate-900 bg-slate-50 rounded-lg border border-slate-300 focus:ring-indigo-500 focus:border-indigo-500 min-h-[100px]"
                      placeholder="What happened? What did we learn?"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Action Owner</label>
                      <input
                        type="text"
                        className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2.5"
                        placeholder="e.g. John Smith"
                        value={actionOwnerName}
                        onChange={(e) => setActionOwnerName(e.target.value)}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Project Stage</label>
                      <input
                        type="text"
                        className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2.5"
                        placeholder="e.g. Design / Build"
                        value={stage}
                        onChange={(e) => setStage(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Impact</label>
                      <select
                        className="w-full bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                        value={impact}
                        onChange={(e) => setImpact(e.target.value)}
                      >
                        <option value="">— Select —</option>
                        <option value="Positive">👍 Positive</option>
                        <option value="Negative">👎 Negative</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-1.5">Severity</label>
                      <select
                        className="w-full bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5"
                        value={severity}
                        onChange={(e) => setSeverity(e.target.value)}
                      >
                        <option value="">— Select —</option>
                        <option value="Low">Low</option>
                        <option value="Medium">Medium</option>
                        <option value="High">High</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Action for Future</label>
                    <input
                      type="text"
                      className="bg-slate-50 border border-slate-300 text-slate-900 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block w-full p-2.5"
                      placeholder="What will we do next time?"
                      value={action}
                      onChange={(e) => setAction(e.target.value)}
                    />
                  </div>

                  {mode === "edit" && editing?.ai_generated && (
                    <div className="p-4 bg-indigo-50 rounded-lg border border-indigo-100">
                      <div className="flex items-center gap-2 mb-2">
                        <svg className="w-4 h-4 text-indigo-600" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                          <path
                            fillRule="evenodd"
                            d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="text-sm font-bold text-indigo-900">AI Summary</span>
                      </div>
                      <p className="text-sm text-indigo-800 italic">{editing.ai_summary || "No summary available."}</p>
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 px-6 py-4 border-t border-slate-100 flex flex-row-reverse gap-3">
                  <button
                    type="button"
                    disabled={saving || !description.trim()}
                    onClick={mode === "edit" ? updateLesson : createLesson}
                    className="w-full sm:w-auto inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {submitLabel}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      resetForm();
                    }}
                    className="w-full sm:w-auto inline-flex justify-center rounded-lg border border-slate-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}