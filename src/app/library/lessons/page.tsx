"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ✅ Reuse your existing Notion-ish lessons styles
import "@/app/projects/[id]/lessons/lessons.css";

import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

type Item = {
  id: string;
  project_id: string;
  category: string;
  description: string;
  action_for_future?: string | null;
  created_at: string;

  status?: string | null;
  impact?: string | null;
  severity?: string | null;
  project_stage?: string | null;

  is_published?: boolean | null;
  published_at?: string | null;
  library_tags?: string[] | null;

  projects?: { id: string; title: string; organisation_id?: string | null } | null;
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function slugify(x: string) {
  return String(x || "Org")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .slice(0, 60);
}

function safeExcelCell(v: any) {
  const s = String(v ?? "");
  // Prevent formula injection in Excel
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

export default function OrgLessonsLibraryPage() {
  const router = useRouter();

  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);

  const [q, setQ] = useState("");
  const [tag, setTag] = useState("");

  async function load(nextQ?: string, nextTag?: string) {
    setLoading(true);
    try {
      const url = new URL(window.location.origin + "/api/library/lessons");
      const qq = (nextQ ?? q).trim();
      const tt = (nextTag ?? tag).trim();

      if (qq) url.searchParams.set("q", qq);
      if (tt) url.searchParams.set("tag", tt);
      url.searchParams.set("limit", "200");

      const r = await fetch(url.toString(), { cache: "no-store" });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || "Failed to load library");
      setItems(j.items ?? []);
    } catch (e: any) {
      alert(e?.message || "Failed to load library");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allTags = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) for (const t of it.library_tags || []) s.add(String(t));
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [items]);

  async function exportExcel() {
    try {
      const data =
        items.length > 0
          ? items.map((it, idx) => ({
              Published: safeExcelCell(it.published_at ? String(it.published_at).slice(0, 10) : ""),
              No: items.length - idx,
              Description: safeExcelCell(it.description),
              Category: safeExcelCell(it.category || ""),
              Tags: safeExcelCell((it.library_tags || []).join(", ")),
              "Action for future": safeExcelCell(it.action_for_future || ""),
              Project: safeExcelCell(it.projects?.title || ""),
              "Project ID": safeExcelCell(it.project_id || ""),
            }))
          : [
              {
                Published: "",
                No: "",
                Description: "",
                Category: "",
                Tags: "",
                "Action for future": "",
                Project: "",
                "Project ID": "",
              },
            ];

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Org Lessons");

      (ws as any)["!freeze"] = { xSplit: 0, ySplit: 1 };
      (ws as any)["!cols"] = [
        { wch: 12 }, // Published
        { wch: 6 }, // No
        { wch: 65 }, // Description
        { wch: 16 }, // Category
        { wch: 30 }, // Tags
        { wch: 42 }, // Action for future
        { wch: 28 }, // Project
        { wch: 36 }, // Project ID
      ];

      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

      const suffix = tag ? `Tag-${slugify(tag)}` : q ? `Search-${slugify(q)}` : "All";
      const fileBase = `Org_Lessons_Library_${suffix}`;

      saveAs(
        new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        `${fileBase}.xlsx`
      );
    } catch (e: any) {
      alert(e?.message || "Excel export failed");
    }
  }

  function goBack() {
    // router.back() is ideal, but if user landed directly it can be a no-op; fallback to /projects
    try {
      router.back();
      setTimeout(() => {
        if (typeof window !== "undefined" && window.history.length <= 1) router.push("/projects");
      }, 50);
    } catch {
      router.push("/projects");
    }
  }

  return (
    <div className="lessonsWrap">
      <div className="lessonsHeader">
        <div className="lessonsTitle">📚 Org Lessons Library {loading ? "…" : ""}</div>

        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn" onClick={goBack}>
            ← Back
          </button>

          <button className="btn" onClick={exportExcel} disabled={loading}>
            📊 Export Excel
          </button>

          <Link className="btn" href="/projects">
            ← Projects
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, padding: "0 2px 10px 2px" }}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search description…"
          style={{ maxWidth: 420 }}
        />

        <select className="select" value={tag} onChange={(e) => setTag(e.target.value)} style={{ maxWidth: 240 }}>
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <button className="btn" onClick={() => load(q, tag)} disabled={loading}>
          Search
        </button>

        <button
          className="btn"
          onClick={() => {
            setQ("");
            setTag("");
            load("", "");
          }}
          disabled={loading}
        >
          Reset
        </button>
      </div>

      <div className="lessonsTable">
        <table>
          <thead>
            <tr>
              <th>Published</th>
              <th>Description</th>
              <th>Category</th>
              <th>Tags</th>
              <th>Action for future</th>
              <th>Project</th>
            </tr>
          </thead>

          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.published_at ? String(it.published_at).slice(0, 10) : "—"}</td>

                <td style={{ fontWeight: 650 }}>{it.description}</td>

                <td>
                  <span className="pill gray">{it.category}</span>
                </td>

                <td>
                  {(it.library_tags || []).length ? (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {(it.library_tags || []).slice(0, 6).map((t) => (
                        <span key={t} className="pill gray">
                          {t}
                        </span>
                      ))}
                      {(it.library_tags || []).length > 6 ? (
                        <span className="pill gray">+{(it.library_tags || []).length - 6}</span>
                      ) : null}
                    </div>
                  ) : (
                    "—"
                  )}
                </td>

                <td>{it.action_for_future || "—"}</td>

                <td>
                  {it.projects?.id ? (
                    <Link className="underline" href={`/projects/${it.projects.id}/lessons`}>
                      {safeStr(it.projects.title) || "Project"}
                    </Link>
                  ) : (
                    <span className="mono">{it.project_id.slice(0, 8)}…</span>
                  )}
                </td>
              </tr>
            ))}

            {items.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 16, color: "#666" }}>
                  No published lessons yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
