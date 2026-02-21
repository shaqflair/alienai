"use client";

import React, { useEffect, useMemo, useState, useRef, useCallback } from "react";
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
  if (c === "what_went_well") return "pill green";
  if (c === "improvements") return "pill purple";
  if (c === "issues") return "pill red";
  return "pill gray";
}

function pillForStatus(s: string) {
  const v = String(s || "").trim();
  if (v === "Closed") return "pill gray";
  if (v === "In Progress") return "pill blue";
  return "pill amber";
}

function categoryLabel(c: string) {
  if (c === "what_went_well") return "What Went Well";
  if (c === "improvements") return "Improvement";
  if (c === "issues") return "Issue";
  return String(c || "").replace(/_/g, " ");
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
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

/* ---------------- styles ---------------- */

const styles = `
/* ===== BASE RESET & TOKENS ===== */
.ll-root {
  --bg-page: #f8f8f7;
  --bg-surface: #ffffff;
  --bg-hover: #f5f5f4;
  --bg-active: #eeeeec;
  --border-light: rgba(0,0,0,.06);
  --border-medium: rgba(0,0,0,.10);
  --border-heavy: rgba(0,0,0,.14);
  --text-primary: #1a1a1a;
  --text-secondary: #6b6b6b;
  --text-tertiary: #9b9b9b;
  --accent: #2383e2;
  --accent-hover: #1b6ec2;
  --accent-bg: #e8f0fe;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-xl: 16px;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.04);
  --shadow-md: 0 4px 16px rgba(0,0,0,.08);
  --shadow-lg: 0 12px 40px rgba(0,0,0,.12);
  --shadow-modal: 0 20px 60px rgba(0,0,0,.22);
  --font-body: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;

  font-family: var(--font-body);
  color: var(--text-primary);
  background: var(--bg-page);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

/* ===== LAYOUT ===== */
.ll-wrap {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px 80px;
}

/* ===== HEADER ===== */
.ll-header {
  position: sticky;
  top: 0;
  z-index: 20;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-light);
}

.ll-header-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ll-back-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 120ms;
  flex-shrink: 0;
}
.ll-back-btn:hover { background: var(--bg-hover); color: var(--text-primary); }

.ll-header-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.ll-header-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ll-header-sub {
  font-size: 12px;
  color: var(--text-tertiary);
  white-space: nowrap;
}

.ll-header-divider {
  width: 1px;
  height: 16px;
  background: var(--border-medium);
  flex-shrink: 0;
}

.ll-header-right {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ===== TABS ===== */
.ll-tabs {
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-light);
}

.ll-tabs-inner {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  gap: 2px;
}

.ll-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-tertiary);
  border: none;
  background: transparent;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 120ms;
  white-space: nowrap;
}
.ll-tab:hover { color: var(--text-secondary); }
.ll-tab.active { color: var(--text-primary); border-bottom-color: var(--text-primary); }

.ll-tab-count {
  font-size: 11px;
  font-weight: 600;
  background: var(--bg-hover);
  color: var(--text-secondary);
  padding: 1px 6px;
  border-radius: 10px;
}
.ll-tab.active .ll-tab-count {
  background: var(--text-primary);
  color: #fff;
}

.ll-tab-icon {
  width: 15px;
  height: 15px;
  opacity: .6;
}
.ll-tab.active .ll-tab-icon { opacity: 1; }

/* ===== BUTTONS ===== */
.ll-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-medium);
  background: var(--bg-surface);
  color: var(--text-primary);
  cursor: pointer;
  transition: all 120ms;
  white-space: nowrap;
  text-decoration: none;
  font-family: inherit;
}
.ll-btn:hover { background: var(--bg-hover); }
.ll-btn:disabled { opacity: .45; cursor: not-allowed; }

.ll-btn-primary {
  background: #2383e2;
  color: #fff;
  border-color: #2383e2;
}
.ll-btn-primary:hover { background: #1b6ec2; border-color: #1b6ec2; }

.ll-btn-ghost {
  border-color: transparent;
  background: transparent;
  color: var(--text-secondary);
}
.ll-btn-ghost:hover { background: var(--bg-hover); color: var(--text-primary); }

.ll-btn-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

/* ===== TOOLBAR (filters bar) ===== */
.ll-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 0;
  flex-wrap: wrap;
}

.ll-toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
  flex-wrap: wrap;
}

.ll-toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.ll-search-wrap {
  position: relative;
  width: 220px;
}
.ll-search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  color: var(--text-tertiary);
  pointer-events: none;
}

.ll-search {
  width: 100%;
  height: 32px;
  padding: 0 10px 0 28px;
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  font-size: 13px;
  background: var(--bg-surface);
  color: var(--text-primary);
  font-family: inherit;
  transition: border-color 120ms;
}
.ll-search:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(35,131,226,.15); }
.ll-search::placeholder { color: var(--text-tertiary); }

.ll-filter-select {
  height: 32px;
  padding: 0 28px 0 10px;
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  font-size: 13px;
  background: var(--bg-surface);
  color: var(--text-primary);
  cursor: pointer;
  font-family: inherit;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1L5 5L9 1' stroke='%239b9b9b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  transition: border-color 120ms;
}
.ll-filter-select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(35,131,226,.15); }

/* ===== NOTION-STYLE TABLE ===== */
.ll-table-container {
  background: var(--bg-surface);
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.ll-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: fixed;
}

.ll-table thead th {
  background: #fafafa;
  text-align: left;
  padding: 8px 12px;
  color: var(--text-tertiary);
  font-weight: 500;
  font-size: 12px;
  border-bottom: 1px solid var(--border-light);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  user-select: none;
  position: relative;
}

.ll-table thead th .th-resize {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 120ms;
}
.ll-table thead th .th-resize:hover,
.ll-table thead th .th-resize.active {
  background: var(--accent);
}

.ll-table tbody td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-light);
  vertical-align: middle;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
  line-height: 1.4;
}

.ll-table tbody td.td-desc {
  white-space: normal;
  overflow: visible;
  text-overflow: unset;
}

.ll-table tbody tr {
  transition: background 80ms;
}
.ll-table tbody tr:hover {
  background: #f8f8f7;
}
.ll-table tbody tr:last-child td {
  border-bottom: none;
}

/* Row click */
.ll-table tbody tr {
  cursor: pointer;
}

/* Column widths */
.col-status { width: 90px; }
.col-category { width: 120px; }
.col-desc { width: auto; }
.col-owner { width: 120px; }
.col-stage { width: 100px; }
.col-severity { width: 80px; }
.col-impact { width: 80px; }
.col-date { width: 95px; }
.col-published { width: 80px; }
.col-actions { width: 90px; }

/* ===== PILLS ===== */
.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  line-height: 1.5;
}
.pill.green { background: #dbeddb; color: #1e7e34; }
.pill.purple { background: #e8deee; color: #6c3d8f; }
.pill.red { background: #ffe2dd; color: #c4320a; }
.pill.gray { background: #e8e8e6; color: #6b6b6b; }
.pill.blue { background: #d3e5ef; color: #1a6fa8; }
.pill.amber { background: #fdecc8; color: #9a6700; }

.pill-severity-high { color: #c4320a; font-weight: 600; }
.pill-severity-med { color: #9a6700; font-weight: 500; }

.tag-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 11px;
  background: var(--bg-hover);
  color: var(--text-secondary);
  margin-right: 3px;
}

/* ===== ACTION BUTTONS IN TABLE ===== */
.ll-row-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 120ms;
}
.ll-table tbody tr:hover .ll-row-actions { opacity: 1; }

.ll-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 100ms;
}
.ll-action-btn:hover { background: var(--bg-active); color: var(--text-primary); }
.ll-action-btn.danger:hover { background: #ffe2dd; color: #c4320a; }
.ll-action-btn.publish:hover { background: #d3e5ef; color: #1a6fa8; }

.ll-action-icon { width: 14px; height: 14px; }

/* AI badge */
.ai-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--accent);
  font-weight: 500;
}

/* Published dot */
.pub-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.pub-dot.yes { background: #2ecc71; }
.pub-dot.no { background: #d5d5d3; }

/* ===== EMPTY STATE ===== */
.ll-empty {
  text-align: center;
  padding: 60px 24px;
  color: var(--text-tertiary);
}
.ll-empty-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 4px;
}
.ll-empty-sub {
  font-size: 13px;
  color: var(--text-tertiary);
}

/* ===== LOADING ===== */
.ll-spinner {
  display: flex;
  justify-content: center;
  padding: 60px 0;
}
.ll-spinner-dot {
  width: 24px;
  height: 24px;
  border: 2.5px solid var(--border-medium);
  border-top-color: var(--text-primary);
  border-radius: 50%;
  animation: ll-spin .6s linear infinite;
}
@keyframes ll-spin { to { transform: rotate(360deg); } }

/* ===== INSIGHTS CARDS ===== */
.ll-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.ll-stat-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 16px 18px;
}

.ll-stat-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.ll-stat-value {
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
}
.ll-stat-value.amber { color: #9a6700; }
.ll-stat-value.blue { color: #1a6fa8; }
.ll-stat-value.green { color: #1e7e34; }
.ll-stat-value.accent { color: var(--accent); }

.ll-insights-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 768px) {
  .ll-insights-grid { grid-template-columns: 1fr; }
}

.ll-insight-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 20px;
}

.ll-insight-card h3 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 16px;
}

.ll-bar-row {
  margin-bottom: 12px;
}
.ll-bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 4px;
}
.ll-bar-label span:first-child { color: var(--text-secondary); }
.ll-bar-label span:last-child { font-weight: 600; color: var(--text-primary); }
.ll-bar-track {
  height: 6px;
  background: var(--bg-hover);
  border-radius: 3px;
  overflow: hidden;
}
.ll-bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 400ms ease;
}
.ll-bar-fill.green { background: #2ecc71; }
.ll-bar-fill.purple { background: #9b59b6; }
.ll-bar-fill.red { background: #e74c3c; }

.ll-library-hero {
  font-size: 36px;
  font-weight: 700;
  color: var(--accent);
  text-align: center;
  padding: 20px 0 4px;
}
.ll-library-hero-sub {
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

/* ===== LIBRARY TAB ===== */
.ll-library-banner {
  background: #f0f7ff;
  border: 1px solid #d3e5ef;
  border-radius: var(--radius-lg);
  padding: 20px;
  margin-bottom: 16px;
}
.ll-library-banner h3 {
  font-size: 15px;
  font-weight: 600;
  color: #1a4971;
  margin: 0 0 6px;
}
.ll-library-banner p {
  font-size: 13px;
  color: #2a6496;
  margin: 0 0 14px;
}
.ll-library-banner-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ll-library-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  padding: 16px 20px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  transition: background 100ms;
}
.ll-library-card:hover { background: var(--bg-hover); }

.ll-library-card-left { flex: 1; min-width: 0; }

.ll-library-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.ll-library-desc {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 8px;
  line-height: 1.4;
}

.ll-library-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* ===== EXPORT TAB ===== */
.ll-export-wrap {
  max-width: 560px;
  margin: 0 auto;
}

.ll-export-card {
  background: var(--bg-surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.ll-export-header {
  padding: 20px;
  border-bottom: 1px solid var(--border-light);
}
.ll-export-header h3 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 4px;
}
.ll-export-header p {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0 0 14px;
}

.ll-scope-toggle {
  display: inline-flex;
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--bg-hover);
}
.ll-scope-btn {
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 120ms;
  font-family: inherit;
}
.ll-scope-btn.active {
  background: var(--bg-surface);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.ll-export-body { padding: 16px 20px; }

.ll-export-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 120ms;
  margin-bottom: 10px;
  text-decoration: none;
  color: inherit;
}
.ll-export-option:hover { border-color: var(--accent); background: #f8fbff; }

.ll-export-option-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ll-export-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.ll-export-icon.excel { background: #e6f4ea; color: #1e7e34; }
.ll-export-icon.pdf { background: #ffe2dd; color: #c4320a; }
.ll-export-icon svg { width: 18px; height: 18px; }

.ll-export-option h4 {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 2px;
}
.ll-export-option p {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0;
}

.ll-export-footer {
  padding: 12px 20px;
  background: #fafafa;
  border-top: 1px solid var(--border-light);
  font-size: 12px;
  color: var(--text-tertiary);
}

/* ===== MODAL ===== */
.ll-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15,15,15,.6);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  z-index: 100;
  animation: ll-fade-in 150ms ease;
}
@keyframes ll-fade-in { from { opacity: 0; } to { opacity: 1; } }

.ll-modal {
  width: min(680px, 100%);
  max-height: calc(100vh - 80px);
  overflow-y: auto;
  background: var(--bg-surface);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-modal);
  animation: ll-slide-up 200ms ease;
}
@keyframes ll-slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

.ll-modal-header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-light);
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.ll-modal-header h3 {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
}

.ll-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  transition: all 100ms;
}
.ll-modal-close:hover { background: var(--bg-hover); color: var(--text-primary); }

.ll-modal-body {
  padding: 20px;
  display: grid;
  gap: 14px;
}

.ll-modal-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}
@media (max-width: 520px) {
  .ll-modal-row { grid-template-columns: 1fr; }
}

.ll-field label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 5px;
}

.ll-input, .ll-select, .ll-textarea {
  width: 100%;
  border: 1px solid var(--border-medium);
  border-radius: var(--radius-md);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  color: var(--text-primary);
  background: var(--bg-surface);
  transition: border-color 120ms;
}
.ll-input:focus, .ll-select:focus, .ll-textarea:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(35,131,226,.15);
}
.ll-textarea { min-height: 100px; resize: vertical; }
.ll-select { cursor: pointer; }

.ll-ai-summary {
  padding: 12px 14px;
  background: #f0f7ff;
  border: 1px solid #d3e5ef;
  border-radius: var(--radius-md);
}
.ll-ai-summary-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: #1a6fa8;
  margin-bottom: 6px;
}
.ll-ai-summary p {
  font-size: 13px;
  color: #2a6496;
  margin: 0;
  font-style: italic;
  line-height: 1.5;
}

.ll-modal-footer {
  padding: 14px 20px;
  border-top: 1px solid var(--border-light);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

/* ===== RESPONSIVE ===== */
@media (max-width: 768px) {
  .ll-toolbar { flex-direction: column; align-items: stretch; }
  .ll-toolbar-left, .ll-toolbar-right { width: 100%; }
  .ll-search-wrap { width: 100%; }
  .ll-stats-grid { grid-template-columns: repeat(2, 1fr); }
  .col-stage, .col-severity, .col-impact { display: none; }
}

@media (max-width: 640px) {
  .col-owner, .col-date { display: none; }
}
`;

/* ---------------- component ---------------- */

export default function LessonsPage() {
  const router = useRouter();
  const params = useParams();
  const projectRef = String((params as any)?.id || "").trim();

  const [activeTab, setActiveTab] = useState<TabType>("lessons");
  const [exportScope, setExportScope] = useState<ExportScope>("lessons");

  const [items, setItems] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<ProjectMeta>({
    title: "Project",
    project_code: projectRef || "—",
  });

  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editing, setEditing] = useState<Lesson | null>(null);

  const [category, setCategory] = useState("what_went_well");
  const [description, setDescription] = useState("");
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("Open");
  const [impact, setImpact] = useState("");
  const [severity, setSeverity] = useState("");
  const [stage, setStage] = useState("");
  const [actionOwnerName, setActionOwnerName] = useState("");

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
    const url = `/api/lessons?projectId=${encodeURIComponent(projectRef)}`;
    try {
      const r = await fetch(url, { cache: "no-store" });
      const raw = await r.clone().text();
      let j: any = null;
      try { j = raw && raw.trim() ? JSON.parse(raw) : null; } catch { j = null; }
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
      const r = await fetch(`/api/projects/${encodeURIComponent(projectRef)}/meta`, { cache: "no-store" });
      const raw = await r.clone().text();
      let j: any = null;
      try { j = raw && raw.trim() ? JSON.parse(raw) : null; } catch { j = null; }
      if (r.ok && j?.ok && j?.project) {
        const code = safeStr(j.project.project_code || j.project.code || projectRef).trim() || projectRef;
        setMeta({ title: safeStr(j.project.title) || "Project", project_code: code });
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

  function goTab(t: TabType) {
    setActiveTab(t);
    if (t === "lessons") setExportScope("lessons");
    if (t === "library") setExportScope("library");
  }

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

  const libraryRows = useMemo(() => items.filter((l) => Boolean(l.is_published)), [items]);

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
    if (!isUuidClient(id)) { alert("Cannot update: invalid id"); return; }
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
    if (!isUuidClient(id)) { alert("Cannot delete: invalid id"); return; }
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
    if (!isUuidClient(id)) { alert("Invalid ID"); return; }
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

  const scopeLabel = exportScope === "library" ? "Org_Library" : "Lessons_Learned";
  const fileBase = `${scopeLabel}_${meta.project_code}_${slugify(meta.title)}`;
  const pdfHref =
    exportScope === "library"
      ? `/projects/${projectRef}/lessons/export/pdf?filename=${encodeURIComponent(fileBase)}&publishedOnly=1`
      : `/projects/${projectRef}/lessons/export/pdf?filename=${encodeURIComponent(fileBase)}`;

  const stats = useMemo(() => {
    const total = items.length;
    return {
      total,
      open: items.filter((i) => i.status === "Open").length,
      closed: items.filter((i) => i.status === "Closed").length,
      inProgress: items.filter((i) => i.status === "In Progress").length,
      published: items.filter((i) => i.is_published).length,
      aiGenerated: items.filter((i) => i.ai_generated).length,
      issues: items.filter((i) => i.category === "issues").length,
      improvements: items.filter((i) => i.category === "improvements").length,
      successes: items.filter((i) => i.category === "what_went_well").length,
    };
  }, [items]);

  /* ===== SVG Icons (inline for zero dependencies) ===== */
  const Icon = {
    back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>,
    plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>,
    search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>,
    clipboard: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>,
    chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10M12 20V4M6 20v-6"/></svg>,
    library: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/></svg>,
    download: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>,
    edit: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>,
    trash: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/></svg>,
    globe: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>,
    ban: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M4.93 4.93l14.14 14.14"/></svg>,
    close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>,
    sparkle: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z"/></svg>,
    file: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>,
    chevronRight: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>,
    externalLink: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>,
  };

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: styles }} />

      <div className="ll-root">
        {/* ===== HEADER ===== */}
        <header className="ll-header">
          <div className="ll-header-inner">
            <div className="ll-header-left">
              <button onClick={() => router.back()} className="ll-back-btn" aria-label="Back" title="Back">
                {Icon.back}
              </button>
              <span className="ll-header-title">Lessons Learned</span>
              <span className="ll-header-divider" />
              <span className="ll-header-sub">{meta.project_code} · {meta.title}</span>
            </div>

            <div className="ll-header-right">
              {activeTab === "lessons" && (
                <button onClick={openCreate} className="ll-btn ll-btn-primary">
                  <span className="ll-btn-icon">{Icon.plus}</span>
                  New Lesson
                </button>
              )}
            </div>
          </div>
        </header>

        {/* ===== TABS ===== */}
        <nav className="ll-tabs">
          <div className="ll-tabs-inner">
            <button onClick={() => goTab("lessons")} className={`ll-tab ${activeTab === "lessons" ? "active" : ""}`}>
              <span className="ll-tab-icon">{Icon.clipboard}</span>
              All Lessons
              <span className="ll-tab-count">{stats.total}</span>
            </button>
            <button onClick={() => goTab("insights")} className={`ll-tab ${activeTab === "insights" ? "active" : ""}`}>
              <span className="ll-tab-icon">{Icon.chart}</span>
              Insights
            </button>
            <button onClick={() => goTab("library")} className={`ll-tab ${activeTab === "library" ? "active" : ""}`}>
              <span className="ll-tab-icon">{Icon.library}</span>
              Org Library
              <span className="ll-tab-count">{stats.published}</span>
            </button>
            <button onClick={() => setActiveTab("export")} className={`ll-tab ${activeTab === "export" ? "active" : ""}`}>
              <span className="ll-tab-icon">{Icon.download}</span>
              Export
            </button>
          </div>
        </nav>

        {/* ===== MAIN ===== */}
        <div className="ll-wrap" style={{ paddingTop: 20 }}>

          {/* ========== LESSONS TAB ========== */}
          {activeTab === "lessons" && (
            <>
              {/* Toolbar */}
              <div className="ll-toolbar">
                <div className="ll-toolbar-left">
                  <div className="ll-search-wrap">
                    <span className="ll-search-icon">{Icon.search}</span>
                    <input
                      type="text"
                      placeholder="Search lessons…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="ll-search"
                    />
                  </div>
                  <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} className="ll-filter-select">
                    <option value="all">All Categories</option>
                    <option value="what_went_well">What Went Well</option>
                    <option value="improvements">Improvements</option>
                    <option value="issues">Issues</option>
                  </select>
                  <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="ll-filter-select">
                    <option value="all">All Statuses</option>
                    <option value="Open">Open</option>
                    <option value="In Progress">In Progress</option>
                    <option value="Closed">Closed</option>
                  </select>
                </div>
                <div className="ll-toolbar-right">
                  <button onClick={runAi} disabled={loading} className="ll-btn" title="AI Generate Lessons">
                    <span className="ll-btn-icon">{Icon.sparkle}</span>
                    AI Generate
                  </button>
                  <button onClick={exportExcel} disabled={loading || exportRows.length === 0} className="ll-btn" title="Export Excel">
                    <span className="ll-btn-icon">{Icon.download}</span>
                    Excel
                  </button>
                  <a href={pdfHref} target="_blank" rel="noreferrer" className="ll-btn" title="Export PDF">
                    <span className="ll-btn-icon">{Icon.file}</span>
                    PDF
                  </a>
                </div>
              </div>

              {/* Table */}
              {loading && items.length === 0 ? (
                <div className="ll-spinner"><div className="ll-spinner-dot" /></div>
              ) : filteredRows.length === 0 ? (
                <div className="ll-table-container">
                  <div className="ll-empty">
                    <div className="ll-empty-title">No lessons found</div>
                    <div className="ll-empty-sub">Try adjusting your filters or create a new lesson.</div>
                  </div>
                </div>
              ) : (
                <div className="ll-table-container">
                  <table className="ll-table">
                    <thead>
                      <tr>
                        <th className="col-status">Status</th>
                        <th className="col-category">Category</th>
                        <th className="col-desc">Description</th>
                        <th className="col-owner">Owner</th>
                        <th className="col-stage">Stage</th>
                        <th className="col-severity">Severity</th>
                        <th className="col-impact">Impact</th>
                        <th className="col-date">Date</th>
                        <th className="col-published">Library</th>
                        <th className="col-actions"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((l, idx) => {
                        const published = Boolean(l.is_published);
                        const idOk = isUuidClient(l?.id);

                        return (
                          <tr key={String(l.id || idx)} onClick={() => openEdit(l)}>
                            <td>
                              <span className={pillForStatus(l.status || "Open")}>
                                {l.status || "Open"}
                              </span>
                            </td>
                            <td>
                              <span className={pillForCategory(l.category)}>
                                {categoryLabel(l.category)}
                              </span>
                            </td>
                            <td className="td-desc" style={{ fontWeight: 500 }}>
                              {l.description}
                              {l.ai_generated && (
                                <span className="ai-badge" style={{ marginLeft: 6 }}>✦ AI</span>
                              )}
                              {!idOk && (
                                <span style={{ marginLeft: 6, color: "#c4320a", fontSize: 11, fontWeight: 600 }}>⚠ Invalid ID</span>
                              )}
                            </td>
                            <td>{l.action_owner_label || <span style={{ color: "var(--text-tertiary)" }}>—</span>}</td>
                            <td>{l.project_stage || <span style={{ color: "var(--text-tertiary)" }}>—</span>}</td>
                            <td>
                              {l.severity ? (
                                <span className={l.severity === "High" ? "pill-severity-high" : l.severity === "Medium" ? "pill-severity-med" : ""}>
                                  {l.severity}
                                </span>
                              ) : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                            </td>
                            <td>
                              {l.impact ? (
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                  <span style={{
                                    width: 7, height: 7, borderRadius: "50%",
                                    background: l.impact === "Positive" ? "#2ecc71" : "#e74c3c",
                                    flexShrink: 0,
                                  }} />
                                  {l.impact}
                                </span>
                              ) : <span style={{ color: "var(--text-tertiary)" }}>—</span>}
                            </td>
                            <td style={{ fontSize: 12, color: "var(--text-secondary)" }}>{formatUKDate(l.created_at)}</td>
                            <td>
                              <span className={`pub-dot ${published ? "yes" : "no"}`} title={published ? "Published" : "Private"} />
                            </td>
                            <td onClick={(e) => e.stopPropagation()}>
                              <div className="ll-row-actions">
                                <button
                                  onClick={() => publishToggle(l, !published)}
                                  className="ll-action-btn publish"
                                  title={published ? "Unpublish" : "Publish"}
                                >
                                  <span className="ll-action-icon">{published ? Icon.ban : Icon.globe}</span>
                                </button>
                                <button onClick={() => openEdit(l)} className="ll-action-btn" title="Edit">
                                  <span className="ll-action-icon">{Icon.edit}</span>
                                </button>
                                <button onClick={() => deleteLesson(l)} className="ll-action-btn danger" title="Delete">
                                  <span className="ll-action-icon">{Icon.trash}</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {/* ========== INSIGHTS TAB ========== */}
          {activeTab === "insights" && (
            <div>
              <div className="ll-stats-grid">
                <div className="ll-stat-card">
                  <div className="ll-stat-label">Total Lessons</div>
                  <div className="ll-stat-value">{stats.total}</div>
                </div>
                <div className="ll-stat-card">
                  <div className="ll-stat-label">Open</div>
                  <div className="ll-stat-value amber">{stats.open}</div>
                </div>
                <div className="ll-stat-card">
                  <div className="ll-stat-label">In Progress</div>
                  <div className="ll-stat-value blue">{stats.inProgress}</div>
                </div>
                <div className="ll-stat-card">
                  <div className="ll-stat-label">Closed</div>
                  <div className="ll-stat-value green">{stats.closed}</div>
                </div>
              </div>

              <div className="ll-insights-grid">
                <div className="ll-insight-card">
                  <h3>By Category</h3>
                  <div className="ll-bar-row">
                    <div className="ll-bar-label">
                      <span>What Went Well</span>
                      <span>{stats.successes}</span>
                    </div>
                    <div className="ll-bar-track">
                      <div className="ll-bar-fill green" style={{ width: `${stats.total ? (stats.successes / stats.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <div className="ll-bar-row">
                    <div className="ll-bar-label">
                      <span>Improvements</span>
                      <span>{stats.improvements}</span>
                    </div>
                    <div className="ll-bar-track">
                      <div className="ll-bar-fill purple" style={{ width: `${stats.total ? (stats.improvements / stats.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <div className="ll-bar-row">
                    <div className="ll-bar-label">
                      <span>Issues</span>
                      <span>{stats.issues}</span>
                    </div>
                    <div className="ll-bar-track">
                      <div className="ll-bar-fill red" style={{ width: `${stats.total ? (stats.issues / stats.total) * 100 : 0}%` }} />
                    </div>
                  </div>
                </div>

                <div className="ll-insight-card">
                  <h3>Library Status</h3>
                  <div className="ll-library-hero">{stats.published}</div>
                  <div className="ll-library-hero-sub">Published to Org Library</div>
                  <div className="ll-library-hero-sub" style={{ color: "var(--text-tertiary)" }}>{stats.aiGenerated} AI-generated lessons</div>
                </div>
              </div>
            </div>
          )}

          {/* ========== LIBRARY TAB ========== */}
          {activeTab === "library" && (
            <div>
              <div className="ll-library-banner">
                <h3>Organization Library</h3>
                <p>Published lessons are shared across your organization for knowledge transfer.</p>
                <div className="ll-library-banner-actions">
                  <button onClick={() => setActiveTab("export")} className="ll-btn ll-btn-primary" title="Export Org Library">
                    <span className="ll-btn-icon">{Icon.download}</span>
                    Export Org Library
                  </button>
                  <button onClick={exportExcel} disabled={loading || exportRows.length === 0} className="ll-btn">
                    Export Excel
                  </button>
                  <a href={pdfHref} target="_blank" rel="noreferrer" className="ll-btn">
                    Export PDF
                  </a>
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                {libraryRows.length === 0 ? (
                  <div className="ll-table-container">
                    <div className="ll-empty">
                      <div className="ll-empty-title">No lessons published to the library yet</div>
                      <button onClick={() => goTab("lessons")} style={{ marginTop: 8, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500, fontFamily: "inherit" }}>
                        Go to Lessons to publish →
                      </button>
                    </div>
                  </div>
                ) : (
                  libraryRows.map((l, idx) => (
                    <div key={String(l.id || idx)} className="ll-library-card">
                      <div className="ll-library-card-left">
                        <div className="ll-library-meta">
                          <span className={pillForCategory(l.category)}>{categoryLabel(l.category)}</span>
                          <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>Published {formatUKDate(l.published_at || l.created_at)}</span>
                        </div>
                        <div className="ll-library-desc">{l.description}</div>
                        {(l.library_tags || []).length > 0 && (
                          <div className="ll-library-tags">
                            {(l.library_tags || []).map((tag) => (
                              <span key={tag} className="tag-chip">#{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() => publishToggle(l, false)}
                        className="ll-btn"
                        style={{ color: "#c4320a", borderColor: "rgba(196,50,10,.2)", flexShrink: 0 }}
                      >
                        Unpublish
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* ========== EXPORT TAB ========== */}
          {activeTab === "export" && (
            <div className="ll-export-wrap">
              <div className="ll-export-card">
                <div className="ll-export-header">
                  <h3>Export Lessons</h3>
                  <p>Download your lessons in various formats</p>
                  <div className="ll-scope-toggle">
                    <button onClick={() => setExportScope("lessons")} className={`ll-scope-btn ${exportScope === "lessons" ? "active" : ""}`}>
                      Lessons (filtered)
                    </button>
                    <button onClick={() => setExportScope("library")} className={`ll-scope-btn ${exportScope === "library" ? "active" : ""}`}>
                      Org Library (published)
                    </button>
                  </div>
                </div>

                <div className="ll-export-body">
                  <div className="ll-export-option" onClick={exportExcel}>
                    <div className="ll-export-option-left">
                      <div className="ll-export-icon excel">{Icon.download}</div>
                      <div>
                        <h4>Excel Spreadsheet</h4>
                        <p>Download as .xlsx for analysis</p>
                      </div>
                    </div>
                    <span className="ll-btn-icon" style={{ color: "var(--text-tertiary)" }}>{Icon.chevronRight}</span>
                  </div>

                  <a href={pdfHref} target="_blank" rel="noreferrer" className="ll-export-option">
                    <div className="ll-export-option-left">
                      <div className="ll-export-icon pdf">{Icon.file}</div>
                      <div>
                        <h4>PDF Report</h4>
                        <p>Formatted document for sharing</p>
                      </div>
                    </div>
                    <span className="ll-btn-icon" style={{ color: "var(--text-tertiary)" }}>{Icon.externalLink}</span>
                  </a>
                </div>

                <div className="ll-export-footer">
                  {exportRows.length} lessons · Scope: {exportScope === "library" ? "Org Library (Published)" : "Lessons (Filtered)"} · {formatUKDate(new Date().toISOString())}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== MODAL ===== */}
        {open && (
          <div className="ll-modal-overlay" onClick={() => { setOpen(false); resetForm(); }}>
            <div className="ll-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ll-modal-header">
                <h3>{mode === "edit" ? "Edit Lesson" : "Record New Lesson"}</h3>
                <button onClick={() => { setOpen(false); resetForm(); }} className="ll-modal-close" aria-label="Close" title="Close">
                  {Icon.close}
                </button>
              </div>

              <div className="ll-modal-body">
                <div className="ll-modal-row">
                  <div className="ll-field">
                    <label>Category</label>
                    <select className="ll-select" value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="what_went_well">✅ What Went Well</option>
                      <option value="improvements">💡 Improvement</option>
                      <option value="issues">⚠️ Issue</option>
                    </select>
                  </div>
                  <div className="ll-field">
                    <label>Status</label>
                    <select className="ll-select" value={status} onChange={(e) => setStatus(e.target.value)}>
                      <option value="Open">Open</option>
                      <option value="In Progress">In Progress</option>
                      <option value="Closed">Closed</option>
                    </select>
                  </div>
                </div>

                <div className="ll-field">
                  <label>Description</label>
                  <textarea
                    className="ll-textarea"
                    placeholder="What happened? What did we learn?"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="ll-modal-row">
                  <div className="ll-field">
                    <label>Action Owner</label>
                    <input type="text" className="ll-input" placeholder="e.g. John Smith" value={actionOwnerName} onChange={(e) => setActionOwnerName(e.target.value)} />
                  </div>
                  <div className="ll-field">
                    <label>Project Stage</label>
                    <input type="text" className="ll-input" placeholder="e.g. Design / Build" value={stage} onChange={(e) => setStage(e.target.value)} />
                  </div>
                </div>

                <div className="ll-modal-row">
                  <div className="ll-field">
                    <label>Impact</label>
                    <select className="ll-select" value={impact} onChange={(e) => setImpact(e.target.value)}>
                      <option value="">— Select —</option>
                      <option value="Positive">Positive</option>
                      <option value="Negative">Negative</option>
                    </select>
                  </div>
                  <div className="ll-field">
                    <label>Severity</label>
                    <select className="ll-select" value={severity} onChange={(e) => setSeverity(e.target.value)}>
                      <option value="">— Select —</option>
                      <option value="Low">Low</option>
                      <option value="Medium">Medium</option>
                      <option value="High">High</option>
                    </select>
                  </div>
                </div>

                <div className="ll-field">
                  <label>Action for Future</label>
                  <input type="text" className="ll-input" placeholder="What will we do next time?" value={action} onChange={(e) => setAction(e.target.value)} />
                </div>

                {mode === "edit" && editing?.ai_generated && (
                  <div className="ll-ai-summary">
                    <div className="ll-ai-summary-label">
                      <span>✦</span> AI Summary
                    </div>
                    <p>{editing.ai_summary || "No summary available."}</p>
                  </div>
                )}
              </div>

              <div className="ll-modal-footer">
                <button onClick={() => { setOpen(false); resetForm(); }} className="ll-btn">
                  Cancel
                </button>
                <button
                  disabled={saving || !description.trim()}
                  onClick={mode === "edit" ? updateLesson : createLesson}
                  className="ll-btn ll-btn-primary"
                >
                  {submitLabel}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}