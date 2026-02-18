// src/lib/exports/raid/exportRaidPdf.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

/* ---------------- types ---------------- */

type RaidItem = {
  public_id: string;
  type: string;
  status: string;
  priority: string | null;
  probability: string | null;
  severity: string | null;
  impact: string | null;
  owner_label: string | null;
  title: string;
  description: string | null;
  response_plan: string | null;
  next_steps: string | null;
  notes: string | null;
  ai_rollup: string | null;
  due_date: string | null;
  updated_at: string;
};

type RaidMeta = {
  projectName: string;
  projectCode: string;
  clientName: string;
  organisationName: string;
  generated: string;
  brand: string;
  logoUrl: string;
  watermarkText: string;
};

/* ---------------- helpers (charter style) ---------------- */

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

function normRole(x: any) {
  return String(x || "").trim().toLowerCase();
}

function formatUkDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatUkDate(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function escapeHtml(str: string) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function looksIsoDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}
function looksIsoDateTime(v: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v || "").trim());
}
function formatToUkDate(value: string) {
  const s = String(value || "").trim();
  if (!s) return s;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return s;
  }
}

function formatCellValue(x: any) {
  const raw = safeStr(x).trim();
  if (!raw) return "—";
  if (looksIsoDateOnly(raw) || looksIsoDateTime(raw)) return formatToUkDate(raw);
  return raw;
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function getPriorityColor(priority?: string | null) {
  const p = safeStr(priority).toLowerCase();
  if (p.includes("critical") || p === "1") return "#dc2626";
  if (p.includes("high") || p === "2") return "#ea580c";
  if (p.includes("medium") || p === "3") return "#d97706";
  if (p.includes("low") || p === "4") return "#059669";
  return "#6b7280";
}

function getStatusBadge(status: string) {
  const s = safeStr(status).toLowerCase();
  if (s === "open" || s === "active" || s === "in progress") {
    return { bg: "#fef3c7", text: "#92400e", label: "Open" };
  }
  if (s === "mitigated" || s === "managed") {
    return { bg: "#d1fae5", text: "#065f46", label: "Mitigated" };
  }
  if (s === "closed" || s === "resolved") {
    return { bg: "#dbeafe", text: "#1e40af", label: "Closed" };
  }
  if (s === "pending") {
    return { bg: "#f3f4f6", text: "#374151", label: "Pending" };
  }
  if (s === "in progress") {
    return { bg: "#e0e7ff", text: "#3730a3", label: "In Progress" };
  }
  return { bg: "#f3f4f6", text: "#374151", label: escapeHtml(status || "Unknown") };
}

function getTypeIcon(type: string) {
  const t = safeStr(type).toLowerCase();
  if (t === "risk") return "⚠";
  if (t === "assumption") return "✓";
  if (t === "issue") return "⚡";
  if (t === "dependency") return "🔗";
  if (t === "decision") return "◆";
  return "•";
}

function getTypeColor(type: string) {
  const t = safeStr(type).toLowerCase();
  if (t === "risk") return "#dc2626";
  if (t === "assumption") return "#059669";
  if (t === "issue") return "#ea580c";
  if (t === "dependency") return "#7c3aed";
  if (t === "decision") return "#2563eb";
  return "#6b7280";
}

function getTypeLabel(type: string) {
  const t = safeStr(type).toLowerCase();
  if (t === "risk") return "Risks";
  if (t === "assumption") return "Assumptions";
  if (t === "issue") return "Issues";
  if (t === "dependency") return "Dependencies";
  if (t === "decision") return "Decisions";
  return type.charAt(0).toUpperCase() + type.slice(1) + "s";
}

function sanitizeFilename(name: string) {
  return (
    String(name || "raid")
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "raid"
  );
}

async function tryReadJsonBody(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) return null;
    return await req.json();
  } catch {
    return null;
  }
}

// FIX: Updated launchBrowser function to use new Puppeteer API
async function launchBrowser() {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (isServerless) {
    // FIX: Removed defaultViewport, headless, ignoreHTTPSErrors from launch options
    // These are now handled differently in newer Puppeteer versions
    const browser = await puppeteerCore.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
    });
    // Set viewport on first page instead
    const pages = await browser.pages();
    if (pages[0]) {
      await pages[0].setViewport({ width: 1280, height: 720 });
    }
    return browser;
  }
  // FIX: Use boolean for headless instead of "new"
  return puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
}

/* ---------------- auth helpers (charter style) ---------------- */

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  // Prefer removed_at model
  {
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role, removed_at")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!memErr) {
      if (!mem) throw new Error("Forbidden");
      return { userId: auth.user.id, role: safeStr((mem as any).role) };
    }

    if (memErr && !looksMissingColumn(memErr) && !looksMissingRelation(memErr)) {
      throw new Error(memErr.message);
    }
  }

  // Fallback: is_active
  {
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role, is_active")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (memErr) throw new Error(memErr.message);
    if (!mem || !(mem as any).is_active) throw new Error("Forbidden");
    return { userId: auth.user.id, role: safeStr((mem as any).role) };
  }
}

async function resolveOrganisationLogoUrl(supabase: any, organisation_id?: string | null) {
  const envLogo =
    process.env.RAID_REPORT_LOGO_URL ||
    process.env.NEXT_PUBLIC_RAID_REPORT_LOGO_URL ||
    process.env.CHARTER_REPORT_LOGO_URL ||
    process.env.NEXT_PUBLIC_CHARTER_REPORT_LOGO_URL ||
    "";

  if (!organisation_id) return envLogo;

  {
    const { data, error } = await supabase.from("organisations").select("logo_url").eq("id", organisation_id).single();
    if (!error && data?.logo_url) return String(data.logo_url);
    if (error && !looksMissingColumn(error) && !looksMissingRelation(error)) {
      // continue
    }
  }

  {
    const { data, error } = await supabase.from("organisations").select("logo").eq("id", organisation_id).single();
    if (!error && data?.logo) return String(data.logo);
  }

  {
    const { data, error } = await supabase.from("organisations").select("logo_path").eq("id", organisation_id).single();
    if (!error && data?.logo_path) {
      const v = String(data.logo_path);
      if (v.startsWith("http://") || v.startsWith("https://")) return v;
    }
  }

  return envLogo;
}

/* ---------------- renderer (single column, full width) ---------------- */

function renderRaidHtml(items: RaidItem[], meta: RaidMeta) {
  // Group items by type
  const byType: Record<string, RaidItem[]> = {};
  const typeOrder = ["risk", "assumption", "issue", "dependency", "decision"];
  
  items.forEach((item) => {
    const t = safeStr(item.type).toLowerCase() || "other";
    if (!byType[t]) byType[t] = [];
    byType[t].push(item);
  });

  const typeKeys = typeOrder.filter((t) => byType[t]?.length > 0);
  const otherKeys = Object.keys(byType).filter((t) => !typeOrder.includes(t));
  const allTypes = [...typeKeys, ...otherKeys];

  // Render each section as full-width stacked cards
  const sectionsHtml = allTypes
    .map((type) => {
      const typeItems = byType[type];
      const icon = getTypeIcon(type);
      const color = getTypeColor(type);
      const title = getTypeLabel(type);

      const rowsHtml = typeItems
        .map((item, rIdx) => {
          const badge = getStatusBadge(item.status);
          const priorityColor = getPriorityColor(item.priority);
          const dueDate = item.due_date ? formatToUkDate(item.due_date) : "—";
          const owner = escapeHtml(safeStr(item.owner_label) || "Unassigned");
          const title = escapeHtml(safeStr(item.title));
          const id = escapeHtml(safeStr(item.public_id));
          const description = safeStr(item.description);
          const responsePlan = safeStr(item.response_plan);
          const nextSteps = safeStr(item.next_steps);

          // Build expandable content sections for full visibility
          let detailsHtml = "";
          if (description || responsePlan || nextSteps) {
            const detailSections = [];
            if (description) {
              detailSections.push(`
                <div class="detail-section">
                  <div class="detail-label">Description</div>
                  <div class="detail-text">${escapeHtml(description)}</div>
                </div>
              `);
            }
            if (responsePlan) {
              detailSections.push(`
                <div class="detail-section">
                  <div class="detail-label">Response Plan</div>
                  <div class="detail-text">${escapeHtml(responsePlan)}</div>
                </div>
              `);
            }
            if (nextSteps) {
              detailSections.push(`
                <div class="detail-section">
                  <div class="detail-label">Next Steps</div>
                  <div class="detail-text">${escapeHtml(nextSteps)}</div>
                </div>
              `);
            }
            detailsHtml = `<div class="item-details">${detailSections.join("")}</div>`;
          }

          return `
            <tr class="item-row ${rIdx % 2 === 0 ? "row-even" : "row-odd"}">
              <td colspan="6" class="item-cell">
                <div class="item-header-row">
                  <div class="item-main">
                    <span class="id-badge">${id}</span>
                    <span class="item-title-text">${title}</span>
                  </div>
                  <div class="item-meta">
                    <span class="status-badge" style="background:${badge.bg};color:${badge.text}">${badge.label}</span>
                    <span class="priority-pill">
                      <span class="priority-dot" style="background:${priorityColor}"></span>
                      ${escapeHtml(safeStr(item.priority) || "—")}
                    </span>
                    <span class="due-date">${dueDate}</span>
                    <span class="owner-badge">${owner}</span>
                  </div>
                </div>
                ${detailsHtml}
              </td>
            </tr>
          `;
        })
        .join("");

      return `
        <div class="section-card">
          <div class="section-header" style="border-bottom-color: ${color}">
            <span class="section-icon" style="background: ${color}">${icon}</span>
            <span class="section-title-text" style="color: ${color}">${escapeHtml(title)} (${typeItems.length})</span>
          </div>
          <div class="section-body">
            <table class="raid-table">
              <thead>
                <tr>
                  <th class="col-main">ID & Title</th>
                  <th class="col-status">Status</th>
                  <th class="col-priority">Priority</th>
                  <th class="col-due">Due Date</th>
                  <th class="col-owner">Owner</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      `;
    })
    .join("");

  // Summary stats
  const totalItems = items.length;
  const openItems = items.filter((i) => ["open", "active", "in progress"].includes(safeStr(i.status).toLowerCase())).length;
  const mitigatedItems = items.filter((i) => ["mitigated", "managed", "closed", "resolved"].includes(safeStr(i.status).toLowerCase())).length;
  const highPriority = items.filter((i) => ["critical", "high", "1", "2"].includes(safeStr(i.priority).toLowerCase())).length;

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title>RAID Log - ${escapeHtml(meta.projectName)}</title>
  <style>
    :root {
      --primary: ${meta.brand};
      --secondary: #64748b;
      --text: #0f172a;
      --text-muted: #64748b;
      --bg: #ffffff;
      --bg-secondary: #f8fafc;
      --border: #e2e8f0;
    }
    @page { size: A4; margin: 15mm 18mm 18mm 18mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 9pt;
      line-height: 1.5;
      color: var(--text);
      background: var(--bg);
    }

    /* Watermark */
    .watermark {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%) rotate(-45deg);
      font-size: 80pt;
      font-weight: 900;
      color: rgba(0,0,0,0.06);
      pointer-events: none;
      z-index: 1000;
      letter-spacing: 0.2em;
      text-transform: uppercase;
    }

    .header {
      margin-bottom: 18px;
      padding-bottom: 16px;
      border-bottom: 2px solid var(--border);
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 14px;
      margin-bottom: 14px;
    }
    .brand { display: flex; align-items: center; gap: 14px; }
    .logo {
      width: 44px; height: 44px; border-radius: 8px;
      background: linear-gradient(135deg, ${meta.brand} 0%, #7c3aed 100%);
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 700; font-size: 18px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      overflow: hidden;
    }
    .logo img {
      width: 100%; height: 100%; object-fit: contain; padding: 4px;
    }
    .brand-content h1 {
      font-size: 20pt; font-weight: 700; color: var(--text);
      letter-spacing: -0.02em; margin-bottom: 3px;
    }
    .brand-content .subtitle { font-size: 10pt; color: var(--text-muted); font-weight: 500; }
    .generated-meta { text-align: right; }
    .generated-label {
      font-size: 7pt; color: var(--text-muted); font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 3px;
    }
    .generated-value { font-size: 10pt; color: var(--text); font-weight: 600; }

    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
    .meta-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px 12px;
    }
    .meta-label {
      font-size: 7pt; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--text-muted); font-weight: 700; margin-bottom: 2px;
    }
    .meta-value { font-size: 9.5pt; font-weight: 600; color: var(--text); }
    .meta-value.code { font-family: "SF Mono", Monaco, monospace; color: var(--primary); font-size: 10pt; }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-top: 14px;
    }
    .stat-card {
      background: white;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 10px;
      text-align: center;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .stat-value {
      font-size: 18pt;
      font-weight: 700;
      color: var(--primary);
      line-height: 1;
      margin-bottom: 3px;
    }
    .stat-value.critical { color: #dc2626; }
    .stat-value.success { color: #059669; }
    .stat-label {
      font-size: 7pt;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }

    /* Single column layout */
    .content-stack { display: flex; flex-direction: column; gap: 16px; }
    
    .section-card {
      background: white; 
      border: 1px solid var(--border); 
      border-radius: 8px;
      overflow: hidden; 
      break-inside: avoid; 
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
    }
    .section-header {
      background: var(--bg-secondary); 
      padding: 12px 16px;
      border-bottom: 3px solid var(--primary);
      display: flex; 
      align-items: center; 
      gap: 10px;
    }
    .section-icon {
      background: var(--primary); 
      color: white; 
      width: 28px; 
      height: 28px;
      border-radius: 6px; 
      display: flex; 
      align-items: center; 
      justify-content: center;
      font-size: 14px; 
      font-weight: 700;
    }
    .section-title-text { 
      font-size: 12pt; 
      font-weight: 700; 
      color: var(--primary); 
      flex: 1; 
    }

    /* RAID Table - Full Width Layout */
    .section-body { padding: 0; }
    
    .raid-table { 
      width: 100%; 
      border-collapse: collapse; 
      font-size: 9pt; 
    }
    .raid-table thead th {
      background: linear-gradient(to bottom, #f8fafc, #f1f5f9);
      text-align: left; 
      padding: 10px 12px; 
      font-weight: 700; 
      font-size: 7.5pt;
      text-transform: uppercase; 
      letter-spacing: 0.03em; 
      color: var(--secondary);
      border-bottom: 2px solid var(--border);
      white-space: nowrap;
    }
    .raid-table tbody td {
      padding: 0;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }

    .item-row { break-inside: avoid; }
    .item-row:hover { background: #fafafa; }
    .row-even { background: white; }
    .row-odd { background: #fafafa; }

    .item-cell { padding: 12px 16px !important; }
    
    .item-header-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 16px;
      margin-bottom: 8px;
    }
    
    .item-main {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      min-width: 0;
    }
    
    .id-badge {
      font-family: "SF Mono", Monaco, monospace;
      font-size: 8pt;
      background: var(--bg-secondary);
      padding: 3px 8px;
      border-radius: 4px;
      color: var(--text-muted);
      font-weight: 600;
      white-space: nowrap;
      border: 1px solid var(--border);
    }
    
    .item-title-text {
      font-weight: 600;
      color: var(--text);
      font-size: 10pt;
      line-height: 1.4;
    }

    .item-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-shrink: 0;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 10px;
      border-radius: 9999px;
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }

    .priority-pill {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 9pt;
      font-weight: 500;
      color: var(--text);
      white-space: nowrap;
    }

    .priority-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }

    .due-date {
      font-size: 9pt;
      color: var(--text-muted);
      font-weight: 500;
      white-space: nowrap;
      min-width: 70px;
      text-align: center;
    }

    .owner-badge {
      font-size: 8.5pt;
      color: var(--text);
      font-weight: 600;
      background: var(--bg-secondary);
      padding: 3px 10px;
      border-radius: 4px;
      border: 1px solid var(--border);
      white-space: nowrap;
      min-width: 80px;
      text-align: center;
    }

    /* Expandable Details Section */
    .item-details {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed var(--border);
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .detail-section {
      display: flex;
      gap: 12px;
    }

    .detail-label {
      font-size: 7.5pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--text-muted);
      min-width: 100px;
      flex-shrink: 0;
      padding-top: 2px;
    }

    .detail-text {
      font-size: 9pt;
      color: var(--text);
      line-height: 1.5;
      flex: 1;
    }

    .empty-content {
      color: var(--text-muted); 
      font-style: italic; 
      padding: 32px;
      text-align: center; 
      background: var(--bg-secondary);
    }

    /* Column widths */
    .col-main { width: auto; }
    .col-status { width: 90px; }
    .col-priority { width: 90px; }
    .col-due { width: 80px; }
    .col-owner { width: 100px; }

    /* Print optimizations */
    @media print {
      .section-card { break-inside: avoid-page; }
      .item-row { break-inside: avoid-page; }
      .item-details { break-inside: avoid-page; }
    }
  </style>
</head>
<body>
  ${meta.watermarkText ? `<div class="watermark">${escapeHtml(meta.watermarkText)}</div>` : ""}
  
  <div class="header">
    <div class="header-top">
      <div class="brand">
        <div class="logo">
          ${meta.logoUrl ? `<img src="${escapeHtml(meta.logoUrl)}" alt="Logo" onerror="this.style.display='none'; this.parentElement.textContent='RAID'" />` : "RAID"}
        </div>
        <div class="brand-content">
          <h1>RAID Log</h1>
          <div class="subtitle">${escapeHtml(meta.projectName)}${meta.projectCode !== "—" ? ` • Project ${escapeHtml(meta.projectCode)}` : ""}</div>
        </div>
      </div>
      <div class="generated-meta">
        <div class="generated-label">Generated</div>
        <div class="generated-value">${escapeHtml(meta.generated)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-card">
        <div class="meta-label">Organisation</div>
        <div class="meta-value">${escapeHtml(meta.organisationName)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Client</div>
        <div class="meta-value">${escapeHtml(meta.clientName)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Project ID</div>
        <div class="meta-value code">${escapeHtml(meta.projectCode)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Total Items</div>
        <div class="meta-value">${totalItems}</div>
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalItems}</div>
        <div class="stat-label">Total Items</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${openItems}</div>
        <div class="stat-label">Open / Active</div>
      </div>
      <div class="stat-card">
        <div class="stat-value success">${mitigatedItems}</div>
        <div class="stat-label">Mitigated / Closed</div>
      </div>
      <div class="stat-card">
        <div class="stat-value ${highPriority > 0 ? 'critical' : ''}">${highPriority}</div>
        <div class="stat-label">High / Critical Priority</div>
      </div>
    </div>
  </div>

  <div class="content-stack">
    ${sectionsHtml || '<div class="section-card"><div class="section-body"><div class="empty-content">No RAID items found</div></div></div>'}
  </div>
</body>
</html>`;
}

/* ---------------- exported API handler ---------------- */

export async function exportRaidPdf({
  req,
  projectId,
  bodyContent,
}: {
  req: NextRequest;
  projectId: string;
  bodyContent?: any;
}) {
  let browser: any = null;

  try {
    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

    const supabase = await createClient();
    await requireAuthAndMembership(supabase, projectId);

    // Fetch project info
    const { data: proj, error: projErr } = await supabase
      .from("projects")
      .select("id,title,project_code,client_name,organisation_id,brand_primary_color,client_logo_url")
      .eq("id", projectId)
      .maybeSingle();

    if (projErr) throw new Error(projErr.message);
    if (!proj) return jsonErr("Project not found", 404);

    const projectName = safeStr((proj as any).title).trim() || "Project";
    const projectCode = safeStr((proj as any).project_code).trim() || projectId.slice(0, 8);
    const clientName = safeStr((proj as any).client_name).trim();
    const organisationId = (proj as any).organisation_id ?? null;
    const brand = safeStr((proj as any).brand_primary_color).trim() || "#111827";

    // Get org name
    let organisationName = "";
    if (organisationId) {
      const { data: org, error: orgErr } = await supabase
        .from("organisations")
        .select("name")
        .eq("id", organisationId)
        .maybeSingle();
      if (!orgErr && org?.name) organisationName = safeStr(org.name).trim();
    }

    // Resolve logo
    const orgLogo = await resolveOrganisationLogoUrl(supabase, organisationId);
    const clientLogo = safeStr((proj as any).client_logo_url).trim();
    const logoUrl = orgLogo || clientLogo || "";

    // Fetch RAID items
    const { data: items, error } = await supabase
      .from("raid_items")
      .select("public_id,type,status,priority,probability,severity,impact,owner_label,title,description,response_plan,next_steps,notes,ai_rollup,due_date,updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });

    if (error) throw new Error(error.message);

    // Watermark from body or default
    const watermarkText = safeStr(bodyContent?.watermarkText).trim() || "";

    const meta: RaidMeta = {
      projectName,
      projectCode,
      clientName,
      organisationName,
      generated: formatUkDateTime(),
      brand,
      logoUrl,
      watermarkText,
    };

    const html = renderRaidHtml((items ?? []) as RaidItem[], meta);

    browser = await launchBrowser();
    const page = await browser.newPage();
    // FIX: Use setViewport instead of defaultViewport
    await page.setViewport({ width: 1200, height: 1600 });
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluateHandle("document.fonts.ready");

    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "15mm", right: "18mm", bottom: "18mm", left: "18mm" },
      displayHeaderFooter: true,
      headerTemplate: `<div style="font-size: 8px; margin-left: 18px; margin-top: 10px; color: #64748b; font-family: system-ui;">
        ${escapeHtml(meta.projectName)} • RAID Log
      </div>`,
      footerTemplate: `
        <div style="width: 100%; padding: 0 18px; font-family: system-ui; font-size: 8pt; color: #64748b; display: flex; justify-content: space-between;">
          <span>Confidential</span>
          <span>Generated ${escapeHtml(meta.generated)} • Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>
      `,
    });

    const filename = `RAID_${sanitizeFilename(projectCode)}_${formatUkDate().replace(/\//g, "-")}.pdf`;

    // FIX: Simplified Buffer conversion
    return new NextResponse(Buffer.from(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[RAID PDF Error]", err);
    return jsonErr(err?.message || "Failed to generate PDF", 500);
  } finally {
    if (browser) await browser.close();
  }
}

/* ---------------- Next.js route handlers ---------------- */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const projectId = safeStr(url.searchParams.get("projectId")).trim();
  return exportRaidPdf({ req, projectId });
}

export async function POST(req: NextRequest) {
  const body = await tryReadJsonBody(req);
  const projectId = safeStr(body?.projectId ?? body?.project_id).trim();
  return exportRaidPdf({ req, projectId, bodyContent: body });
}